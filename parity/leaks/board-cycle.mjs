// L-01 (verification 03 §5, T20): open / edit / close × 50 on the TS web build, one headless
// Chromium (the e2e Playwright pin), the build served statically on 127.0.0.1:4008. Each cycle:
// loadDoc (S-syn diagram 685) → an edit script through the board's own UI → closeBoard; then two
// forced GCs, `Runtime.getHeapUsage` and `Memory.getDOMCounters`. Heap snapshots at cycles 10 and
// 50 and after a final close are analysed with memlab (`@memlab/heap-analysis`): instances of the
// engine classes left on the heap, detached canvases, image bitmaps and workers.
//
// Bars: JS heap at cycle 50 − heap at cycle 10 < 1 MB and the least-squares slope over cycles
// 10–50 < 25 KB/cycle; DOM nodes and listeners flat (± 1 %) over cycles 10–50; 0 retained
// BoardSession / InteractionSession / LekhDocument / ObjectStore, 0 detached HTMLCanvasElement,
// 0 ImageBitmap, no extra Worker after the final close.
//
// The class names are read from the heap, so the build under test must keep them: build it with
// `npx vite build --minify false --outDir <dir>` (the minified release bundle renames classes).
//
//   node parity/leaks/board-cycle.mjs --build <dir> [--cycles 50] [--out <dir>] [--cpp <dir>]
//
// `--cpp <dir>` also runs the cycle count against the C++ build for reference (not gating; the
// C++ board cannot be unmounted, its closeBoard loads an empty document).
import {
  createReadStream,
  readFileSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
  createWriteStream,
  realpathSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { holdHeavyLock } from '../tools/lock.mjs';
import { synthBoard } from '../bench/synth.mjs';

holdHeavyLock();

const require = createRequire(import.meta.url);
const HERE = import.meta.dirname;
const PARITY = path.resolve(HERE, '..');
const WS = path.resolve(PARITY, '..', '..');
const { values: opt } = parseArgs({
  options: {
    build: { type: 'string' },
    cycles: { type: 'string', default: '50' },
    out: {
      type: 'string',
      default: path.join(PARITY, 'out', 'leaks', `l01-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`),
    },
    engine: { type: 'string', default: 'ts' },
    // Diagnosis: edit-script steps left out (comma-separated names, e.g. "insert image").
    skip: { type: 'string', default: '' },
  },
});
const SKIP = new Set(
  String(opt.skip)
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== ''),
);
if (!opt.build) {
  process.stderr.write(
    'usage: board-cycle.mjs --build <dir> [--cycles 50] [--out <dir>] [--engine ts|cpp] [--skip <steps>]\n',
  );
  process.exit(2);
}
const CYCLES = Number(opt.cycles);
const OUT = path.resolve(opt.out);
mkdirSync(OUT, { recursive: true });
const PORT = opt.engine === 'cpp' ? 4007 : 4008;
const ENGINE = opt.engine === 'cpp' ? 'cpp' : 'ts';

const MIME = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
});
const root = realpathSync(path.resolve(opt.build));
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) return void res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(null)));

const board = (() => {
  const b = synthBoard('diagram', 685, { pages: 1, seed: 685 });
  return typeof b === 'string' ? b : JSON.stringify(b);
})();
// A synthetic 256 × 256 PNG for the image insert.
const imgFile = path.join(OUT, 'synthetic.png');
{
  const { PNG } = require(path.join(PARITY, 'node_modules', 'pngjs'));
  const png = new PNG({ width: 256, height: 256 });
  for (let i = 0; i < 256 * 256; i++) {
    png.data[i * 4] = i % 256;
    png.data[i * 4 + 1] = (i >> 8) % 256;
    png.data[i * 4 + 2] = 128;
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(imgFile, PNG.sync.write(png));
}

const pw = require(path.join(WS, 'e2e', 'node_modules', 'playwright'));
const browser = await pw.chromium.launch({ headless: true, args: ['--disable-gpu'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const origin = `http://localhost:${PORT}`;
let blocked = 0;
await page.route('**/*', (/** @type {any} */ r) => {
  const u = r.request().url();
  if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
  blocked++;
  return r.abort();
});
// The insert-image file picker is answered in the page: a click on an <input type=file> sets the
// synthetic PNG as its files and fires `change`, as the browser does after a pick. Playwright's
// intercepted file chooser (page.waitForEvent('filechooser')) keeps every input it served alive in
// Blink, ~10 DOM nodes and 2 listeners per pick, measured on a bare page with no board at all; it
// would charge the harness's own retention to the board.
await page.addInitScript(
  (/** @type {number[]} */ bytes) => {
    const g = /** @type {any} */ (globalThis);
    const proto = g.HTMLInputElement.prototype;
    const click = proto.click;
    proto.click = /** @this {any} */ function () {
      if (this.type !== 'file') return click.call(this);
      const dt = new g.DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], 'synthetic.png', { type: 'image/png' }));
      this.files = dt.files;
      setTimeout(() => this.dispatchEvent(new Event('change', { bubbles: true })), 0);
    };
  },
  [...readFileSync(imgFile)],
);
await page.addInitScript(() => {
  try {
    localStorage.setItem('files:settings/userskill', JSON.stringify({ misc_skill: { info_dialog_acked: true } }));
  } catch {
    /* no storage */
  }
});
await page.goto(`${origin}/?offline=true&lekhtest=1`);
await page.waitForFunction(() => /** @type {any} */ (globalThis).__lekhTest !== undefined, null, { timeout: 60000 });
await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.ready());
const cdp = await context.newCDPSession(page);
await cdp.send('HeapProfiler.enable');

async function gcAndMeasure() {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const targets = await cdp.send('Target.getTargets').catch(() => ({ targetInfos: [] }));
  const workers = (targets.targetInfos ?? []).filter((/** @type {any} */ t) => t.type === 'worker').length;
  return {
    used: heap.usedSize,
    total: heap.totalSize,
    documents: dom.documents,
    nodes: dom.nodes,
    listeners: dom.jsEventListeners,
    workers,
  };
}

async function snapshot(/** @type {string} */ name) {
  const file = path.join(OUT, `${name}.heapsnapshot`);
  const ws = createWriteStream(file);
  const onChunk = (/** @type {any} */ e) => ws.write(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await new Promise((r) => ws.end(r));
  return file;
}

/** Runs a UI step; records whether it ran (the step list is part of the result). */
async function step(
  /** @type {Record<string, number>} */ done,
  /** @type {string} */ name,
  /** @type {() => Promise<void>} */ f,
) {
  if (SKIP.has(name)) return;
  try {
    await f();
    done[name] = (done[name] ?? 0) + 1;
  } catch {
    done[`${name}:skipped`] = (done[`${name}:skipped`] ?? 0) + 1;
    await page.keyboard.press('Escape').catch(() => {});
  }
}

/** The edit script of L-01 through the TS board's own UI. */
async function editScript(/** @type {Record<string, number>} */ done) {
  const T = (/** @type {string} */ id) => page.getByTestId(id).first();
  const view = await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.getView());
  // Empty space: the view moved left of the content, where a right-click offers the add items.
  await page.evaluate(
    (/** @type {any} */ v) => /** @type {any} */ (globalThis).__lekhTest.setView({ zoom: 1, tx: 900, ty: v.ty }),
    view,
  );
  await page.keyboard.press('v');
  for (let i = 0; i < 20; i++) {
    await step(done, 'add shape', async () => {
      const x = 120 + (i % 5) * 140;
      const y = 140 + Math.floor(i / 5) * 140;
      await page.mouse.click(x, y, { button: 'right' });
      const item = page.locator('[data-testid="popover-contextMenu"] [data-item-id="add_rect"]');
      await item.waitFor({ state: 'visible', timeout: 3000 });
      await item.click();
      await page.keyboard.press('Escape');
    });
  }
  // 5 connector strokes between neighbouring shapes in smart-draw mode (recognised in the worker).
  await page.keyboard.press('s');
  for (let i = 0; i < 5; i++) {
    await step(done, 'connect stroke', async () => {
      const y = 140 + i * 140 > 700 ? 140 : 140 + (i % 4) * 140;
      await page.mouse.move(150, y);
      await page.mouse.down();
      for (let k = 1; k <= 10; k++) await page.mouse.move(150 + k * 8, y);
      await page.mouse.up();
    });
  }
  await page.waitForTimeout(300);
  // A 3-line label with the text tool.
  await step(done, 'text label', async () => {
    await page.keyboard.press('t');
    await page.mouse.click(900, 650);
    await page.keyboard.type('alpha');
    await page.keyboard.press('Enter');
    await page.keyboard.type('beta');
    await page.keyboard.press('Enter');
    await page.keyboard.type('gamma');
    await page.keyboard.press('Escape');
  });
  // Move 10 shapes (select tool, drag).
  await page.keyboard.press('v');
  for (let i = 0; i < 10; i++) {
    await step(done, 'move shape', async () => {
      const x = 120 + (i % 5) * 140;
      const y = 140 + Math.floor(i / 5) * 140;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 10, y + 6, { steps: 4 });
      await page.mouse.up();
    });
  }
  for (let i = 0; i < 5; i++) await step(done, 'undo', () => page.keyboard.press('Control+z'));
  for (let i = 0; i < 5; i++) await step(done, 'redo', () => page.keyboard.press('Control+Shift+z'));
  // The selection menu, and the font picker from it.
  await step(done, 'selection menu', async () => {
    await page.mouse.click(120, 140);
    await T('selection-menu').waitFor({ state: 'visible', timeout: 3000 });
  });
  await step(done, 'font picker', async () => {
    // The text attributes' font row (as board-screens-web.spec.js reaches it).
    const onBar = page.locator('[data-testid="selection-menu"] [data-action-id="text_attr"]');
    if ((await onBar.count()) > 0) await onBar.first().click({ timeout: 2000 });
    else {
      await page.locator('[data-testid="selection-menu"] [data-action-id="expand"]').click({ timeout: 2000 });
      await page
        .locator('[data-testid="popover-selectionOverflow"] [data-item-id="text_attr"]')
        .click({ timeout: 2000 });
    }
    await T('text-attr-font').click({ timeout: 2000 });
    await T('nav-font-family').waitFor({ state: 'visible', timeout: 3000 });
    for (let k = 0; k < 3; k++) await page.keyboard.press('Escape');
  });
  await page.keyboard.press('Escape');
  await step(done, 'export dialog', async () => {
    await T('board_options_btn').click({ timeout: 3000 });
    await page.getByTestId('popover-boardOptions').getByTestId('board-option-export').click({ timeout: 3000 });
    await page
      .getByTestId('popover-boardOptions')
      .getByTestId('export-panel')
      .waitFor({ state: 'visible', timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
  await step(done, 'library panel', async () => {
    await T('shapes_btn').click({ timeout: 3000 });
    await T('shape-library').waitFor({ state: 'visible', timeout: 3000 });
    await T('shapes_btn').click({ timeout: 3000 });
  });
  await step(done, 'insert image', async () => {
    const before = await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.objects().length);
    await page.mouse.click(900, 300, { button: 'right' });
    await page.locator('[data-testid="popover-contextMenu"] [data-item-id="insert_image"]').click({ timeout: 3000 });
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.objects().length);
    if (!(after > before)) throw new Error('no image inserted');
    // The inserted image decoded and drawn before the next step (settle alone no longer waits for
    // images since IM1; the TS hook only, which is the only engine that runs the edit script).
    await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.settle({ images: true }));
  });
  await step(done, 'pan zoom', async () => {
    await page.evaluate(() => {
      const t = /** @type {any} */ (globalThis).__lekhTest;
      const v = t.getView();
      for (let k = 0; k < 30; k++) {
        const z = k < 15 ? 1 + k * 0.1 : 2.5 - (k - 15) * 0.1;
        t.setView({ zoom: z, tx: v.tx - k * 20, ty: v.ty });
        t.drawFrame();
      }
    });
  });
}

/** @type {any[]} */
const series = [];
/** @type {Record<string, number>} */
const steps = {};
const t0 = Date.now();
for (let c = 1; c <= CYCLES; c++) {
  const r = await page.evaluate(async (/** @type {string} */ text) => {
    const t = /** @type {any} */ (globalThis).__lekhTest;
    const ld = await t.loadDoc(text, { name: 'leak' });
    await t.settle();
    return ld;
  }, board);
  if (!r.ok) throw new Error(`cycle ${c}: loadDoc failed: ${r.error}`);
  if (ENGINE === 'ts') await editScript(steps);
  // The test hooks log every session notification and frame since resetCounters (events(),
  // syncLog()) and keep that log across closeBoard; emptied first so the hooks' own log (about
  // 18 KB per cycle of this edit script) is not charged to the board.
  if (ENGINE === 'ts') await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.resetCounters());
  await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.closeBoard());
  await page.waitForTimeout(200);
  const m = await gcAndMeasure();
  // What the page holds outside the board after the close (tag counts), to find DOM growth.
  const tags = await page.evaluate(() => {
    /** @type {Record<string, number>} */
    const out = {};
    for (const el of /** @type {any} */ (globalThis).document.body.querySelectorAll('*'))
      out[el.tagName] = (out[el.tagName] ?? 0) + 1;
    return out;
  });
  series.push({ cycle: c, ...m, tags });
  process.stdout.write(
    `cycle ${c}: heap ${(m.used / 1048576).toFixed(2)} MB, nodes ${m.nodes}, listeners ${m.listeners}, workers ${m.workers}\n`,
  );
  if (c === 10 || c === CYCLES) await snapshot(`cycle-${c}`);
}
const finalSnap = await snapshot('final');

// ---- analysis ----
const from10 = series.filter((s) => s.cycle >= 10);
const slope = (() => {
  const n = from10.length;
  if (n < 2) return 0;
  const mx = from10.reduce((a, s) => a + s.cycle, 0) / n;
  const my = from10.reduce((a, s) => a + s.used, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of from10) {
    num += (s.cycle - mx) * (s.used - my);
    den += (s.cycle - mx) ** 2;
  }
  return num / den;
})();
const at = (/** @type {number} */ c) => series.find((s) => s.cycle === c);
const s10 = at(10);
const sN = at(CYCLES);
const flat = (/** @type {'nodes' | 'listeners'} */ k) => {
  const xs = from10.map((s) => s[k]);
  const base = s10?.[k] ?? 0;
  return {
    min: Math.min(...xs),
    max: Math.max(...xs),
    base,
    within_1pct: xs.every((x) => Math.abs(x - base) <= Math.max(1, 0.01 * base)),
  };
};

const { getFullHeapFromFile } = require(path.join(HERE, 'node_modules', '@memlab', 'heap-analysis'));
const CLASSES = [
  'BoardSession',
  'InteractionSession',
  'LekhDocument',
  'ObjectStore',
  'BoardHost',
  'ImageBitmap',
  'Worker',
];
async function census(/** @type {string} */ file) {
  const heap = await getFullHeapFromFile(file);
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  let detachedCanvas = 0;
  let canvas = 0;
  heap.nodes.forEach((/** @type {any} */ n) => {
    // Instances only: not a class's prototype object, nor a Blink wrapper template's key.
    if (n.type === 'object' && counts[n.name] !== undefined) {
      const proto = n.referrers.some(
        (/** @type {any} */ e) =>
          e.name_or_index === 'prototype' || String(e.fromNode?.name ?? '').startsWith('system / ObjectTemplateInfo'),
      );
      if (!proto) counts[n.name] = (counts[n.name] ?? 0) + 1;
    }
    if (n.name.includes('HTMLCanvasElement')) {
      canvas++;
      if (n.name.startsWith('Detached') || n.is_detached === true) detachedCanvas++;
    }
  });
  /** @type {Record<string, number>} */
  const out = { ...counts, HTMLCanvasElement: canvas, detached_HTMLCanvasElement: detachedCanvas };
  return out;
}
const maybe = async (/** @type {string} */ f) => (existsSync(f) ? census(f) : null);
const retained = {
  cycle10: await maybe(path.join(OUT, 'cycle-10.heapsnapshot')),
  cycleN: await maybe(path.join(OUT, `cycle-${CYCLES}.heapsnapshot`)),
  final: await census(finalSnap),
};
const f = retained.final;
const bars = {
  heap_growth_10_to_N_bytes: sN && s10 ? sN.used - s10.used : null,
  heap_growth_ok: sN && s10 ? sN.used - s10.used < 1048576 : false,
  slope_bytes_per_cycle: slope,
  slope_ok: slope < 25 * 1024,
  dom_nodes: flat('nodes'),
  listeners: flat('listeners'),
  retained_ok:
    f.BoardSession === 0 &&
    f.InteractionSession === 0 &&
    f.LekhDocument === 0 &&
    f.ObjectStore === 0 &&
    f.detached_HTMLCanvasElement === 0 &&
    f.ImageBitmap === 0,
  workers_final: series.at(-1)?.workers ?? null,
};
const pass =
  bars.heap_growth_ok && bars.slope_ok && bars.dom_nodes.within_1pct && bars.listeners.within_1pct && bars.retained_ok;
const result = {
  schema: 'leak-result/1',
  test: 'L-01',
  engine: ENGINE,
  build: root,
  build_id: await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest?.build ?? null).catch(() => null),
  cycles: CYCLES,
  skipped_steps: [...SKIP],
  minutes: (Date.now() - t0) / 60000,
  steps,
  blocked,
  bars,
  retained,
  pass,
  series,
  env: { load: os.loadavg(), node: process.version, chromium: browser.version() },
};
writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
process.stdout.write(JSON.stringify({ pass, bars, retained, steps }, null, 1) + `\nout: ${OUT}\n`);
await browser.close();
server.closeAllConnections();
await new Promise((r) => server.close(r));
