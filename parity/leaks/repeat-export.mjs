// L-07 (verification 03 §5, T20): 20 consecutive PNG exports at scale 4 of S-syn image 5,000 on the
// TS web build, through the board's own export dialog (ExportJob, the banded raster path and the
// download), in one headless Chromium (the e2e Playwright pin), the build served statically on
// 127.0.0.1:4008. The renderer RSS (VmRSS of every Chromium renderer process this run started,
// summed) is read after load + GC (the baseline), sampled every 50 ms during each export (the
// peak), and read again after each export + two forced GCs.
//
// Bars: after the 20th export and a GC the renderer RSS is within 10 % of the pre-export baseline,
// and there is no growth trend (the least-squares slope of the post-export RSS over exports 5–20
// is below 1 % of the baseline per export). The JS heap after GC is recorded beside it.
//
//   node parity/leaks/repeat-export.mjs --build <dir> [--exports 20] [--out <dir>]
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
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
    exports: { type: 'string', default: '20' },
    out: {
      type: 'string',
      default: path.join(PARITY, 'out', 'leaks', `l07-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`),
    },
  },
});
if (!opt.build) {
  process.stderr.write('usage: repeat-export.mjs --build <dir> [--exports 20] [--out <dir>]\n');
  process.exit(2);
}
const N = Number(opt.exports);
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
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(null)));

const SET = 'S-syn/image/5000';
const board = JSON.stringify(synthBoard('image', 5000, { pages: 1, seed: 5000 * 7 + 'image'.length }));

/** Every descendant of this process whose command line says it is a Chromium renderer. */
function rendererPids() {
  /** @type {Map<number, number>} */
  const parent = new Map();
  /** @type {Map<number, string>} */
  const cmd = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      parent.set(Number(d), ppid);
      cmd.set(Number(d), readFileSync(`/proc/${d}/cmdline`, 'utf8'));
    } catch {
      /* gone */
    }
  }
  const mine = (/** @type {number} */ pid) => {
    for (let p = pid, i = 0; p > 1 && i < 64; p = parent.get(p) ?? 0, i++) if (p === process.pid) return true;
    return false;
  };
  return [...cmd.entries()].filter(([pid, c]) => c.includes('--type=renderer') && mine(pid)).map(([pid]) => pid);
}
/** Summed VmRSS of the renderers, in bytes. */
function rendererRss() {
  let sum = 0;
  for (const pid of rendererPids()) {
    try {
      const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
      sum += Number(m?.[1] ?? 0) * 1024;
    } catch {
      /* gone */
    }
  }
  return sum;
}

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
  const r = await t.loadDoc(text, { name: 'L07.lekh' });
  await t.settle();
  return r;
}, board);
if (!load.ok) throw new Error(`loadDoc failed: ${load.error}`);
const cdp = await context.newCDPSession(page);
await cdp.send('HeapProfiler.enable');
async function gc() {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(500);
  return (await cdp.send('Runtime.getHeapUsage')).usedSize;
}

/** One export through the dialog: PNG (format 2), x4; resolves with the download's byte size. */
async function exportOnce() {
  const pop = page.getByTestId('popover-boardOptions');
  await page.getByTestId('board_options_btn').first().click();
  await pop.getByTestId('board-option-export').click();
  await pop.getByTestId('export-panel').waitFor({ state: 'visible', timeout: 10000 });
  await pop.getByTestId('export-format-2').click();
  await pop.getByTestId('export-image-size').getByText('x4', { exact: true }).click();
  const dl = page.waitForEvent('download', { timeout: 600000 });
  await pop.getByTestId('export-button').click();
  const d = await dl;
  const p = await d.path();
  const bytes = statSync(p).size;
  await d.delete();
  await page.getByTestId('export-progress').waitFor({ state: 'detached', timeout: 600000 });
  await page.keyboard.press('Escape');
  return bytes;
}

const baseHeap = await gc();
const baseRss = rendererRss();
process.stdout.write(
  `baseline: renderer RSS ${(baseRss / 1048576).toFixed(0)} MiB, heap ${(baseHeap / 1048576).toFixed(1)} MiB\n`,
);
/** @type {any[]} */
const series = [];
const t0 = Date.now();
for (let i = 1; i <= N; i++) {
  let peak = 0;
  const timer = setInterval(() => {
    peak = Math.max(peak, rendererRss());
  }, 50);
  const e0 = Date.now();
  const bytes = await exportOnce();
  const ms = Date.now() - e0;
  clearInterval(timer);
  const heap = await gc();
  const rss = rendererRss();
  series.push({ export: i, ms, bytes, peak_rss: peak, rss, heap });
  process.stdout.write(
    `export ${i}: ${ms} ms, ${(bytes / 1048576).toFixed(1)} MiB file, RSS peak ${(peak / 1048576).toFixed(0)} MiB, after GC ${(rss / 1048576).toFixed(0)} MiB, heap ${(heap / 1048576).toFixed(1)} MiB\n`,
  );
}
const tail = series.filter((s) => s.export >= 5);
const slope = (() => {
  const n = tail.length;
  if (n < 2) return 0;
  const mx = tail.reduce((a, s) => a + s.export, 0) / n;
  const my = tail.reduce((a, s) => a + s.rss, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of tail) {
    num += (s.export - mx) * (s.rss - my);
    den += (s.export - mx) ** 2;
  }
  return num / den;
})();
const last = series.at(-1);
const bars = {
  baseline_rss: baseRss,
  final_rss: last?.rss ?? null,
  final_over_baseline: last ? last.rss / baseRss : null,
  final_within_10pct: last ? last.rss <= 1.1 * baseRss : false,
  slope_bytes_per_export: slope,
  slope_ok: slope < 0.01 * baseRss,
  peak_rss_max: Math.max(...series.map((s) => s.peak_rss)),
  heap_baseline: baseHeap,
  heap_final: last?.heap ?? null,
};
const pass = bars.final_within_10pct && bars.slope_ok;
const result = {
  schema: 'leak-result/1',
  test: 'L-07',
  set: SET,
  engine: 'ts',
  build: root,
  build_id: await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest?.build ?? null).catch(() => null),
  exports: N,
  minutes: (Date.now() - t0) / 60000,
  blocked,
  bars,
  pass,
  series,
  env: { load: os.loadavg(), node: process.version, chromium: browser.version() },
};
writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
process.stdout.write(JSON.stringify({ pass, bars }, null, 1) + `\nout: ${OUT}\n`);
await browser.close();
server.closeAllConnections();
await new Promise((r) => server.close(r));
