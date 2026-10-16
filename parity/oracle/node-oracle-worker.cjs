'use strict';

// The Node oracle's worker thread (verification 01 §5): ONE instance of the vendored backend wasm
// (`lbs/kashi/vendor/lekhcore`, 128 MB cap as committed), driven through kashi's own host, seeding
// and platform modules by relative path, which only parity/ may do (spec 01 §7 rule 2). The parent
// (node-oracle.cjs) replaces this worker every 50 boards and after any abort.
//
// Deterministic platform: `Platform::getUUID` is kashi's `crypto.randomUUID()`, replaced here by a
// counter restarted per board, so the ids a legacy board mints are the same on every run. The
// core turns each into its 22-character short id; the comparison renames minted ids by position
// anyway (verification 02 §A.5 step 6). Text is measured by kashi's `@napi-rs/canvas` platform.

const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');

const KASHI = workerData.kashi;

// kashi's config module exits without these; the core tier's Jest shim sets placeholders.
require(path.join(KASHI, 'test', 'setup', 'env.js'));
process.env.TZ = 'UTC';

let counter = 0;
nodeCrypto.randomUUID = () => {
  counter++;
  return '00000000-0000-4000-8000-' + counter.toString(16).padStart(12, '0');
};

const host = require(path.join(KASHI, 'service', 'mcp', 'core', 'host'));
const ops = require(path.join(KASHI, 'service', 'mcp', 'core', 'ops'));
const stencils = require(path.join(KASHI, 'service', 'mcp', 'stencils'));

const isAbort = (e) => e instanceof WebAssembly.RuntimeError;

const heap = (Module, poisoned) => {
  const out = { buffer: host.memoryBytes() };
  if (!poisoned && Module && typeof Module.heapStats === 'function') {
    try {
      const s = Module.heapStats();
      out.inUse = s.inUse;
      out.heapMax = s.heapMax;
    } catch {
      // a poisoned instance answers nothing
    }
  }
  return out;
};

const atCap = () => {
  const bytes = host.memoryBytes();
  const max = host.maximumMemory();
  return bytes !== null && max !== null && bytes >= max;
};

const idsOf = (text) => {
  try {
    return stencils.idsFromDocument(JSON.parse(text)).shapes;
  } catch {
    return []; // not strict JSON: the core reads what it can, with what is already seeded
  }
};

let Module = null;

const init = async () => {
  stencils.init({ dir: path.join(KASHI, 'vendor', 'stencils') });
  Module = await host.init();
  return {
    buildInfo: host.buildInfo(),
    heapMax: heap(Module, false).heapMax ?? null,
  };
};

const load = async ({ text, stampMode }) => {
  counter = 0;
  Module.setFormatStampMode(stampMode);
  const t0 = performance.now();
  try {
    ops.seed(Module, idsOf(text));
    const out = await host.withDoc(({ doc }) => {
      if (!doc.load(text)) return { ok: false, error: doc.message() || 'load failed' };
      return { ok: true, json: doc.serialize() };
    });
    return { ...out, ms: performance.now() - t0, heap: heap(Module, false) };
  } catch (e) {
    if (isAbort(e)) {
      return {
        ok: false,
        aborted: true,
        oom: atCap(),
        error: String(e.message || e),
        ms: performance.now() - t0,
        heap: heap(Module, true),
      };
    }
    return {
      ok: false,
      error: 'oracle: ' + String((e && e.message) || e),
      ms: performance.now() - t0,
      heap: heap(Module, false),
    };
  }
};

parentPort.on('message', async (msg) => {
  try {
    const value = msg.op === 'init' ? await init() : await load(msg);
    parentPort.postMessage({ id: msg.id, value });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, error: String((e && e.stack) || e) });
  }
});
