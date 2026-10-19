// L-02 (verification 03 §5, T20), offline variant: one long editing session on the TS web build in
// one headless Chromium (the e2e Playwright pin), the build served statically on 127.0.0.1:4008.
//
// The spec's L-02 runs on the agent-mode stack with a cloud board and a second browser context as
// the collaborator. This variant needs no backend (the box's kashi is the owner's live dev
// backend): the board is S-syn diagram 685 opened offline, and the collaborator is replaced by
// realtime frames fed to the board's own update path every 2 s (docid '' as an offline board's) (`__lekhTest.applyFrames`: a
// `changeattr` that moves one shape back and forth, and an `addobjects` / `delobjects` pair). The
// socket itself is not exercised.
//
// Context A, in a loop until --minutes: pan and zoom (30 drawFrame steps), 3 shapes added from the
// context menu, 2 freehand strokes with the pen, a shape dragged, a 2-line text label, then undo
// back to the depth the iteration started at (so the board does not grow), and redo / undo once
// more; a PNG export through the export dialog every 5 minutes. Every 60 s: the JS heap after two
// forced GCs, the DOM counters, and the p95 of the drawFrame times of the last minute.
//
// Bars: from minute 5 on, the least-squares heap slope < 1 MB per 10 min; the final heap ≤ 1.2 × the
// heap at minute 5; the frame p95 of the last 5 minutes ≤ 1.1 × that of minutes 1–5; no long task
// > 1 s.
//
//   node parity/leaks/long-session.mjs --build <dir> [--minutes 30] [--out <dir>]
import { createReadStream, existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
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
    minutes: { type: 'string', default: '30' },
    out: {
      type: 'string',
      default: path.join(PARITY, 'out', 'leaks', `l02-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`),
    },
  },
});
if (!opt.build) {
  process.stderr.write('usage: long-session.mjs --build <dir> [--minutes 30] [--out <dir>]\n');
  process.exit(2);
}
const MINUTES = Number(opt.minutes);
const OUT = path.resolve(opt.out);
mkdirSync(OUT, { recursive: true });
const PORT = 4008;

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
  // COOP/COEP as the bench pages (verification 03 §3.1): 5 µs performance.now() for the frame times.
  res.writeHead(200, {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'same-origin',
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(null)));

const boardObj = /** @type {any} */ (synthBoard('diagram', 685, { pages: 1, seed: 685 }));
const board = JSON.stringify(boardObj);
const pageId = Object.keys(boardObj.pages)[0] ?? '';
const objs = boardObj.pages[pageId].objects;
const moverId = Object.keys(objs).find((k) => objs[k].type === 'templated') ?? '';
const mover = objs[moverId];
const prefix = `doc.pages.${pageId}.objects.`;

const pw = require(path.join(WS, 'e2e', 'node_modules', 'playwright'));
const browser = await pw.chromium.launch({ headless: true, args: ['--disable-gpu'] });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  acceptDownloads: true,
});
const page = await context.newPage();
const origin = `http://localhost:${PORT}`;
let blocked = 0;
await page.route('**/*', (/** @type {any} */ r) => {
  const u = r.request().url();
  if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
  blocked++;
  return r.abort();
});
await page.addInitScript(() => {
  const g = /** @type {any} */ (globalThis);
  g.__longTasks = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) g.__longTasks.push({ at: performance.timeOrigin + e.startTime, ms: e.duration });
    }).observe(/** @type {any} */ ({ type: 'longtask', buffered: true }));
  } catch {
    /* no longtask support */
  }
  try {
    localStorage.setItem('files:settings/userskill', JSON.stringify({ misc_skill: { info_dialog_acked: true } }));
    localStorage.removeItem('setting_last_export_params');
  } catch {
    /* no storage */
  }
});
await page.goto(`${origin}/?offline=true&lekhtest=1`);
await page.waitForFunction(() => /** @type {any} */ (globalThis).__lekhTest !== undefined, null, { timeout: 60000 });
const load = await page.evaluate(async (/** @type {string} */ text) => {
  const t = /** @type {any} */ (globalThis).__lekhTest;
  await t.ready();
  const r = await t.loadDoc(text, { name: 'L02.lekh' });
  await t.settle();
  return r;
}, board);
if (!load.ok) throw new Error(`loadDoc failed: ${load.error}`);
const cdp = await context.newCDPSession(page);
await cdp.send('HeapProfiler.enable');

// ---- the collaborator stand-in: a realtime frame every 2 s ----
let version = 1000;
let tick = 0;
const remote = { sent: 0, applied: 0 };
async function collaborate() {
  tick++;
  /** @type {string[]} */
  const frames = [];
  const f = (/** @type {string} */ type, /** @type {any} */ changes) =>
    JSON.stringify({ version: ++version, docid: '', type: 'update', updates: { type, changes, conditions: {} } });
  frames.push(f('changeattr', { [`${prefix}${moverId}.params.cx`]: mover.params.cx + (tick % 2 === 0 ? 0 : 20) }));
  const nid = `00000000-0000-4000-9000-${(tick % 2).toString(16).padStart(12, '0')}`;
  if (tick % 4 === 1)
    frames.push(f('addobjects', { [`${prefix}${nid}`]: { ...mover, params: { ...mover.params, cx: 50, cy: 50 } } }));
  if (tick % 4 === 3) frames.push(f('delobjects', { [`${prefix}${nid}`]: null }));
  const r = await page.evaluate(
    (/** @type {string[]} */ fs) => /** @type {any} */ (globalThis).__lekhTest.applyFrames(fs),
    frames,
  );
  remote.sent += frames.length;
  remote.applied += r.applied;
}

// ---- context A ----
/** @type {{ at: number, ms: number }[]} */
const frameTimes = [];
const steps = /** @type {Record<string, number>} */ ({});
/** Wall-clock windows of each activity, to attribute a long task to what the page was doing. */
/** @type {{ name: string, t0: number, t1: number }[]} */
const windows = [];
async function timed(/** @type {string} */ name, /** @type {() => Promise<any>} */ fn) {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    windows.push({ name, t0, t1: Date.now() });
  }
}
/** Iterations whose undo did not bring the object count back, with the kinds left over. */
/** @type {{ iteration: number, before: number, after: number, left: string[] }[]} */
const leftovers = [];
async function step(/** @type {string} */ name, /** @type {() => Promise<void>} */ fn) {
  try {
    await timed(name, fn);
    steps[name] = (steps[name] ?? 0) + 1;
  } catch {
    steps[`${name}:skipped`] = (steps[`${name}:skipped`] ?? 0) + 1;
    await page.keyboard.press('Escape').catch(() => {});
  }
}
const ids = () =>
  page.evaluate(() =>
    /** @type {any} */ (globalThis).__lekhTest
      .objects()
      .map((/** @type {any} */ o) => `${o.id} ${o.kind} ${o.templateId ?? ''}`),
  );
async function iteration() {
  const start = await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.undoDepth().undo);
  const before = await ids();
  await step('pan zoom', async () => {
    const ms = await page.evaluate(() => {
      const t = /** @type {any} */ (globalThis).__lekhTest;
      const v = t.getView();
      const out = [];
      for (let k = 0; k < 30; k++) {
        const z = k < 15 ? 1 + k * 0.1 : 2.5 - (k - 15) * 0.1;
        t.setView({ zoom: z, tx: v.tx - k * 20, ty: v.ty });
        out.push(t.drawFrame().ms);
      }
      t.setView({ zoom: 1, tx: 900, ty: v.ty });
      return out;
    });
    const at = Date.now();
    for (const m of ms) frameTimes.push({ at, ms: m });
  });
  await page.keyboard.press('v');
  for (let i = 0; i < 3; i++) {
    await step('add shape', async () => {
      await page.mouse.click(120 + i * 140, 140, { button: 'right' });
      const item = page.locator('[data-testid="popover-contextMenu"] [data-item-id="add_rect"]');
      await item.waitFor({ state: 'visible', timeout: 3000 });
      await item.click();
      await page.keyboard.press('Escape');
    });
  }
  await page.keyboard.press('p');
  for (let i = 0; i < 2; i++) {
    await step('ink stroke', async () => {
      const y = 420 + i * 60;
      await page.mouse.move(120, y);
      await page.mouse.down();
      for (let k = 1; k <= 40; k++) await page.mouse.move(120 + k * 6, y + Math.sin(k / 4) * 20);
      await page.mouse.up();
    });
  }
  // Pen strokes stay transient for 500 ms so quick strokes batch (C++ onTmpDrawingEnd); only then
  // are they one undo step. Undoing before that left the batch behind (seen in the first A3 run).
  await page.waitForTimeout(800);
  await page.keyboard.press('v');
  await step('move shape', async () => {
    await page.mouse.move(120, 140);
    await page.mouse.down();
    await page.mouse.move(140, 150, { steps: 5 });
    await page.mouse.up();
  });
  await step('text label', async () => {
    await page.keyboard.press('t');
    await page.mouse.click(600, 650);
    await page.keyboard.type('alpha');
    await page.keyboard.press('Enter');
    await page.keyboard.type('beta');
    await page.keyboard.press('Escape');
  });
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await step('undo to start', async () => {
    for (let k = 0; k < 40; k++) {
      const d = await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.undoDepth().undo);
      if (d <= start) break;
      await page.keyboard.press('Control+z');
    }
  });
  await step('redo undo', async () => {
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+z');
  });
  const after = await ids();
  // Remote objects (the collaborator stand-in's ids) come and go on their own; only local ones count.
  const local = (/** @type {string[]} */ xs) => xs.filter((x) => !x.startsWith('00000000-0000-4000-9000-'));
  const was = new Set(local(before).map((x) => x.split(' ')[0]));
  const left = local(after).filter((x) => !was.has(x.split(' ')[0]));
  if (left.length > 0 && leftovers.length < 50)
    leftovers.push({
      iteration: iterations + 1,
      before: before.length,
      after: after.length,
      left: left.map((x) => x.split(' ').slice(1).join(' ')),
    });
}
async function exportPng() {
  await step('export png', async () => {
    const pop = page.getByTestId('popover-boardOptions');
    await page.getByTestId('board_options_btn').first().click();
    await pop.getByTestId('board-option-export').click();
    await pop.getByTestId('export-panel').waitFor({ state: 'visible', timeout: 10000 });
    await pop.getByTestId('export-format-2').click();
    const dl = page.waitForEvent('download', { timeout: 300000 });
    await pop.getByTestId('export-button').click();
    const d = await dl;
    await d.delete();
    await page.getByTestId('export-progress').waitFor({ state: 'detached', timeout: 300000 });
    await page.keyboard.press('Escape');
  });
}
async function sample(/** @type {number} */ minute) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const now = Date.now();
  const recent = frameTimes.filter((f) => f.at > now - 60000).map((f) => f.ms);
  const objects = await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.objects().length);
  return {
    minute,
    used: heap.usedSize,
    nodes: dom.nodes,
    listeners: dom.jsEventListeners,
    objects,
    frames: recent.length,
    frame_p95: pct(recent, 95),
  };
}
/** @param {number[]} xs @param {number} p */
function pct(xs, p) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? NaN;
}

const t0 = Date.now();
/** @type {any[]} */
const series = [await sample(0)];
let nextSample = t0 + 60000;
let nextExport = t0 + 5 * 60000;
let nextRemote = t0 + 2000;
let iterations = 0;
while (Date.now() - t0 < MINUTES * 60000) {
  await iteration();
  iterations++;
  while (Date.now() >= nextRemote) {
    await timed('collaborator frames', collaborate);
    nextRemote += 2000;
  }
  if (Date.now() >= nextExport) {
    await timed('export png (all)', exportPng);
    nextExport += 5 * 60000;
  }
  if (Date.now() >= nextSample) {
    const s = await timed('sample (forced GC)', () => sample(Math.round((Date.now() - t0) / 60000)));
    series.push(s);
    process.stdout.write(
      `min ${s.minute}: heap ${(s.used / 1048576).toFixed(2)} MB, nodes ${s.nodes}, listeners ${s.listeners}, objects ${s.objects}, frame p95 ${s.frame_p95.toFixed(2)} ms\n`,
    );
    nextSample += 60000;
  }
}
/** @type {{ at: number, ms: number }[]} */
const longTaskEntries = await page.evaluate(() => /** @type {any} */ (globalThis).__longTasks);
const longTasks = longTaskEntries.map((e) => e.ms);
/** Each long task over 200 ms with the activity windows it overlaps. */
const longTaskLog = longTaskEntries
  .filter((e) => e.ms > 200)
  .map((e) => ({
    minute: Number(((e.at - t0) / 60000).toFixed(2)),
    ms: Math.round(e.ms),
    during: [...new Set(windows.filter((w) => w.t0 <= e.at + e.ms && w.t1 >= e.at).map((w) => w.name))],
  }));

// ---- analysis ----
const from5 = series.filter((s) => s.minute >= 5);
const slopePerMin = (() => {
  const n = from5.length;
  if (n < 2) return 0;
  const mx = from5.reduce((a, s) => a + s.minute, 0) / n;
  const my = from5.reduce((a, s) => a + s.used, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of from5) {
    num += (s.minute - mx) * (s.used - my);
    den += (s.minute - mx) ** 2;
  }
  return num / den;
})();
const at5 = from5[0];
const last = series.at(-1);
const end = Date.now();
const firstFrames = frameTimes.filter((f) => f.at - t0 >= 60000 && f.at - t0 < 5 * 60000).map((f) => f.ms);
const lastFrames = frameTimes.filter((f) => f.at > end - 5 * 60000).map((f) => f.ms);
const bars = {
  heap_slope_bytes_per_10min: slopePerMin * 10,
  heap_slope_ok: slopePerMin * 10 < 1048576,
  heap_at_5: at5?.used ?? null,
  heap_final: last?.used ?? null,
  final_over_5: at5 && last ? last.used / at5.used : null,
  final_ok: at5 && last ? last.used <= 1.2 * at5.used : false,
  frame_p95_first: pct(firstFrames, 95),
  frame_p95_last: pct(lastFrames, 95),
  frame_ok: pct(lastFrames, 95) <= 1.1 * pct(firstFrames, 95),
  long_tasks: longTasks.length,
  long_task_max_ms: longTasks.length ? Math.max(...longTasks) : 0,
  long_task_ok: !longTasks.some((/** @type {number} */ d) => d > 1000),
};
const pass = bars.heap_slope_ok && bars.final_ok && bars.frame_ok && bars.long_task_ok;
const result = {
  schema: 'leak-result/1',
  test: 'L-02',
  variant: 'offline; collaborator = realtime frames through applyFrames every 2 s',
  engine: 'ts',
  build: root,
  build_id: await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest?.build ?? null).catch(() => null),
  minutes: (end - t0) / 60000,
  iterations,
  steps,
  remote,
  blocked,
  bars,
  pass,
  long_task_log: longTaskLog,
  leftovers,
  series,
  env: { load: os.loadavg(), node: process.version, chromium: browser.version() },
};
writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
process.stdout.write(
  JSON.stringify(
    { pass, bars, steps, remote, iterations, long_task_log: longTaskLog, leftovers: leftovers.slice(0, 5) },
    null,
    1,
  ) + `\nout: ${OUT}\n`,
);
await browser.close();
server.closeAllConnections();
await new Promise((r) => server.close(r));
