// The client benchmarks of verification 03 §4.1 on the 2-core box (T19): the C++ web build with the
// `__lekhTest` hooks and the TS web build, both served statically on 127.0.0.1 (:4007 / :4008) with
// COOP/COEP (5 µs `performance.now()`), one headless Chromium (the e2e Playwright pin), driven
// through the v1 hooks only, so both builds are measured the same way.
//
//   P-01  warm load + first frame: loadDoc → settle, one sample per board (and cold: navigation →
//         ready → load → first frame, once per run on one board)
//   P-02  pan/zoom frame time: setView through 150 pan steps of 40 px, then 150 zoom steps
//         0.25 → 4 → 1 around the view centre, drawFrame() per step; frames > 50 ms counted
//   P-03  hit test: 10,000 seeded points over the active page's drawing bounds, 'near' and
//         'connection', batched (§3.2.5); S-syn: the 6,000 pt page; S-dec/S-feat: the drawing
//         rectangle read once from the TS build's `exportPlan` before the runs, the same points on
//         both builds
//   P-04  text-measure calls: (a) load + first frame, (b) the 300-step pan/zoom path
//   P-07a PNG export time at scale 1 and 2 (exportPage, region drawing, padding 20)
//   P-09  long tasks (PerformanceObserver 'longtask') during P-02: count and max
//
// P-01 times `settle()`, which waits for fonts and paint but not images on either build (owner
// decision 2026-10-20, IM1: the C++ engine draws a placeholder while an image loads; the C++ hook's
// settle got the same `{ images }` option, P2). Before P-02/P-03/P-09 the page is settled with
// `{ images: true }` (untimed), so the pan/zoom and hit paths run with the images decoded as before.
//
// Runs: one warm-up pass per build (discarded), then N measured passes interleaved C++, TS, TS,
// C++, C++, TS, … (§3.2). Each pass is a fresh browser context. Per-run statistic: p95 (p50, max,
// n); metric value: the median of the per-run p95s; verdict per §3.3 with the A/A margin from the
// C++ runs split into two interleaved halves.
//
//   node parity/bench/web-bench.mjs --sets syn|dec [--runs 5] [--builds <dir>] [--out <dir>]
//        [--only S-syn/basic/300,...] [--metrics P-01,P-02,...]
//
// --sets syn: the synthetic boards of sets.json (box, no customer data) → parity/out/perf/<run-id>/.
// --sets dec: S-dec and S-feat from corpus/inventory.json → corpus/out/perf/<run-id>/ (customer
// boards; only per-decile aggregates leave the box). Writes one perf-result/1 file per (metric,
// set, build) and summary.json / summary.md (the §6.3 table), plus a per-board breakdown
// (summary.json per_board, summary-boards.md: each board as set#position, no board ids).
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { holdHeavyLock } from '../tools/lock.mjs';
import { mulberry32, synthBoard } from './synth.mjs';

holdHeavyLock();

const require = createRequire(import.meta.url);
const HERE = import.meta.dirname;
const PARITY = path.resolve(HERE, '..');
const LEKHJS = path.resolve(PARITY, '..');
const WS = path.resolve(LEKHJS, '..');
const CORPUS = path.join(WS, 'corpus');

const { values: opt } = parseArgs({
  options: {
    sets: { type: 'string', default: 'syn' },
    runs: { type: 'string', default: '5' },
    builds: { type: 'string', default: path.join(PARITY, 'out', 'builds') },
    out: { type: 'string' },
    only: { type: 'string' },
    metrics: { type: 'string', default: 'P-01,P-02,P-03,P-04,P-07a,P-09' },
    seed: { type: 'string', default: '20261018' },
    // A board whose measurement has not answered after this many ms is recorded as an error and
    // the page is replaced (a wedged renderer cannot be reloaded); default 20 minutes.
    'board-timeout': { type: 'string', default: '1200000' },
  },
});
const RUNS = Number(opt.runs);
const METRICS = new Set(String(opt.metrics).split(','));
const runId = `w11-${opt.sets}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`;
const OUT = path.resolve(
  opt.out ?? (opt.sets === 'syn' ? path.join(PARITY, 'out', 'perf', runId) : path.join(CORPUS, 'out', 'perf', runId)),
);
mkdirSync(OUT, { recursive: true });
const PORTS = { cpp: 4007, ts: 4008 };

// ---- boards ----
/** @typedef {{ set: string, name: string, text: string, objects: number, hit: boolean, exportPng: boolean, side?: number, rect?: { x: number, y: number, w: number, h: number } }} Board */
/** @type {Board[]} */
const boards = [];
/** @type {Record<string, number>} board → phantom page entries dropped (--sets dec, DR-FMT-01) */
const phantomPagesDropped = {};
if (opt.sets === 'syn') {
  /** The box's S-syn selection (sets.json mixes the synthesiser has: basic, image, diagram, ink). */
  const sel = [
    ['basic', 36],
    ['basic', 100],
    ['basic', 300],
    ['basic', 685],
    ['basic', 1500],
    ['basic', 5000],
    ['basic', 20000],
    ['diagram', 300],
    ['diagram', 685],
    ['diagram', 1500],
    ['diagram', 5000],
    ['image', 300],
    ['image', 1500],
    ['image', 5000],
    ['ink', 685],
    ['ink', 1500],
    ['ink', 5000],
  ];
  for (const [mix, n] of /** @type {[string, number][]} */ (sel)) {
    const pages = n === 20000 ? 4 : 1;
    const b = synthBoard(/** @type {any} */ (mix), n, { pages, seed: n * 7 + mix.length });
    const text = typeof b === 'string' ? b : JSON.stringify(b);
    boards.push({
      set: `S-syn/${mix}/${n}`,
      name: `${mix}-${n}`,
      text,
      objects: n,
      hit: n >= 1500,
      exportPng: (mix === 'image' || mix === 'diagram') && n <= 5000 && n >= 300,
      side: 6000,
    });
  }
} else {
  const inv = JSON.parse(readFileSync(path.join(CORPUS, 'inventory.json'), 'utf8'));
  /**
   * Both builds must export the same page 0. A stored page entry holding only `objects` (the old
   * silent-empty-board bug) is a phantom page: C++ loads it as an unnamed page at order 0, so it can
   * sort first, while lekhjs moves it after the real pages as "Recovered" (DR-FMT-01). On S-dec/max
   * (90 pages, 3 phantoms) C++ exported a 1-object phantom (69 x 47 px) and TS the real first page
   * (1,073 x 594 px), which read as a 26x PNG slowdown (P1). So a board with real pages loses its
   * phantom entries before either build sees it; the count is in summary.json.
   * @param {string} text
   */
  const withoutPhantomPages = (text) => {
    /** @type {any} */
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      return { text, dropped: 0 };
    }
    const pages = doc?.pages;
    if (pages === null || typeof pages !== 'object' || Array.isArray(pages)) return { text, dropped: 0 };
    const isPhantom = (/** @type {any} */ p) =>
      p !== null && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length === 1 && 'objects' in p;
    const ids = Object.keys(pages).filter((k) => isPhantom(pages[k]));
    if (ids.length === 0 || ids.length === Object.keys(pages).length) return { text, dropped: 0 };
    for (const k of ids) delete pages[k];
    return { text: JSON.stringify(doc), dropped: ids.length };
  };
  const ids = Object.keys(inv)
    .filter((k) => !inv[k].parse_fail)
    .sort((a, b) => inv[a].objects - inv[b].objects || (a < b ? -1 : 1));
  const rnd = mulberry32(Number(opt.seed));
  const pick = (/** @type {string} */ set, /** @type {string} */ k) => {
    if (boards.some((b) => b.name === k)) return;
    const { text, dropped } = withoutPhantomPages(
      readFileSync(path.join(CORPUS, 'out', 'kashi-form', 'boards', `${k}.lekh`), 'utf8'),
    );
    if (dropped > 0) phantomPagesDropped[k] = dropped;
    boards.push({
      set,
      name: k,
      text,
      objects: inv[k].objects,
      // P-03 (verification 03 §4.1: S-dec top deciles; every corpus board here): the points cover
      // the drawing rectangle, read from the TS build before the runs (the P-03 pre-pass below).
      hit: true,
      exportPng: true,
    });
  };
  for (let d = 0; d < 10; d++) {
    const lo = Math.floor((d * ids.length) / 10);
    const hi = Math.floor(((d + 1) * ids.length) / 10);
    for (let j = 0; j < 3; j++) pick(`S-dec/d${d}`, ids[lo + Math.floor(rnd() * (hi - lo))] ?? '');
  }
  pick('S-dec/p99', ids[Math.floor(0.99 * ids.length)] ?? '');
  pick('S-dec/max', ids[ids.length - 1] ?? '');
  const top = (/** @type {(e: any) => number} */ f, /** @type {string} */ set) =>
    [...ids]
      .sort((a, b) => f(inv[b]) - f(inv[a]))
      .slice(0, 2)
      .forEach((k) => pick(set, k));
  top((e) => e.res, 'S-feat/images');
  top((e) => e.ink_points, 'S-feat/ink');
  top((e) => e.texts, 'S-feat/text');
  top((e) => e.connectors, 'S-feat/connectors');
  top((e) => e.lua, 'S-feat/lua');
}
/** The per-page warm-up board (§3.2.1): not one of the measured boards. */
const WARM_BOARD = JSON.stringify(synthBoard('diagram', 60, { pages: 1, seed: 424242 }));
const RES_URL = /\/resources\/([A-Za-z0-9_.-]+)(?:[?#].*)?$/;
const RES_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'cross-origin-resource-policy': 'cross-origin',
};
/** @type {Record<string, { file?: string }>} */
const resIndex =
  opt.sets === 'dec' && existsSync(path.join(CORPUS, 'res', 'index.json'))
    ? JSON.parse(readFileSync(path.join(CORPUS, 'res', 'index.json'), 'utf8'))
    : {};
const only = opt.only ? new Set(opt.only.split(',')) : null;
const BOARDS = only === null ? boards : boards.filter((b) => only.has(b.set));

// ---- serving ----
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
const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
};
/** @param {string} root @param {number} port */
function serveStatic(root, port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) return void res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) return void res.writeHead(404, ISOLATION).end();
    res.writeHead(200, { ...ISOLATION, 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
const servers = [
  await serveStatic(fs_real(path.resolve(opt.builds, 'cpp')), PORTS.cpp),
  await serveStatic(fs_real(path.resolve(opt.builds, 'ts')), PORTS.ts),
];
/** @param {string} p */
function fs_real(p) {
  return require('node:fs').realpathSync(p);
}

const pw = require(path.join(WS, 'e2e', 'node_modules', 'playwright'));
const browser = await pw.chromium.launch({
  headless: true,
  args: [
    '--disable-gpu',
    '--force-color-profile=srgb',
    '--disable-lcd-text',
    '--font-render-hinting=none',
    '--enable-precise-memory-info',
  ],
});

// ---- one pass of one build over the boards ----
/**
 * @param {'cpp' | 'ts'} engine
 * @returns {Promise<Record<string, any>>} board name → samples
 */
async function pass(engine) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'en-US',
  });
  const origin = `http://localhost:${PORTS[engine]}`;
  let blocked = 0;
  let served = 0;
  /** A fresh page on the build, its hooks ready. */
  const openPage = async () => {
    const p = await context.newPage();
    await p.route('**/*', (/** @type {any} */ r) => {
      const u = r.request().url();
      if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
      // Corpus boards: their `res://` images from corpus/res/, as the image comparison serves them
      // (verification 02 §B; §9 edge case 6: load and export include the image decode in both builds).
      const m = RES_URL.exec(new URL(u).pathname);
      if (m !== null) {
        if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: RES_HEADERS });
        const e = resIndex[m[1] ?? ''];
        if (e?.file !== undefined) {
          served++;
          return r.fulfill({
            status: 200,
            headers: { ...RES_HEADERS, 'content-type': 'application/octet-stream' },
            body: readFileSync(path.join(CORPUS, 'res', e.file)),
          });
        }
        return r.fulfill({ status: 404, headers: RES_HEADERS, body: '' });
      }
      blocked++;
      return r.abort();
    });
    await p.addInitScript(() => {
      const g = /** @type {any} */ (globalThis);
      g.__longTasks = [];
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) g.__longTasks.push(e.duration);
        }).observe(/** @type {any} */ ({ type: 'longtask', buffered: true }));
      } catch {
        /* no longtask support */
      }
    });
    await p.goto(`${origin}/?offline=true&lekhtest=1`);
    await p.waitForFunction(() => /** @type {any} */ (globalThis).__lekhTest !== undefined, null, { timeout: 60000 });
    await p.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.ready());
    return p;
  };
  const tNav = Date.now();
  let page = await openPage();
  const isolated = await page.evaluate(() => /** @type {any} */ (globalThis).crossOriginIsolated);
  /** @type {Record<string, any>} */
  const out = { _meta: { engine, isolated, readyMs: Date.now() - tNav } };
  // §3.2.1: the first board on a fresh page pays one-off costs (lazy chunks, fonts, JIT) that a warm
  // load does not; one small synthetic board is loaded and discarded first, so the first measured
  // set is warm like the rest (the A3 S-syn run's basic/36 swung 60-144 ms on TS without it).
  // P3: the warm-up board also runs the hit path (2,000 points of each kind, discarded) when P-03 is
  // measured, so the first measured set does not carry the JIT warm-up of the TS hit test (on
  // S-dec/d0, the first set, the first batches ran 10-40x the steady per-call time).
  await page
    .evaluate(
      async (/** @type {{ text: string, hit: boolean }} */ a) => {
        const t = /** @type {any} */ (globalThis).__lekhTest;
        await t.loadDoc(a.text, { name: 'warm-up' });
        await t.settle();
        t.drawFrame();
        if (a.hit) {
          const pts = new Float64Array(4000);
          for (let i = 0; i < pts.length; i++) pts[i] = ((i * 7919) % 6000) + (i % 2) * 13;
          for (const kind of ['near', 'connection'])
            for (let i = 0; i < pts.length; i += 400) t.hitTest(pts.subarray(i, i + 400), kind);
        }
      },
      { text: WARM_BOARD, hit: METRICS.has('P-03') },
    )
    .catch(() => {});
  for (const b of BOARDS) {
    /** @type {any} */
    let r;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    try {
      const measured = page.evaluate(
        async (
          /** @type {{ text: string, hit: boolean, rect: { x: number, y: number, w: number, h: number } | null, exportPng: boolean, metrics: string[], seed: number }} */ a,
        ) => {
          const t = /** @type {any} */ (globalThis).__lekhTest;
          const g = /** @type {any} */ (globalThis);
          const m = new Set(a.metrics);
          /** @type {Record<string, any>} */
          const res = {};
          t.resetCounters();
          const l0 = performance.now();
          const ld = await t.loadDoc(a.text, { name: 'bench' });
          if (!ld.ok) return { error: String(ld.error) };
          await t.settle();
          res.load = performance.now() - l0;
          res.measureLoad = t.counters().measureText;
          const v0 = t.getView();
          res.page = v0.page;
          // P-02/P-03/P-09 run with the board's images decoded, as before IM1 (untimed).
          if (m.has('P-02') || m.has('P-09') || m.has('P-03')) await t.settle({ images: true });
          if (m.has('P-02') || m.has('P-09') || m.has('P-04')) {
            const cx = (640 - v0.tx) / v0.zoom;
            const cy = (400 - v0.ty) / v0.zoom;
            g.__longTasks.length = 0;
            t.resetCounters();
            const frames = [];
            for (let k = 0; k < 150; k++) {
              const dx = k < 75 ? -40 * (k + 1) : -40 * (150 - k - 1);
              t.setView({ zoom: v0.zoom, tx: v0.tx + dx, ty: v0.ty });
              frames.push(t.drawFrame().ms);
              // A task boundary per frame, as a real frame has, so P-09 sees per-frame long tasks.
              await new Promise((r) => setTimeout(r, 0));
            }
            for (let k = 0; k < 150; k++) {
              const z = k < 75 ? 0.25 * Math.pow(16, k / 74) : 4 * Math.pow(0.25, (k - 75) / 74);
              t.setView({ zoom: z, tx: 640 - cx * z, ty: 400 - cy * z });
              frames.push(t.drawFrame().ms);
              // A task boundary per frame, as a real frame has, so P-09 sees per-frame long tasks.
              await new Promise((r) => setTimeout(r, 0));
            }
            res.frames = frames;
            res.measurePan = t.counters().measureText;
            await new Promise((r) => setTimeout(r, 50)); // the observer reports after the task
            res.longTasks = [...g.__longTasks];
            t.setView(v0);
          }
          if (a.hit && a.rect !== null && m.has('P-03')) {
            let s = a.seed >>> 0;
            const rnd = () => {
              s = (s + 0x6d2b79f5) >>> 0;
              let x = s;
              x = Math.imul(x ^ (x >>> 15), x | 1);
              x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
              return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
            };
            const pts = new Float64Array(20000);
            for (let i = 0; i < pts.length; i++)
              pts[i] = i % 2 === 0 ? a.rect.x + rnd() * a.rect.w : a.rect.y + rnd() * a.rect.h;
            const B = 200;
            /** @type {Record<string, number[]>} */
            const hit = { near: [], connection: [] };
            for (const kind of ['near', 'connection']) {
              for (let i = 0; i < pts.length; i += 2 * B) {
                const r = t.hitTest(pts.subarray(i, i + 2 * B), kind);
                hit[kind]?.push(r.ms / B);
              }
            }
            res.hit = hit;
          }
          if (a.exportPng && m.has('P-07a')) {
            /** @type {Record<string, number>} */
            const ex = {};
            // §9 edge case 5: warm values only — one discarded export first (lazy chunks, encoder).
            await t.exportPage(0, { region: 'drawing', padding: 20, scale: 1, background: true });
            for (const sc of [1, 2]) {
              const e0 = performance.now();
              const e = await t.exportPage(0, { region: 'drawing', padding: 20, scale: sc, background: true });
              ex[`png${sc}`] = e.dataUrl === 'data:,' ? -1 : performance.now() - e0;
            }
            res.export = ex;
          }
          const mem = /** @type {any} */ (performance).memory;
          res.heap = mem ? mem.usedJSHeapSize : null;
          return res;
        },
        {
          text: b.text,
          hit: b.hit,
          rect: b.rect ?? (b.side !== undefined ? { x: 0, y: 0, w: b.side, h: b.side } : null),
          exportPng: b.exportPng,
          metrics: [...METRICS],
          seed: Number(opt.seed),
        },
      );
      r = await Promise.race([
        measured,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`board timeout after ${opt['board-timeout']} ms`)),
            Number(opt['board-timeout']),
          );
        }),
      ]);
      clearTimeout(timer);
    } catch (e) {
      clearTimeout(timer);
      // §9 edge case 9: a build that fails a board (the C++ wasm aborts at its memory cap on the
      // largest boards) is recorded for that board, and the page is reloaded for the next one.
      r = {
        error: String(/** @type {any} */ (e)?.message ?? e)
          .split('\n')[0]
          ?.slice(0, 160),
      };
      // A new page, not a reload: a renderer wedged by an abort or a timeout may not navigate.
      await page.close({ runBeforeUnload: false }).catch(() => {});
      page = await openPage();
    }
    out[b.name] = r;
    process.stdout.write(`  ${engine} ${b.set}${r?.error ? ` ERROR ${r.error}` : ''}\n`);
  }
  // Cold load (P-01 cold): a reload, then ready → load → first frame of the mid board.
  if (METRICS.has('P-01')) {
    const mid = BOARDS[Math.floor(BOARDS.length / 2)];
    if (mid !== undefined) {
      const t0 = Date.now();
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      try {
        await Promise.race([
          (async () => {
            await page.reload();
            await page.waitForFunction(() => /** @type {any} */ (globalThis).__lekhTest !== undefined, null, {
              timeout: 60000,
            });
            await page.evaluate(async (/** @type {string} */ text) => {
              const t = /** @type {any} */ (globalThis).__lekhTest;
              await t.ready();
              await t.loadDoc(text, { name: 'bench' });
              await t.settle();
            }, mid.text);
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('cold load timeout')), 300000);
          }),
        ]);
        out._meta.cold = { board: mid.set, ms: Date.now() - t0 };
      } catch (e) {
        out._meta.cold = { board: mid.set, error: String(/** @type {any} */ (e)?.message ?? e).slice(0, 160) };
      } finally {
        clearTimeout(timer);
      }
    }
  }
  out._meta.blocked = blocked;
  out._meta.res_served = served;
  await context.close();
  return out;
}

// ---- statistics ----
/** @param {number[]} xs @param {number} p */
const pct = (xs, p) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? NaN;
};
/** @param {number[]} xs */
const stat = (xs) => ({ p50: pct(xs, 50), p95: pct(xs, 95), max: xs.length ? Math.max(...xs) : NaN, n: xs.length });
/** @param {number[]} xs */
const median = (xs) => pct(xs, 50);

function sh(/** @type {string} */ cmd, /** @type {string[]} */ args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
function envRecord() {
  let pm2 = null;
  const j = sh('pm2', ['jlist']);
  if (j) {
    try {
      pm2 = JSON.parse(j).map((/** @type {any} */ p) => `${p.name}:${p.pm2_env.status}`);
    } catch {
      pm2 = null;
    }
  }
  const governor = (() => {
    try {
      return readFileSync('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', 'utf8').trim();
    } catch {
      return null;
    }
  })();
  const human = Array.isArray(pm2) && pm2.some((s) => s.startsWith('kashi-human:online'));
  return {
    load: os.loadavg(),
    cpus: os.cpus().length,
    governor,
    pm2,
    chromium: browser.version(),
    node: process.version,
    lekhjs: sh('git', ['-C', LEKHJS, 'rev-parse', '--short', 'HEAD']),
    quiet: !human && (os.loadavg()[0] ?? 1) < 0.3,
    env: !human && (os.loadavg()[0] ?? 1) < 0.3 ? 'quiet' : 'shared',
  };
}

// ---- run ----
const envStart = envRecord();
const identities = {};
for (const e of /** @type {const} */ (['cpp', 'ts'])) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.route('**/*', (/** @type {any} */ r) =>
    r.request().url().startsWith(`http://localhost:${PORTS[e]}`) ? r.continue() : r.abort(),
  );
  await p.goto(`http://localhost:${PORTS[e]}/?offline=true&lekhtest=1`);
  await p.waitForFunction(() => /** @type {any} */ (globalThis).__lekhTest !== undefined, null, { timeout: 60000 });
  /** @type {any} */ (identities)[e] = await p.evaluate(() => {
    const t = /** @type {any} */ (globalThis).__lekhTest;
    return { version: t.version, engine: t.engine, build: t.build };
  });
  await ctx.close();
}
// P-03 on corpus boards: the active page's drawing rectangle (board points), read once from the TS
// build (`exportPlan`, no export drawn), so both builds hit-test the same seeded points.
if (METRICS.has('P-03') && opt.sets === 'dec') {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.route('**/*', (/** @type {any} */ r) =>
    r.request().url().startsWith(`http://localhost:${PORTS.ts}`) ? r.continue() : r.abort(),
  );
  await p.goto(`http://localhost:${PORTS.ts}/?offline=true&lekhtest=1`);
  await p.waitForFunction(() => /** @type {any} */ (globalThis).__lekhTest !== undefined, null, { timeout: 60000 });
  await p.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.ready());
  for (const b of BOARDS) {
    if (!b.hit) continue;
    const r = await p
      .evaluate(async (/** @type {string} */ text) => {
        const t = /** @type {any} */ (globalThis).__lekhTest;
        const ld = await t.loadDoc(text, { name: 'bench-rect' });
        if (!ld.ok) return null;
        const pg = t.getView().page;
        return t.exportPlan(pg, { region: 'drawing', padding: 0, background: false });
      }, b.text)
      .catch(() => null);
    if (r && r.width > 0 && r.height > 0) b.rect = { x: r.x, y: r.y, w: r.width, h: r.height };
    else b.hit = false;
  }
  await ctx.close();
}
process.stdout.write(`boards: ${BOARDS.length}; warm-up\n`);
await pass('cpp');
await pass('ts');
const order = [];
for (let i = 0; order.length < 2 * RUNS; i++) order.push(...(i % 2 === 0 ? ['cpp', 'ts'] : ['ts', 'cpp']));
/** @type {{ cpp: any[], ts: any[] }} */
const runs = { cpp: [], ts: [] };
for (const e of /** @type {('cpp' | 'ts')[]} */ (order)) {
  const t0 = Date.now();
  runs[e].push(await pass(e));
  process.stdout.write(`run ${e} #${runs[e].length} ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
}
const envEnd = envRecord();

/**
 * Metric rows: per (metric, set) the per-run statistic for both builds.
 * @type {{ metric: string, set: string, unit: string, cpp: any[], ts: any[], counter?: boolean, boards?: number, excluded?: number }[]}
 */
const rows = [];
/** Pools a per-board extractor over the boards of each set (load-type metrics pool boards). */
function addRow(
  /** @type {string} */ metric,
  /** @type {string} */ unit,
  /** @type {(r: any, b: Board) => number[] | null} */ f,
  counter = false,
) {
  const sets = [...new Set(BOARDS.map((b) => b.set))];
  const groups = opt.sets === 'dec' && metric === 'P-01' ? [...sets, 'S-dec/all'] : sets;
  for (const set of groups) {
    const all = BOARDS.filter((b) => b.set === set || (set === 'S-dec/all' && b.set.startsWith('S-dec/')));
    // A board either build failed in any run (§9 edge case 9) is left out of both sides of the
    // pooled row, so the two builds are compared over the same boards; when every board of the set
    // failed on C++, the row is the TS value alone (cpp_fail).
    const failed = (/** @type {Board} */ b) => [...runs.cpp, ...runs.ts].some((run) => run[b.name]?.error);
    const ok = all.filter((b) => !failed(b));
    const bs = ok.length > 0 ? ok : all;
    /** @param {any[]} rs */
    const per = (rs) =>
      rs.map((run) => {
        const xs = bs.flatMap((b) => (run[b.name] && !run[b.name].error ? (f(run[b.name], b) ?? []) : []));
        return stat(xs);
      });
    const c = per(runs.cpp);
    const t = per(runs.ts);
    if (c.every((s) => s.n === 0) && t.every((s) => s.n === 0)) continue;
    rows.push({ metric, set, unit, cpp: c, ts: t, counter, boards: bs.length, excluded: all.length - bs.length });
    if (set === 'S-dec/all') continue;
    // The per-board breakdown (P3): each board's own per-run p95, median over the runs, so a pooled
    // row over the bar can be traced to its board(s). Boards are named by set and position only.
    for (const b of all) {
      /** @param {any[]} rs */
      const one = (rs) =>
        median(
          rs
            .map((run) => (run[b.name] && !run[b.name].error ? stat(f(run[b.name], b) ?? []) : null))
            .filter((s) => s !== null && s.n > 0)
            .map((s) => /** @type {any} */ (s).p95),
        );
      const cv = one(runs.cpp);
      const tv = one(runs.ts);
      perBoard.push({
        metric,
        set,
        board: `${set}#${BOARDS.filter((x) => x.set === set).indexOf(b)}`,
        objects: b.objects,
        unit,
        cpp: cv,
        ts: tv,
        ratio: cv > 0 ? tv / cv : null,
        failed: failed(b),
      });
    }
  }
}
/** @type {{ metric: string, set: string, board: string, objects: number, unit: string, cpp: number, ts: number, ratio: number | null, failed: boolean }[]} */
const perBoard = [];
if (METRICS.has('P-01')) addRow('P-01', 'ms', (r) => [r.load]);
if (METRICS.has('P-02')) addRow('P-02', 'ms', (r) => r.frames ?? null);
if (METRICS.has('P-03')) {
  addRow('P-03 near', 'ms/call', (r) => r.hit?.near ?? null);
  addRow('P-03 connection', 'ms/call', (r) => r.hit?.connection ?? null);
}
if (METRICS.has('P-04')) {
  addRow('P-04a measureText', 'calls', (r) => [r.measureLoad], true);
  addRow('P-04b measureText', 'calls', (r) => (r.measurePan === undefined ? null : [r.measurePan]), true);
}
if (METRICS.has('P-07a')) {
  addRow('P-07a png@1', 'ms', (r) => (r.export && r.export.png1 >= 0 ? [r.export.png1] : null));
  addRow('P-07a png@2', 'ms', (r) => (r.export && r.export.png2 >= 0 ? [r.export.png2] : null));
}
if (METRICS.has('P-09')) {
  addRow('P-09 long tasks', 'count', (r) => (r.longTasks === undefined ? null : [r.longTasks.length]), true);
  addRow(
    'P-09 slow frames >50ms',
    'count',
    (r) => (r.frames === undefined ? null : [r.frames.filter((/** @type {number} */ x) => x > 50).length]),
    true,
  );
}

const table = rows.map((row) => {
  const cv = median(row.cpp.map((s) => s.p95));
  const tv = median(row.ts.map((s) => s.p95));
  const h1 = median(row.cpp.filter((_, i) => i % 2 === 0).map((s) => s.p95));
  const h2 = median(row.cpp.filter((_, i) => i % 2 === 1).map((s) => s.p95));
  const a = h2 > 0 ? Math.abs(h1 / h2 - 1) : 0;
  const margin = Math.max(0.02, Number.isFinite(a) ? a : 0);
  const ratio = cv > 0 ? tv / cv : tv === 0 ? 1 : Infinity;
  let verdict;
  const cppFailed = row.cpp.every((s) => s.n === 0);
  // §9 edge case 9: no C++ value (cpp_fail on every run): TS is held to its own ceiling instead
  // of a ratio (load ≤ 10 s on the box); other metrics are recorded without a verdict.
  if (cppFailed)
    verdict = row.metric === 'P-01' ? (tv <= 10000 ? 'cpp_fail; TS ≤ 10 s' : 'cpp_fail; TS > 10 s') : 'cpp_fail';
  else if (row.counter) verdict = tv <= cv ? 'pass' : 'fail';
  else verdict = ratio <= 1 + margin ? 'pass' : ratio <= 1.1 ? 'needs DR-PERF' : 'fail';
  const nearBoundary = !row.counter && (Math.abs(ratio - (1 + margin)) < 0.02 || Math.abs(ratio - 1.1) < 0.02);
  return {
    metric: row.metric,
    set: row.set,
    unit: row.unit,
    cpp: cv,
    ts: tv,
    ratio,
    margin,
    verdict,
    near_boundary: nearBoundary,
    boards: row.boards,
    excluded: row.excluded,
  };
});
for (const row of rows)
  for (const e of /** @type {const} */ (['cpp', 'ts']))
    writeFileSync(
      path.join(OUT, `${row.metric.replace(/[^A-Za-z0-9-]+/g, '_')}-${row.set.replace(/\//g, '_')}-${e}.json`),
      JSON.stringify(
        {
          schema: 'perf-result/1',
          metric: row.metric,
          set: row.set,
          device: 'box',
          build: e,
          build_id: /** @type {any} */ (identities)[e].build,
          runs: row[e],
          value: median(row[e].map((s) => s.p95)),
          unit: row.unit,
          env: envEnd,
        },
        null,
        1,
      ),
    );
const meta = {
  run_id: runId,
  sets: opt.sets,
  boards: BOARDS.map((b) => ({ set: b.set, objects: b.objects })),
  runs: RUNS,
  order,
  identities,
  env_start: envStart,
  env_end: envEnd,
  isolated: { cpp: runs.cpp.map((r) => r._meta.isolated), ts: runs.ts.map((r) => r._meta.isolated) },
  blocked: { cpp: runs.cpp.map((r) => r._meta.blocked), ts: runs.ts.map((r) => r._meta.blocked) },
  res_served: { cpp: runs.cpp.map((r) => r._meta.res_served), ts: runs.ts.map((r) => r._meta.res_served) },
  phantom_pages_dropped: phantomPagesDropped,
  // P-03 on corpus boards: boards with a drawing rectangle, and whether both builds hit-tested the
  // same active page in every run.
  hit_boards: BOARDS.filter((b) => b.hit && METRICS.has('P-03')).length,
  active_page_mismatch: BOARDS.filter((b) =>
    [...runs.cpp, ...runs.ts].some(
      (r) => r[b.name]?.page !== undefined && r[b.name].page !== runs.ts[0]?.[b.name]?.page,
    ),
  ).map((b) => b.set),
  cold_ms: { cpp: runs.cpp.map((r) => r._meta.cold?.ms ?? null), ts: runs.ts.map((r) => r._meta.cold?.ms ?? null) },
  errors: Object.fromEntries(
    BOARDS.map((b) => [b.set, [...runs.cpp, ...runs.ts].filter((r) => r[b.name]?.error).length]).filter(
      ([, n]) => Number(n) > 0,
    ),
  ),
  table,
  per_board: perBoard,
};
writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(meta, null, 1));
const f = (/** @type {number} */ x) =>
  Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toPrecision(3)) : String(x);
const md = [
  `| Metric | Set | Device | C++ p95 | TS p95 | Ratio | Margin | Verdict |`,
  `|---|---|---|---|---|---|---|---|`,
  ...table.map(
    (r) =>
      `| ${r.metric} | ${r.set} | box | ${f(r.cpp)} ${r.unit} | ${f(r.ts)} ${r.unit} | ${f(r.ratio)} | ${f(r.margin)} | ${r.verdict}${r.near_boundary ? ' (near boundary)' : ''} |`,
  ),
].join('\n');
writeFileSync(path.join(OUT, 'summary.md'), md + '\n');
writeFileSync(
  path.join(OUT, 'summary-boards.md'),
  [
    `| Metric | Board | Objects | C++ p95 | TS p95 | Ratio |`,
    `|---|---|---|---|---|---|`,
    ...perBoard.map(
      (r) =>
        `| ${r.metric} | ${r.board} | ${r.objects} | ${f(r.cpp)} ${r.unit} | ${f(r.ts)} ${r.unit} | ${r.ratio === null ? 'n/a' : f(r.ratio)}${r.failed ? ' (failed)' : ''} |`,
    ),
  ].join('\n') + '\n',
);
process.stdout.write(md + '\n' + `out: ${OUT}\n`);
await browser.close();
for (const s of servers) {
  /** @type {any} */ (s).closeAllConnections();
  await new Promise((r) => /** @type {any} */ (s).close(r));
}
