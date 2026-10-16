// The browser oracle and the TS browser build (verification 01 §5, verification 02 §A.1, §B.1):
// one headless Chromium (Playwright 1.54.2 / Chromium 1181, the e2e pin), the C++ web build with
// the `window.__lekhTest` v1 hooks served statically from `parity/out/builds/cpp/` on :4007 and
// the TS build from `parity/out/builds/ts/` on :4008, driven through `loadDoc` / `settle` /
// `serialize`. It is used for pipeline P2 and for the `cpp_oom` retry of the Node oracle.
//
// STUB until H1 is done: the hook code is on lekhboardwebapp's branch, but the web wasm that
// carries it is built by the owner on the Mac (H-ROL-1) and the static build under
// `parity/out/builds/cpp/` must be made from that commit (`npx vite build --outDir <abs>` in a
// scratch worktree). Until both exist `browserOracleStatus()` says why, P2 is skipped, and a Node
// oracle out-of-memory stays `cpp_oom` with `browser_retry: 'unavailable'`.
import { existsSync } from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
export const BUILDS = path.resolve(HERE, '..', 'out', 'builds');
export const CPP_PORT = 4007;
export const TS_PORT = 4008;

/** @returns {{ available: boolean, reason: string }} */
export function browserOracleStatus() {
  const cpp = path.join(BUILDS, 'cpp', 'index.html');
  const ts = path.join(BUILDS, 'ts', 'index.html');
  if (!existsSync(cpp))
    return {
      available: false,
      reason:
        "no C++ web build with __lekhTest hooks at parity/out/builds/cpp/ (needs the owner's H-ROL-1 wasm; task H1)",
    };
  if (!existsSync(ts)) return { available: false, reason: 'no TS web build at parity/out/builds/ts/' };
  return { available: false, reason: 'the Playwright driver lands with H1 (this file is a stub)' };
}

export class BrowserOracle {
  /** @param {{ engine: 'cpp' | 'ts' }} opts */
  constructor(opts) {
    this.engine = opts.engine;
    const st = browserOracleStatus();
    if (!st.available) throw new Error(`browser oracle unavailable: ${st.reason}`);
  }

  /**
   * `load(text, { stamp, settle })` → `{ ok, json?, error? }` once H1 lands.
   * @returns {Promise<{ ok: boolean, json?: string, error?: string }>}
   */
  load() {
    return Promise.reject(new Error('browser oracle: not implemented until H1'));
  }

  close() {
    return Promise.resolve();
  }
}
