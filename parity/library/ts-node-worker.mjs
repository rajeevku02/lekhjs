// The TS side of a library batch in Node (`--ts node`): `lekhjs/dist/node` (built from the commit
// under test) with the catalogue the JSON comparison's TS runner uses (lekhboard v4, then
// `lekhjs/stencils/{core,builtin}`), the compat switches of the gate run on unless `compat: false`
// (spec 06 §3.6, verification 02 §B.5), a fixed clock and counter ids, and a logger that keeps every
// warning so the run can refuse `unknown_generator` and `generator_failed` (§C.3 step 5).
//
// The page is drawn as the backend draws it: `paintPage` from `lekhjs/headless` once it is exported
// (task B1); before that, `BoardSession.layoutAll` and an export paint of the page through
// `Canvas2DDrawingPlatform`, which is what `paintPage` does.
//
// Messages: `{ op: 'init' }`; `{ op: 'render', text, crop, scale, background }` →
// `{ ok, png?, width?, height?, warnings, bounds?, code?, error? }`; `bounds` is the union of the
// top-level objects' visual bounds.
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
let testing = null;
/** @type {any} */
let runtime = null;
let counter = 0;
const ids = { next: () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}` };
/** @type {{ level: string, code: string, data?: unknown }[]} */
let warnings = [];

const keep = (/** @type {string} */ level) => (/** @type {string} */ code, /** @type {unknown} */ data) => {
  warnings.push({ level, code: String(code), ...(data === undefined ? {} : { data }) });
};
const logger = Object.freeze({ debug() {}, info() {}, warn: keep('warn'), error: keep('error') });

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
    runtime = headless.createNodeRuntime({ canvas, catalog, clock: CLOCK, ids, testing: switches, logger });
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
      logger,
    });
  }
  const info = JSON.parse(readFileSync(path.join(PKG, 'dist', 'build-info.json'), 'utf8'));
  return {
    buildInfo: info,
    files: files.length,
    paintPage: typeof headless.paintPage === 'function',
    nodeRuntime: typeof headless.createNodeRuntime === 'function',
    compat: { lineSpacingCompat: switches.lineSpacingCompat, fontFallbackCompat: switches.fontFallbackCompat },
  };
}

/** @param {any} session */
function topLevelBounds(session) {
  const page = session.document.pages[0];
  if (page === undefined) return null;
  let b = null;
  for (const obj of page.objectStore.objects ?? []) {
    const r = session.visualBounds(page.id, obj.id);
    if (r === null) continue;
    const minx = r.x;
    const miny = r.y;
    const maxx = r.x + r.width;
    const maxy = r.y + r.height;
    b =
      b === null
        ? { minx, miny, maxx, maxy }
        : {
            minx: Math.min(b.minx, minx),
            miny: Math.min(b.miny, miny),
            maxx: Math.max(b.maxx, maxx),
            maxy: Math.max(b.maxy, maxy),
          };
  }
  return b;
}

/** @param {{ text: string, crop: { minx: number, miny: number, maxx: number, maxy: number }, scale: number, background: boolean }} msg */
function render(msg) {
  counter = 0;
  warnings = [];
  const session = new headless.BoardSession(runtime, {
    images: new testing.FakeImagePort(),
    scheduler: new testing.FakeScheduler(),
  });
  try {
    const r = session.load(msg.text);
    if (!r.ok) return { ok: false, code: r.code, error: r.message, warnings };
    const page = session.document.pages[0];
    if (page === undefined) return { ok: false, code: 'no_page', error: 'no page', warnings };
    const { crop, scale } = msg;
    const width = Math.max(1, Math.round((crop.maxx - crop.minx) * scale));
    const height = Math.max(1, Math.round((crop.maxy - crop.miny) * scale));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (msg.background) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-crop.minx, -crop.miny);
    const dp = new headless.Canvas2DDrawingPlatform(ctx, { textPainter: runtime.textPainter });
    if (typeof headless.paintPage === 'function') {
      const a = headless.paintPage(session, { page: page.id }, dp);
      if (!a.ok) return { ok: false, code: 'paint_refused', error: a.message, warnings };
    } else {
      session.layoutAll(page.id);
      const images = { get: (/** @type {string} */ url) => session.imageCache.get(url) };
      page.paint(dp, { env: { config: runtime.config, zoom: 1, forExport: true, images } });
    }
    ctx.restore();
    const bounds = topLevelBounds(session);
    return { ok: true, png: canvas.toBuffer('image/png'), width, height, warnings, bounds };
  } catch (e) {
    const err = /** @type {{ code?: string, message?: string, stack?: string }} */ (e);
    return {
      ok: false,
      code: typeof err?.code === 'string' ? err.code : 'exception',
      error: String(err?.stack ?? err?.message ?? e),
      warnings,
    };
  } finally {
    session.dispose();
  }
}

parentPort?.on('message', async (/** @type {any} */ msg) => {
  try {
    const value = msg.op === 'init' ? await init() : render(msg);
    parentPort?.postMessage({ id: msg.id, value });
  } catch (e) {
    parentPort?.postMessage({ id: msg.id, error: String(/** @type {Error} */ (e)?.stack ?? e) });
  }
});
