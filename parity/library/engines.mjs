// The two sides of a library batch (verification 02 §C.3). Each engine turns a batch file into an
// image of page 0 and says which build it is:
//
//   const e = createEngine('cpp' | 'ts', 'node' | 'browser', opts)
//   await e.identity()
//   await e.render(text, { crop, scale, padding, fresh })
//     → { ok, img?, origin?, scale?, warnings?, bounds?, error? }
//   await e.close()
//
// `node` (runs today): C++ is the vendored backend wasm (`lbs/kashi/vendor/lekhcore`, the core the
// dev backend runs) drawing through kashi's own render path; TS is `lekhjs/dist/node`. Both draw the
// same crop onto `@napi-rs/canvas` (1.0.9 on both sides), so the images align by construction.
//
// `browser` (the oracle of verification 01 §5): one headless Chromium per engine (Playwright from
// the e2e pin), the static build under `parity/out/builds/<engine>/` served on :4007 (C++) or
// :4008 (TS), driven through `window.__lekhTest` v1: `ready`, (TS) `setConfig`, `loadDoc`,
// `settle`, `exportPage(0, { region: 'drawing', padding, scale, background: true })`, with the
// scale fallback of §B.2 item 2. The C++ build needs the owner's hooked wasm (H1).
//
// `fresh: true` renders in a new worker / browser context (the self-diff of §B.3 rule 3).
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { decodeDataUrl, decodePng } from '../image/diff.mjs';
import { WS, sha256 } from './stencil-set.mjs';

const require = createRequire(import.meta.url);
const { WorkerRunner } = require('../oracle/worker-runner.cjs');

const HERE = import.meta.dirname;
const LEKHJS = path.resolve(HERE, '..', '..');
export const BUILDS = path.resolve(HERE, '..', 'out', 'builds');
export const PORTS = Object.freeze({ cpp: 4007, ts: 4008 });

/**
 * @typedef {{ minx: number, miny: number, maxx: number, maxy: number }} Box
 * @typedef {{ crop: Box | null, scale: number, padding: number, fresh?: boolean,
 *   frame?: { x: number, y: number, width: number, height: number } | null }} RenderOpts
 * @typedef {{ ok: boolean, img?: import('../image/diff.mjs').Rgba, origin?: { x: number, y: number }, scale?: number,
 *   warnings?: { level: string, code: string, data?: unknown }[], bounds?: Box | null, error?: string, code?: string }} RenderResult
 */

class NodeEngine {
  /**
   * @param {'cpp' | 'ts'} engine
   * @param {string} file   worker script
   * @param {Record<string, unknown>} data
   */
  constructor(engine, file, data) {
    this.engine = engine;
    this.runtime = 'node';
    this.runner = new WorkerRunner(file, data, { recycleEvery: 1000, timeoutMs: 180000, log: process.stderr });
  }

  /** @param {Record<string, unknown>} msg */
  async call(msg) {
    try {
      return await this.runner.call(msg);
    } catch (e) {
      const err = /** @type {{ timeout?: boolean, workerExit?: boolean, message: string }} */ (e);
      if (err.timeout) return { ok: false, code: 'timeout', error: 'timeout' };
      if (err.workerExit) return { ok: false, code: 'worker_exit', error: err.message };
      throw e;
    }
  }

  /**
   * @param {string} text
   * @param {RenderOpts} opts
   * @returns {Promise<RenderResult>}
   */
  async render(text, opts) {
    if (opts.crop === null) throw new Error(`${this.engine} node engine: a crop is required`);
    if (opts.fresh) await this.runner.recycle();
    const r = await this.call({ op: 'render', text, crop: opts.crop, scale: opts.scale, background: true });
    if (!r.ok) return r;
    return {
      ok: true,
      img: decodePng(r.png),
      origin: { x: opts.crop.minx, y: opts.crop.miny },
      scale: opts.scale,
      warnings: r.warnings ?? [],
      bounds: r.bounds ?? null,
    };
  }

  close() {
    return this.runner.close();
  }
}

export class NodeCppEngine extends NodeEngine {
  /** @param {{ kashi?: string }} [opts] */
  constructor(opts = {}) {
    const kashi = path.resolve(opts.kashi ?? process.env['LEKH_KASHI_DIR'] ?? path.join(WS, 'lbs', 'kashi'));
    const wasm = path.join(kashi, 'vendor', 'lekhcore', 'lekhcore.wasm');
    if (!existsSync(wasm)) throw new Error(`cpp node engine: no backend wasm at ${wasm}`);
    super('cpp', path.join(HERE, 'cpp-node-worker.cjs'), { kashi });
    this.kashi = kashi;
    this.wasm = wasm;
  }

  async identity() {
    const init = await this.runner.init();
    const info = init.buildInfo ?? {};
    return {
      engine: 'cpp',
      runtime: 'node',
      artefact: 'lbs/kashi/vendor/lekhcore',
      commit: info.lekhcore_commit ?? null,
      lekhemsdk_commit: info.lekhemsdk_commit ?? null,
      wasm_sha256: sha256(readFileSync(this.wasm)),
      heap_max: init.heapMax ?? null,
    };
  }

  /**
   * The page bounds of the C++ projection (what `board_render` crops a page to).
   * @param {string} text
   * @returns {Promise<{ ok: boolean, bounds?: Box, error?: string }>}
   */
  bounds(text) {
    return this.call({ op: 'bounds', text });
  }
}

export class NodeTsEngine extends NodeEngine {
  /** @param {{ lekhjs?: string, compat?: boolean }} [opts] */
  constructor(opts = {}) {
    const lekhjs = path.resolve(opts.lekhjs ?? LEKHJS);
    const info = path.join(lekhjs, 'dist', 'build-info.json');
    if (!existsSync(info)) throw new Error(`ts node engine: ${info} is missing; run npm run build in ${lekhjs}`);
    const sets = JSON.parse(readFileSync(path.join(LEKHJS, 'parity', 'fixture-sets.json'), 'utf8'));
    const stencilsV4 = path.resolve(LEKHJS, sets.stencilsV4);
    super('ts', path.join(HERE, 'ts-node-worker.mjs'), { lekhjs, stencilsV4, compat: opts.compat !== false });
    this.lekhjs = lekhjs;
  }

  async identity() {
    const init = await this.runner.init();
    const b = init.buildInfo ?? {};
    return {
      engine: 'ts',
      runtime: 'node',
      dist: this.lekhjs,
      commit: b.commit ?? null,
      dirty: b.dirty ?? null,
      files_sha256: b.files_sha256 ?? null,
      catalog_files: init.files,
      paint_page: init.paintPage,
      node_runtime: init.nodeRuntime,
      compat: init.compat,
    };
  }
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
  '.woff2': 'font/woff2',
});

/**
 * A static server for one build directory, on 127.0.0.1 (never 4000-4003).
 * @param {string} root
 * @param {number} port
 */
function serveStatic(root, port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

export class BrowserEngine {
  /**
   * @param {'cpp' | 'ts'} engine
   * @param {{ builds?: string, port?: number, compat?: boolean, headless?: boolean }} [opts]
   */
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.runtime = 'browser';
    this.root = path.resolve(opts.builds ?? BUILDS, engine);
    if (!existsSync(path.join(this.root, 'index.html'))) {
      throw new Error(
        `${engine} browser engine: no build at ${this.root}` +
          (engine === 'cpp'
            ? " (the C++ web build with the __lekhTest hooks needs the owner's H-ROL-1 wasm, task H1;" +
              ' then npx vite build --outDir <that dir> from the oracle worktree lekh-wt/lekhjs-port/oracle/lekhboardwebapp/v2)'
            : ' (the TS board build, phase 6)'),
      );
    }
    this.port = opts.port ?? PORTS[engine];
    this.compat = opts.compat !== false;
    this.headless = opts.headless !== false;
    /** @type {any} */
    this.server = null;
    /** @type {any} */
    this.browser = null;
    /** @type {any} */
    this.build = null;
    this.blocked = 0;
  }

  async start() {
    if (this.browser !== null) return;
    this.server = await serveStatic(this.root, this.port);
    const pw = require(path.join(WS, 'e2e', 'node_modules', 'playwright'));
    this.browser = await pw.chromium.launch({
      headless: this.headless,
      args: ['--disable-gpu', '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'],
    });
  }

  async newPage() {
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
    const origin = `http://localhost:${this.port}`;
    await page.route('**/*', (/** @type {any} */ route) => {
      const u = route.request().url();
      if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
      this.blocked++;
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
    const { context, page } = await this.newPage();
    try {
      const hooks = await page.evaluate(() => {
        const t = /** @type {any} */ (globalThis).__lekhTest;
        return { version: t.version, engine: t.engine, build: t.build };
      });
      if (hooks.version !== 1)
        throw new Error(`${this.engine} browser engine: __lekhTest.version is ${hooks.version}, not 1`);
      if (hooks.engine !== this.engine)
        throw new Error(`${this.engine} browser engine: the build says engine ${hooks.engine}`);
      this.build = hooks.build;
      return { engine: this.engine, runtime: 'browser', root: this.root, port: this.port, build: hooks.build };
    } finally {
      await context.close();
    }
  }

  /**
   * @param {string} text
   * @param {RenderOpts} opts
   * @returns {Promise<RenderResult>}
   */
  async render(text, opts) {
    const { context, page } = await this.newPage();
    const blockedBefore = this.blocked;
    try {
      const out = await page.evaluate(
        async (
          /** @type {{ text: string, padding: number, scale: number, compat: boolean, ts: boolean, frame: any }} */ a,
        ) => {
          const t = /** @type {any} */ (globalThis).__lekhTest;
          if (a.ts && typeof t.setConfig === 'function')
            t.setConfig({ lineSpacingCompat: a.compat, fontFallbackCompat: a.compat });
          const r = await t.loadDoc(a.text, { name: 'library-batch' });
          if (!r.ok) return { ok: false, error: String(r.error) };
          await t.settle();
          // §B.2 item 2: an empty export is retried at 0.5, then 0.25.
          for (const s of [a.scale, a.scale / 2, a.scale / 4]) {
            const e = await t.exportPage(0, {
              region: 'drawing',
              padding: a.padding,
              scale: s,
              background: true,
              ...(a.frame ? { frame: a.frame } : {}),
            });
            if (e.dataUrl !== 'data:,') return { ok: true, ...e };
          }
          return { ok: false, error: 'empty export at every scale' };
        },
        {
          text,
          padding: opts.padding,
          scale: opts.scale,
          compat: this.compat,
          ts: this.engine === 'ts',
          frame: this.engine === 'ts' ? (opts.frame ?? null) : null,
        },
      );
      if (this.blocked !== blockedBefore)
        return { ok: false, code: 'harness', error: `${this.blocked - blockedBefore} blocked requests` };
      if (!out.ok) return { ok: false, error: out.error };
      const img = decodeDataUrl(out.dataUrl);
      if (img === null) return { ok: false, error: 'export is not a PNG data URL' };
      return { ok: true, img, origin: out.origin, scale: out.scale, warnings: [], bounds: null };
    } finally {
      await context.close();
    }
  }

  async close() {
    if (this.browser !== null) await this.browser.close();
    if (this.server !== null) await new Promise((r) => this.server.close(r));
    this.browser = null;
    this.server = null;
  }
}

/**
 * @param {'cpp' | 'ts'} engine
 * @param {'node' | 'browser'} runtime
 * @param {{ lekhjs?: string, kashi?: string, builds?: string, compat?: boolean }} [opts]
 */
export function createEngine(engine, runtime, opts = {}) {
  if (runtime === 'browser') return new BrowserEngine(engine, opts);
  return engine === 'cpp' ? new NodeCppEngine(opts) : new NodeTsEngine(opts);
}
