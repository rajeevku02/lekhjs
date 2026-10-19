// The browser oracle (verification 01 §5, verification 02 §A.1, §A.3; spec 11 §4 G1): the C++ web
// build with the `window.__lekhTest` v1 hooks (the owner's H-ROL-1 wasm, lekhboardwebapp fa71c40),
// served statically from `parity/out/builds/cpp/` on 127.0.0.1:4007 and driven in one headless
// Chromium (Playwright 1.54.2 / Chromium 1181, the e2e pin) through `loadDoc` / `serialize`.
//
// The JSON comparison uses it for the `cpp_oom` retry: a board the 128 MB Node oracle cannot load
// is loaded again here (the web wasm grows its memory). The C++ `loadDoc` lays out and draws the
// board once (`redrawAll`, measuring text with the browser's `measureText`), so the retried board
// is compared as P2 does it: both browser builds in the same Chromium, load → settle → serialize,
// the TS build (`parity/out/builds/ts/`, :4008) with the compat switches of the pass. Comparing the
// browser C++ output with the Node TS runner instead measures two text measurers, not two engines
// (every auto-sized text width differs). The results record `oracle: 'browser'`.
//
// Pipeline P2 (load → settle → serialize in both browser builds) is not driven from here: the
// image run (parity/image/run.mjs) settles and renders both builds itself. `browserOracleStatus()`
// therefore still reports P2 as unavailable, and the fixture run skips P2 as before.
//
//   const b = new BrowserOracle({ compat: true });  // { builds?, timeoutMs?, recycleEvery?, compat? }
//   await b.identity()                              // { kind: 'browser', cpp: {...}, ts: {...}, chromium }
//   await b.load('cpp', text, { stamp: 'app' })     // { ok, json?, error?, oom?, timeout?, ms }
//   await b.load('ts', text, { stamp: 'app' })
//   await b.close()
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HERE = import.meta.dirname;
export const BUILDS = path.resolve(HERE, '..', 'out', 'builds');
export const CPP_PORT = 4007;
export const TS_PORT = 4008;
const WS = path.resolve(HERE, '..', '..', '..');
const PLAYWRIGHT = path.join(WS, 'e2e', 'node_modules', 'playwright');

/** P2's status: the image run settles both browser builds; compare.mjs does not drive P2. */
/** @returns {{ available: boolean, reason: string }} */
export function browserOracleStatus() {
  const cpp = cppBrowserStatus();
  if (!cpp.available) return cpp;
  return {
    available: false,
    reason:
      'P2 is run by the image harness (parity/image/run.mjs); compare.mjs drives the browser oracle only for the cpp_oom retry',
  };
}

/** Whether the `cpp_oom` retry can run: both browser builds and the e2e Playwright. */
/** @param {string} [builds] @returns {{ available: boolean, reason: string }} */
export function cppBrowserStatus(builds = BUILDS) {
  if (!existsSync(path.join(builds, 'ts', 'index.html')))
    return { available: false, reason: `no TS web build at ${path.join(builds, 'ts')}` };
  if (
    !existsSync(path.join(builds, 'cpp', 'index.html')) ||
    !existsSync(path.join(builds, 'cpp', 'a1', 'lekhapp.wasm'))
  )
    return {
      available: false,
      reason:
        "no C++ web build with __lekhTest hooks at parity/out/builds/cpp/ (vite build of the oracle worktree lekhboardwebapp/v2 at fa71c40, the owner's H-ROL-1 wasm)",
    };
  if (!existsSync(path.join(PLAYWRIGHT, 'package.json')))
    return { available: false, reason: `no Playwright at ${PLAYWRIGHT}` };
  return { available: true, reason: '' };
}

const MIME = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
});

/** @param {string} root @param {number} port @returns {Promise<import('node:http').Server>} */
function serveStatic(root, port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) return void res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/** A wasm or renderer failure that is a memory exhaustion, not a load error of the board. */
export const OOM_TEXT =
  /out of memory|\bOOM\b|Cannot enlarge memory|Array buffer allocation failed|Aborted\(|Target crashed|Page crashed|RangeError: Invalid (?:array|typed array) length/i;

export class BrowserOracle {
  /** @param {{ builds?: string, timeoutMs?: number, recycleEvery?: number, compat?: boolean }} [opts] */
  constructor(opts = {}) {
    this.builds = path.resolve(opts.builds ?? BUILDS);
    const st = cppBrowserStatus(this.builds);
    if (!st.available) throw new Error(`browser oracle unavailable: ${st.reason}`);
    this.ports = { cpp: CPP_PORT, ts: TS_PORT };
    this.timeoutMs = opts.timeoutMs ?? 180000;
    this.recycleEvery = opts.recycleEvery ?? 20;
    this.compat = opts.compat !== false;
    /** @type {import('node:http').Server[]} */
    this.servers = [];
    /** @type {any} */
    this.browser = null;
    this.loads = 0;
    this.instances = 0;
    /** @type {Record<string, any> | null} */
    this.ident = null;
  }

  /** @param {'cpp' | 'ts'} engine */
  origin(engine) {
    return `http://127.0.0.1:${this.ports[engine]}`;
  }

  async start() {
    if (this.servers.length === 0) {
      this.servers.push(await serveStatic(path.join(this.builds, 'cpp'), this.ports.cpp));
      this.servers.push(await serveStatic(path.join(this.builds, 'ts'), this.ports.ts));
    }
    if (this.browser === null || this.loads >= this.recycleEvery) {
      if (this.browser !== null) await this.browser.close().catch(() => {});
      const pw = require(PLAYWRIGHT);
      this.browser = await pw.chromium.launch({
        headless: true,
        args: ['--disable-gpu', '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'],
      });
      this.loads = 0;
      this.instances++;
    }
  }

  /**
   * A fresh context of one build on the board page with the hooks ready; every request off the
   * build's origin is aborted (inline images decode; `res://` images are not fetched).
   * @param {'cpp' | 'ts'} engine
   */
  async openPage(engine) {
    await this.start();
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.clock.install({ time: '2026-01-15T00:00:00Z' });
    const origin = this.origin(engine);
    await page.route('**/*', (/** @type {any} */ route) => {
      const u = route.request().url();
      if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
      return route.abort();
    });
    await page.goto(`${origin}/?offline=true&lekhtest=1`);
    await page.waitForFunction(() => /** @type {any} */ (globalThis).__lekhTest !== undefined, null, {
      timeout: 60000,
    });
    await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.ready());
    return { context, page };
  }

  async identity() {
    if (this.ident !== null) return this.ident;
    /** @type {Record<string, any>} */
    const out = { kind: 'browser', pipeline: 'load-settle-serialize', compat: this.compat };
    for (const engine of /** @type {const} */ (['cpp', 'ts'])) {
      const { context, page } = await this.openPage(engine);
      try {
        out[engine] = await page.evaluate(() => {
          const t = /** @type {any} */ (globalThis).__lekhTest;
          return { engine: t.engine, commit: String(t.build.commit), wasm_sha256: t.build.wasmSha256 ?? null };
        });
      } finally {
        await context.close().catch(() => {});
      }
    }
    out['chromium'] = this.browser.version();
    this.ident = out;
    return out;
  }

  /**
   * Loads, settles and serializes one board in a fresh context of one build.
   * @param {'cpp' | 'ts'} engine
   * @param {string} text
   * @param {{ stamp?: 'app' | 'backend' }} [opts]
   * @returns {Promise<{ ok: boolean, json?: string, error?: string, oom?: boolean, timeout?: boolean, ms: number }>}
   */
  async load(engine, text, opts = {}) {
    const t0 = performance.now();
    const stamp = opts.stamp ?? 'app';
    /** @type {any} */
    let ctx = null;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    try {
      const { context, page } = await this.openPage(engine);
      ctx = context;
      this.loads++;
      let crashed = false;
      page.on('crash', () => {
        crashed = true;
      });
      const work = page.evaluate(
        async (/** @type {{ text: string, stamp: string, ts: boolean, compat: boolean }} */ a) => {
          const t = /** @type {any} */ (globalThis).__lekhTest;
          if (a.ts) t.setConfig({ lineSpacingCompat: a.compat, fontFallbackCompat: a.compat });
          const l = await t.loadDoc(a.text, { name: 'parity.lekh' });
          if (!l.ok) return { ok: false, error: String(l.error) };
          await t.settle();
          return { ok: true, json: String(t.serialize({ stamp: a.stamp })) };
        },
        { text, stamp, ts: engine === 'ts', compat: this.compat },
      );
      const timeout = new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, timeout: true, error: 'browser oracle timeout' }),
          this.timeoutMs,
        );
      });
      /** @type {any} */
      const r = await Promise.race([work, timeout]);
      work.catch(() => {});
      if (r.ok) return { ok: true, json: r.json, ms: performance.now() - t0 };
      if (r.timeout) return { ok: false, timeout: true, error: r.error, ms: performance.now() - t0 };
      return { ok: false, error: r.error, oom: crashed || OOM_TEXT.test(r.error ?? ''), ms: performance.now() - t0 };
    } catch (e) {
      const msg = String(/** @type {Error} */ (e)?.message ?? e);
      // A renderer crash mid-evaluate is the browser's memory limit, not the board's content.
      this.loads = this.recycleEvery;
      return { ok: false, error: msg, oom: OOM_TEXT.test(msg), ms: performance.now() - t0 };
    } finally {
      clearTimeout(timer);
      if (ctx !== null) await ctx.close().catch(() => {});
    }
  }

  async close() {
    if (this.browser !== null) await this.browser.close().catch(() => {});
    this.browser = null;
    for (const srv of this.servers) await new Promise((r) => srv.close(r));
    this.servers = [];
  }
}
