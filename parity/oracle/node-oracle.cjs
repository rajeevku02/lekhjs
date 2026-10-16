'use strict';

// The Node oracle (verification 01 §5): the vendored backend wasm `lbs/kashi/vendor/lekhcore`
// (committed, 128 MB heap cap; no larger wasm is ever built on this box), one instance at a time in
// a worker thread, replaced every 50 boards and after any abort, so one poisoned instance cannot
// cascade. It seeds what kashi's `ops.seed` seeds for a board (the v4 catalogue + core set of
// `lbs/kashi/vendor/stencils` by the board's ids with their embed closures, the 26 arrowheads, the
// Lua pack), and loads + serializes under the stamp mode of the pass.
//
//   const { NodeOracle } = require('./node-oracle.cjs');
//   const o = new NodeOracle();            // { kashi?, recycleEvery?, timeoutMs?, log? }
//   await o.identity()                     // { kind, commit, wasm_sha256, heap_max }
//   await o.load(text, { stamp: 'app' })   // { ok, json?, error?, oom?, aborted?, timeout?, ms, heap }
//   await o.close()

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { WorkerRunner } = require('./worker-runner.cjs');

const LEKHJS = path.resolve(__dirname, '..', '..');
const DEFAULT_KASHI = path.resolve(LEKHJS, '..', 'lbs', 'kashi');
const STAMP_MODE = { app: 0, backend: 1 };

class NodeOracle {
  /** @param {{ kashi?: string, recycleEvery?: number, timeoutMs?: number, log?: NodeJS.WritableStream | null }} [opts] */
  constructor(opts = {}) {
    this.kashi = path.resolve(opts.kashi ?? process.env.LEKH_KASHI_DIR ?? DEFAULT_KASHI);
    const wasm = path.join(this.kashi, 'vendor', 'lekhcore', 'lekhcore.wasm');
    if (!fs.existsSync(wasm)) {
      throw new Error(
        'node oracle: no backend wasm at ' +
          wasm +
          ' (it is committed in lbs: git -C lbs checkout -- kashi/vendor/lekhcore)',
      );
    }
    this.wasm = wasm;
    this.runner = new WorkerRunner(
      path.join(__dirname, 'node-oracle-worker.cjs'),
      { kashi: this.kashi },
      {
        recycleEvery: opts.recycleEvery ?? 50,
        timeoutMs: opts.timeoutMs ?? 60000,
        log: opts.log ?? null,
      },
    );
  }

  async identity() {
    const init = await this.runner.init();
    const info = init.buildInfo || {};
    return {
      kind: 'node',
      commit: info.lekhcore_commit ?? null,
      lekhemsdk_commit: info.lekhemsdk_commit ?? null,
      wasm_sha256: nodeCrypto.createHash('sha256').update(fs.readFileSync(this.wasm)).digest('hex'),
      heap_max: init.heapMax,
    };
  }

  /** Number of wasm instances created so far (recycles + replacements). */
  get instances() {
    return this.runner.instances;
  }

  /**
   * @param {string} text
   * @param {{ stamp?: 'app' | 'backend' }} [opts]
   * @returns {Promise<any>}
   */
  async load(text, opts = {}) {
    const stampMode = STAMP_MODE[opts.stamp ?? 'app'];
    if (stampMode === undefined) throw new Error('node oracle: stamp must be app or backend');
    try {
      const out = await this.runner.call({ op: 'load', text, stampMode });
      if (out.aborted) await this.runner.recycle(); // poisoned: never reuse it
      return out;
    } catch (err) {
      const e = /** @type {{ timeout?: boolean, workerExit?: boolean, message: string }} */ (err);
      if (e.timeout) return { ok: false, timeout: true, error: 'timeout' };
      if (e.workerExit) return { ok: false, aborted: true, oom: false, error: e.message };
      throw err;
    }
  }

  close() {
    return this.runner.close();
  }
}

module.exports = { NodeOracle, STAMP_MODE };
