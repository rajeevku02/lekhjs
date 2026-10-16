// The lekhjs side of the JSON comparison (verification 02 §A.1), in a worker thread so a board that
// hangs can be timed out: `lekhjs/dist/node` (run `npm run build` in lekhjs first), a runtime over
// `@napi-rs/canvas` text measurement with the same catalogue the oracle has (lekhboard v4 stencils,
// then `lekhjs/stencils/{core,builtin}`), `BoardSession.load` and `serialize({ stamp })`.
//
// Until `createNodeRuntime` exists (task B1) the runtime is `createRuntime` with the canvas
// measurer of `lekhjs/testing`; once headless exports `createNodeRuntime`, that is used instead.
// Ids are a counter restarted per board and the clock is fixed at 2026-01-15T00:00:00Z
// (verification 02 §A.7 item 10). The test-only `lineSpacingCompat` and `fontFallbackCompat`
// switches are on unless `compat: false` (G1 runs with both on, spec 11 §4; spec 06 §3.6).
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

const PKG = workerData.lekhjs;
const CLOCK = Object.freeze({ now: () => Date.parse('2026-01-15T00:00:00Z') });
const SKIP = new Set(['_index.json', '_text_syntax.json', 'libnames.json']);

/** @type {any} */
let headless = null;
/** @type {any} */
let runtime = null;
/** @type {any} */
let testing = null;
let counter = 0;
const ids = { next: () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}` };

/** @param {string} dir */
function libraryFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !SKIP.has(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
}

async function init() {
  const dist = path.join(PKG, 'dist', 'node');
  headless = await import(pathToFileURL(path.join(dist, 'headless.js')).href);
  testing = await import(pathToFileURL(path.join(dist, 'testing.js')).href);
  const files = [
    ...libraryFiles(workerData.stencilsV4),
    ...libraryFiles(path.join(PKG, 'stencils', 'core')),
    ...libraryFiles(path.join(PKG, 'stencils', 'builtin')),
  ];
  const catalog = headless.buildCatalog(files);
  const switches = testing.setTestConfig(
    workerData.compat === false ? {} : { lineSpacingCompat: true, fontFallbackCompat: true },
  );
  const canvas = { createCanvas: (/** @type {number} */ w, /** @type {number} */ h) => createCanvas(w, h) };
  if (typeof headless.createNodeRuntime === 'function') {
    runtime = headless.createNodeRuntime({ catalog, clock: CLOCK, ids, testing: switches });
  } else {
    const measurer = testing.createTestRuntime({ canvas }).measurer;
    runtime = headless.createRuntime({
      measurer,
      fonts: new testing.FakeFontLoader(),
      catalog,
      clock: CLOCK,
      ids,
      config: {},
      host: 'backend',
      testing: switches,
    });
  }
  const info = JSON.parse(readFileSync(path.join(PKG, 'dist', 'build-info.json'), 'utf8'));
  return {
    buildInfo: info,
    files: files.length,
    nodeRuntime: typeof headless.createNodeRuntime === 'function',
    compat: { lineSpacingCompat: switches.lineSpacingCompat, fontFallbackCompat: switches.fontFallbackCompat },
  };
}

/** @param {{ text: string, stamp: 'offline' | 'cloud' }} msg */
function load(msg) {
  counter = 0;
  const t0 = performance.now();
  const session = new headless.BoardSession(runtime, {
    images: new testing.FakeImagePort(),
    scheduler: new testing.FakeScheduler(),
  });
  try {
    const r = session.load(msg.text);
    if (!r.ok) return { ok: false, code: r.code, error: r.message, ms: performance.now() - t0 };
    const json = session.serialize({ stamp: msg.stamp });
    return { ok: true, json, ms: performance.now() - t0, heap: process.memoryUsage().heapUsed };
  } catch (e) {
    const err = /** @type {{ code?: string, message?: string }} */ (e);
    return {
      ok: false,
      code: typeof err?.code === 'string' ? err.code : 'exception',
      error: String(err?.message ?? e),
      ms: performance.now() - t0,
    };
  } finally {
    session.dispose();
  }
}

parentPort?.on('message', async (/** @type {any} */ msg) => {
  try {
    const value = msg.op === 'init' ? await init() : load(msg);
    parentPort?.postMessage({ id: msg.id, value });
  } catch (e) {
    parentPort?.postMessage({ id: msg.id, error: String(/** @type {Error} */ (e)?.stack ?? e) });
  }
});
