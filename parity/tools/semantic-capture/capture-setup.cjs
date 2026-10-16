'use strict';

// A Jest `setupFiles` entry for kashi's core tier that records every semantic call the tier makes
// on the vendored backend wasm (`CoreDoc.project`, `compile`, `generate`, `lint`, `visualBounds`)
// with its input and the wasm's answer, so the lekhjs semantic port can be compared against the
// C++ on the same inputs (AC-BE-07, lekhjs side; spec 10 §11 "parity during the port").
//
//   SEMANTIC_CAPTURE_OUT=<dir> npx jest test/core --runInBand \
//     --setupFiles <kashi>/test/setup/env.js <this file>
//
// The inputs are kashi's synthetic test fixtures (no customer board). One JSONL file per test
// file under SEMANTIC_CAPTURE_OUT; `semantic-parity.mjs` reads and de-duplicates them.

const fs = require('node:fs');
const path = require('node:path');

const OUT = process.env.SEMANTIC_CAPTURE_OUT;
if (OUT) {
  const KASHI = path.resolve(__dirname, '..', '..', '..', '..', 'lbs', 'kashi');
  const kashi = process.env.LEKH_KASHI_DIR ? path.resolve(process.env.LEKH_KASHI_DIR) : KASHI;
  const host = require(path.join(kashi, 'service', 'mcp', 'core', 'host'));
  const ops = require(path.join(kashi, 'service', 'mcp', 'core', 'ops'));
  const testFile = process.env.SEMANTIC_CAPTURE_NAME || 'capture';
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, path.basename(String(testFile)).replace(/[^A-Za-z0-9_.-]/g, '_') + '.jsonl');
  const state = new WeakMap(); // CoreDoc -> { raw } | { payload }
  const write = (rec) => {
    try {
      const seeded = typeof ops.seeded === 'function' ? ops.seeded().ids : [];
      fs.appendFileSync(file, JSON.stringify({ ...rec, seeded }) + '\n');
    } catch {
      // a capture failure must never fail the tier
    }
  };
  const patched = new WeakSet();
  const patch = (Module) => {
    if (!Module || !Module.CoreDoc || patched.has(Module.CoreDoc.prototype)) return Module;
    const P = Module.CoreDoc.prototype;
    patched.add(P);
    const orig = {};
    for (const m of ['load', 'project', 'compile', 'generate', 'lint', 'visualBounds', 'reset']) orig[m] = P[m];
    P.load = function (raw) {
      const ok = orig.load.call(this, raw);
      state.set(this, { raw });
      return ok;
    };
    P.reset = function () {
      state.delete(this);
      return orig.reset.call(this);
    };
    P.generate = function (payload) {
      const out = orig.generate.call(this, payload);
      state.set(this, { payload, generated: out });
      let serialized;
      try {
        serialized = this.serialize();
      } catch {
        serialized = null;
      }
      write({ op: 'generate', payload, out, serialized });
      return out;
    };
    for (const [m, argName] of [
      ['project', 'options'],
      ['compile', 'batch'],
      ['lint', 'options'],
    ]) {
      P[m] = function (arg) {
        const out = orig[m].call(this, arg);
        const src = state.get(this) || {};
        write({ op: m, ...src, [argName]: arg, out });
        return out;
      };
    }
    P.visualBounds = function (pageId, nodeId) {
      const out = orig.visualBounds.call(this, pageId, nodeId);
      const src = state.get(this) || {};
      write({ op: 'visualBounds', ...src, args: [pageId, nodeId], out });
      return out;
    };
    return Module;
  };
  const init = host.init;
  host.init = () => init().then(patch);
  if (typeof host.module === 'function' && host.module()) patch(host.module());
}
