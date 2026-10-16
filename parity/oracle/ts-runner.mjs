// The lekhjs runner of the JSON comparison: `ts-runner-worker.mjs` behind the same worker runner
// as the Node oracle (60 s per board, recycled every 50 boards and after a timeout).
//
//   const ts = new TsRunner();               // { lekhjs?, stencilsV4?, compat?, recycleEvery?, timeoutMs?, log? }
//                                            // compat (default true): lineSpacingCompat + fontFallbackCompat
//   await ts.identity()                      // { kind: 'ts', commit, dirty, files_sha256 }
//   await ts.load(text, { stamp: 'app' })    // { ok, json?, code?, error?, timeout?, ms }
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { WorkerRunner } = require('./worker-runner.cjs');

const HERE = import.meta.dirname;
const LEKHJS = path.resolve(HERE, '..', '..');
/** The pass → the TS stamp (verification 02 §A.2). */
export const TS_STAMP = Object.freeze({ app: 'offline', backend: 'cloud' });

export class TsRunner {
  /** @param {{ lekhjs?: string, stencilsV4?: string, compat?: boolean, recycleEvery?: number, timeoutMs?: number, log?: NodeJS.WritableStream | null }} [opts] */
  constructor(opts = {}) {
    this.lekhjs = path.resolve(opts.lekhjs ?? LEKHJS);
    const info = path.join(this.lekhjs, 'dist', 'build-info.json');
    if (!existsSync(info)) throw new Error(`ts runner: ${info} is missing; run npm run build in lekhjs first`);
    const sets = JSON.parse(readFileSync(path.join(this.lekhjs, 'parity', 'fixture-sets.json'), 'utf8'));
    const stencilsV4 = path.resolve(opts.stencilsV4 ?? path.join(this.lekhjs, sets.stencilsV4));
    this.runner = new WorkerRunner(
      path.join(HERE, 'ts-runner-worker.mjs'),
      { lekhjs: this.lekhjs, stencilsV4, compat: opts.compat !== false },
      { recycleEvery: opts.recycleEvery ?? 50, timeoutMs: opts.timeoutMs ?? 60000, log: opts.log ?? null },
    );
  }

  async identity() {
    const init = await this.runner.init();
    const b = init.buildInfo ?? {};
    return {
      kind: 'ts',
      commit: b.commit ?? null,
      dirty: b.dirty ?? null,
      files_sha256: b.files_sha256 ?? null,
      catalog_files: init.files,
      node_runtime: init.nodeRuntime,
      compat: init.compat,
    };
  }

  /**
   * @param {string} text
   * @param {{ stamp?: 'app' | 'backend' }} [opts]
   */
  async load(text, opts = {}) {
    const stamp = TS_STAMP[opts.stamp ?? 'app'];
    try {
      return await this.runner.call({ op: 'load', text, stamp });
    } catch (e) {
      const err = /** @type {{ timeout?: boolean, workerExit?: boolean, message: string }} */ (e);
      if (err.timeout) return { ok: false, timeout: true, code: 'timeout', error: 'timeout' };
      if (err.workerExit) return { ok: false, code: 'worker_exit', error: err.message };
      throw e;
    }
  }

  close() {
    return this.runner.close();
  }
}
