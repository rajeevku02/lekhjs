// The image comparison (B) of verification 02 §B: both browser builds render each board of the
// image sample (or a batch file), page by page with the §B.2 export options, and the pair is
// compared under the §B.3 bar with the §B.5 masking fallback and the §B.6 attribution. One headless
// Chromium (the e2e Playwright pin), the C++ build with the `__lekhTest` hooks on 127.0.0.1:4007
// and the TS build on :4008, a fresh context per board and build, the browser recycled every 200
// boards. `res://` images are served from `corpus/res/` (fetch_res.py); any other request off the
// build's origin is aborted and counted (a board with one is `harness`).
//
//   node parity/image/run.mjs --input <corpus/sample/image-sample.json | file.lekh> --out <dir>
//        [--which boards|off] [--boards <dir>] [--res <dir>] [--builds <dir>] [--compat on|off]
//        [--resume] [--limit N] [--selfdiff <rate>] [--seed N] [--save fail|all|none]
//
// Writes into --out (customer boards: under corpus/out/ only, never published): results.jsonl (one
// line per board: per-page status, differing fraction, largest blob, scale, masked fraction,
// attributed register ids, object flags under unexplained blobs, timings), run.json (identities,
// fonts, options) and, with --save, png/<idx>-p<i>-{cpp,ts,diff}.png for local contact sheets.
// `node parity/image/report.mjs <out>` aggregates. Exit 0 = done (or --limit reached), 75 = lock busy.
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { activeEntries, loadRegister } from '../register/load.mjs';
import { holdHeavyLock } from '../tools/lock.mjs';
import {
  align,
  bar,
  blobs,
  decodeDataUrl,
  diffImages,
  diffPicture,
  encodePng,
  identical,
  inkPixels,
  maxBlob,
} from './diff.mjs';
import { flagsByObject, overlongWordsInPage, wrapCandidates } from './attribute.mjs';

holdHeavyLock();

const require = createRequire(import.meta.url);
const HERE = import.meta.dirname;
const PARITY = path.resolve(HERE, '..');
const WS = path.resolve(PARITY, '..', '..');
const CORPUS = path.join(WS, 'corpus');

const { values: opt } = parseArgs({
  options: {
    input: { type: 'string' },
    out: { type: 'string' },
    which: { type: 'string', default: 'boards' },
    boards: { type: 'string', default: path.join(CORPUS, 'out', 'kashi-form', 'boards') },
    res: { type: 'string', default: path.join(CORPUS, 'res') },
    builds: { type: 'string', default: path.join(PARITY, 'out', 'builds') },
    compat: { type: 'string', default: 'on' },
    resume: { type: 'boolean', default: false },
    limit: { type: 'string', default: '0' },
    selfdiff: { type: 'string', default: '0.01' },
    seed: { type: 'string', default: '20261018' },
    save: { type: 'string', default: 'fail' },
    'max-pages': { type: 'string', default: '4' },
    'board-timeout': { type: 'string', default: '180000' },
  },
});
if (!opt.input || !opt.out) {
  process.stderr.write('usage: run.mjs --input <sample.json | file.lekh> --out <dir> [...]\n');
  process.exit(2);
}
const OUT = path.resolve(opt.out);
const COMPAT = opt.compat !== 'off';
const LIMIT = Number(opt.limit);
const SELFDIFF = Number(opt.selfdiff);
const MAX_PAGES = Number(opt['max-pages']);
const BOARD_TIMEOUT = Number(opt['board-timeout']);
const RECYCLE = 200;
/** Pages larger than this at scale 1 are compared at a smaller scale (see render). */
const MAX_PIXELS = 25_000_000;
const PORTS = { cpp: 4007, ts: 4008 };
const EXPORT = { region: 'drawing', padding: 20, scale: 1, background: true };
mkdirSync(OUT, { recursive: true });
if (opt.save !== 'none') mkdirSync(path.join(OUT, 'png'), { recursive: true });

// ---- inputs ----
/** @type {{ idx: string, file: string }[]} */
let inputs;
if (opt.input.endsWith('.lekh')) {
  inputs = [{ idx: path.basename(opt.input, '.lekh'), file: path.resolve(opt.input) }];
} else {
  const s = JSON.parse(readFileSync(opt.input, 'utf8'));
  const list = opt.which === 'off' ? s.off_subsample : s.boards;
  inputs = list.map((/** @type {string} */ idx) => ({ idx, file: path.join(opt.boards, `${idx}.lekh`) }));
}
const done = new Set();
const RESULTS = path.join(OUT, 'results.jsonl');
if (opt.resume && existsSync(RESULTS)) {
  for (const l of readFileSync(RESULTS, 'utf8').split('\n')) if (l.trim() !== '') done.add(JSON.parse(l).idx);
}
const resIndexFile = path.join(opt.res, 'index.json');
/** @type {Record<string, { file?: string, missing?: string }>} */
const resIndex = existsSync(resIndexFile) ? JSON.parse(readFileSync(resIndexFile, 'utf8')) : {};

// ---- the register's image rules (§B.6) ----
const entries = activeEntries(loadRegister());
/** @type {{ id: string, flag: string }[]} */
const attributeRules = [];
for (const e of entries) {
  const f = e.data?.rule?.image?.attribute?.object_flag;
  if (typeof f === 'string') attributeRules.push({ id: String(e.data.id), flag: f });
}
const phantomRule = entries.some((e) => e.data?.id === 'DR-FMT-01') ? 'DR-FMT-01' : null;

/** UTF-8 byte order of two keys (C++ std::map). @param {string} a @param {string} b */
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** The C++ page order: stored keys by byte order, then by order (a phantom at 0). @param {any} doc */
function cppPageKeys(doc) {
  const pages = doc.pages;
  const keys = Object.keys(pages);
  const phantom = (/** @type {string} */ k) => pages[k]?.order === undefined && pages[k]?.name === undefined;
  const ord = (/** @type {string} */ k) => (phantom(k) ? 0 : Number(pages[k]?.order ?? 0));
  return [...keys].sort(byteOrder).sort((a, b) => ord(a) - ord(b));
}
/** The stored key of C++ page `i`. @param {any} doc @param {number} i */
const pagePairKey = (doc, i) => cppPageKeys(doc)[i] ?? '';

/**
 * The TS page index of each of the first `count` C++ pages when the board holds a phantom page
 * (a stored page with objects only, DR-FMT-01), else null. C++ (LekhDocument: pages read in key
 * byte order, then sorted by order, the phantom at 0; insertion sort for so few pages, so ties keep
 * byte order); TS (io/ JSON reader: the real pages by order, then the phantoms as "Recovered…" in
 * stored-key order).
 * @param {any} doc
 * @param {number} count
 */
function phantomPageMap(doc, count) {
  const pages = doc?.pages;
  if (pages === null || typeof pages !== 'object' || Array.isArray(pages)) return null;
  const keys = Object.keys(pages);
  const phantom = (/** @type {string} */ k) => pages[k]?.order === undefined && pages[k]?.name === undefined;
  if (!keys.some(phantom)) return null;
  const ord = (/** @type {string} */ k) => (phantom(k) ? 0 : Number(pages[k]?.order ?? 0));
  const cpp = [...keys].sort(byteOrder).sort((a, b) => ord(a) - ord(b));
  const real = keys
    .filter((k) => !phantom(k))
    .sort(byteOrder)
    .sort((a, b) => ord(a) - ord(b));
  const ts = [...real, ...keys.filter(phantom)];
  return cpp.slice(0, count).map((k) => ts.indexOf(k));
}

const alignRule = entries.find((e) => e.data?.rule?.image?.align === 'reference-origin')?.data?.id ?? null;

// ---- static servers and the browser ----
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
/** @param {string} root @param {number} port */
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

const pw = require(path.join(WS, 'e2e', 'node_modules', 'playwright'));
const LAUNCH = {
  headless: true,
  args: ['--disable-gpu', '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'],
};
/** @type {any} */
let browser = null;
let boardsInBrowser = 0;
async function getBrowser() {
  if (browser === null || boardsInBrowser >= RECYCLE) {
    if (browser !== null) await browser.close().catch(() => {});
    browser = await pw.chromium.launch(LAUNCH);
    boardsInBrowser = 0;
  }
  return browser;
}

// The page chrome's own third-party scripts (analytics, Google sign-in), loaded by index.html
// whatever the board: aborted and counted apart, not a harness failure of the board.
const CHROME_HOSTS = /(^|\.)(googletagmanager\.com|statcounter\.com|accounts\.google\.com|google-analytics\.com)$/;
const RES_URL = /\/resources\/([A-Za-z0-9_.-]+)(?:[?#].*)?$/;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

/**
 * A fresh context and page of one build, on the board page with the hooks ready.
 * @param {'cpp' | 'ts'} engine
 */
async function openPage(engine) {
  const b = await getBrowser();
  const context = await b.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.clock.install({ time: '2026-01-15T00:00:00Z' });
  const origin = `http://localhost:${PORTS[engine]}`;
  const net = {
    chrome: 0,
    blocked: 0,
    res: 0,
    resMissing: 0,
    inflight: 0,
    blockedHosts: /** @type {Record<string, number>} */ ({}),
  };
  await page.route('**/*', async (/** @type {any} */ route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    const m = RES_URL.exec(new URL(u).pathname);
    if (m !== null) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const e = resIndex[m[1] ?? ''];
      if (e?.file !== undefined) {
        net.res++;
        return route.fulfill({
          status: 200,
          headers: { ...CORS, 'content-type': 'application/octet-stream' },
          body: readFileSync(path.join(opt.res, e.file)),
        });
      }
      net.resMissing++;
      return route.fulfill({ status: 404, headers: CORS, body: '' });
    }
    if (CHROME_HOSTS.test(new URL(u).host)) {
      net.chrome++;
      return route.abort();
    }
    net.blocked++;
    const host = new URL(u).host + new URL(u).pathname.split('/').slice(0, 3).join('/');
    net.blockedHosts[host] = (net.blockedHosts[host] ?? 0) + 1;
    return route.abort();
  });
  page.on('request', (/** @type {any} */ r) => {
    if (RES_URL.test(r.url())) net.inflight++;
  });
  const fin = (/** @type {any} */ r) => {
    if (RES_URL.test(r.url())) net.inflight--;
  };
  page.on('requestfinished', fin);
  page.on('requestfailed', fin);
  await page.goto(`${origin}/?offline=true&lekhtest=1`);
  await page.waitForFunction(() => /** @type {any} */ (globalThis).__lekhTest !== undefined, null, { timeout: 60000 });
  await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.ready());
  return { context, page, net };
}

/**
 * Loads `text` in a fresh page of `engine` and exports up to MAX_PAGES pages; for TS also the
 * page's objects (ids, kinds, rects) for masking and attribution. `scales` (TS) are the scales
 * the C++ export succeeded at.
 * @param {'cpp' | 'ts'} engine
 * @param {string} text
 * @param {number[] | null} scales
 * @param {boolean} compat
 * @param {any} [wrapCands]
 * @param {any} [refs]
 * @param {number[] | null} [indices]
 */
async function render(engine, text, scales, compat, wrapCands = null, refs = null, indices = null) {
  const t0 = Date.now();
  const { context, page, net } = await openPage(engine);
  try {
    const loaded = await page.evaluate(
      async (/** @type {{ text: string, ts: boolean, compat: boolean }} */ a) => {
        const t = /** @type {any} */ (globalThis).__lekhTest;
        if (a.ts) t.setConfig({ lineSpacingCompat: a.compat, fontFallbackCompat: a.compat });
        const r = await t.loadDoc(a.text, { name: 'image-run' });
        if (!r.ok) return { ok: false, error: String(r.error) };
        await t.settle();
        return { ok: true, pages: t.pageCount() };
      },
      { text, ts: engine === 'ts', compat },
    );
    if (!loaded.ok) return { ok: false, error: loaded.error, net, ms: Date.now() - t0 };
    // C++ settle() waits for decodes, not for the resource fetches in flight: wait for the routed
    // res:// requests to finish, then settle again, until a settle starts none.
    for (let round = 0; round < 10; round++) {
      const before = net.res + net.resMissing;
      const deadline = Date.now() + 20000;
      while (net.inflight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      await page.waitForTimeout(150);
      await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.settle());
      if (net.res + net.resMissing === before && net.inflight === 0) break;
    }
    // DR-TXT-03 attribution: objects holding a word wider than the object, measured in the TS page.
    const overlong =
      wrapCands !== null && wrapCands.length > 0
        ? await page.evaluate(`(${overlongWordsInPage.toString()})(${JSON.stringify(wrapCands)})`)
        : [];
    const n = Math.min(MAX_PAGES, loaded.pages);
    const list = indices ?? Array.from({ length: n }, (_, k) => k);
    const pages = [];
    for (let k = 0; k < list.length; k++) {
      const i = list[k] ?? k;
      const ref = refs === null ? null : (refs[k] ?? null);
      // The C++ board fetches a page's res:// images only when that page is drawn (an export of a
      // page other than the active one starts them and draws without): export, let the fetches
      // finish and decode, and export again until an export starts none (TS awaits its images).
      if (engine === 'cpp') {
        for (let round = 0; round < 5; round++) {
          const before = net.res + net.resMissing;
          await page.evaluate(
            async (/** @type {{ i: number, o: any }} */ a) => {
              await /** @type {any} */ (globalThis).__lekhTest.exportPage(a.i, a.o);
            },
            { i, o: { ...EXPORT, scale: 0.05 } },
          );
          await page.waitForTimeout(120);
          const deadline = Date.now() + 20000;
          while (net.inflight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
          await page.evaluate(() => /** @type {any} */ (globalThis).__lekhTest.settle());
          if (net.res + net.resMissing === before) break;
        }
      }
      const out = await page.evaluate(
        async (/** @type {{ i: number, o: any, scales: number[], ref: any, maxPixels: number }} */ a) => {
          const t = /** @type {any} */ (globalThis).__lekhTest;
          for (const s of a.scales) {
            let e = await t.exportPage(a.i, { ...a.o, scale: s });
            if (e.dataUrl === 'data:,') continue;
            // The box's memory bound (harness, not §B.2): a page over MAX_PIXELS at this scale is
            // exported smaller, both builds at the same scale (decoding and diffing a 16k × 16k
            // page took the comparison process past the box's 7 GB).
            if (a.ref === null && e.width * e.height > a.maxPixels && s !== a.scales[a.scales.length - 1]) continue;
            let reframed = null;
            // DR-ENG-17 (rule.image.align: reference-origin): TS page bounds include the first
            // object's stroke, a half-pixel shift no integer alignment undoes; when the TS plan's
            // rectangle differs from the C++ one, TS re-draws the C++ rectangle.
            if (a.ref !== null) {
              const f = { x: a.ref.ox, y: a.ref.oy, width: a.ref.w / s, height: a.ref.h / s };
              const same =
                Math.abs(e.origin.x - f.x) < 1e-3 &&
                Math.abs(e.origin.y - f.y) < 1e-3 &&
                e.width === a.ref.w &&
                e.height === a.ref.h;
              if (!same) {
                reframed = { ox: e.origin.x, oy: e.origin.y, w: e.width, h: e.height };
                e = await t.exportPage(a.i, { ...a.o, scale: s, frame: f });
              }
            }
            const objs = typeof t.objects === 'function' ? t.objects(a.i) : null;
            return { ok: true, dataUrl: e.dataUrl, origin: e.origin, scale: s, objects: objs, reframed };
          }
          return { ok: false, error: 'empty export at every scale' };
        },
        {
          i,
          o: EXPORT,
          scales: scales === null ? [1, 0.5, 0.25, 0.125, 0.0625] : [scales[k] ?? 1],
          ref,
          maxPixels: MAX_PIXELS,
        },
      );
      if (!out.ok) {
        pages.push({ ok: false, error: out.error });
        continue;
      }
      const img = decodeDataUrl(out.dataUrl);
      if (img === null) pages.push({ ok: false, error: 'export is not a PNG data URL' });
      else
        pages.push({
          ok: true,
          img,
          origin: out.origin ?? { x: 0, y: 0 },
          scale: out.scale,
          objects: out.objects,
          reframed: out.reframed ?? null,
        });
    }
    return { ok: true, pageCount: loaded.pages, pages, net, overlong, ms: Date.now() - t0 };
  } finally {
    await context.close().catch(() => {});
  }
}

/** @param {Promise<any>} p @param {number} ms */
function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { timeout: true })), ms)),
  ]);
}

/** Dilated union of rects (pixel space) as a mask. */
function rectMask(
  /** @type {number} */ w,
  /** @type {number} */ h,
  /** @type {{x:number,y:number,w:number,h:number}[]} */ rects,
  d = 2,
) {
  const m = new Uint8Array(w * h);
  let n = 0;
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x - d));
    const y0 = Math.max(0, Math.floor(r.y - d));
    const x1 = Math.min(w, Math.ceil(r.x + r.w + d));
    const y1 = Math.min(h, Math.ceil(r.y + r.h + d));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const k = y * w + x;
        if (!m[k]) {
          m[k] = 1;
          n++;
        }
      }
  }
  return { mask: m, count: n };
}

/**
 * Compares one page pair: the §B.3 bar, then attribution (§B.6), then the masking fallback (§B.5.2).
 * @param {any} c  C++ page
 * @param {any} t  TS page
 * @param {Map<string, string[]>} flags  object id → flags (from the board JSON)
 */
function comparePage(c, t, flags) {
  const scale = c.scale;
  /** @type {Record<string, any>} */
  const r = {
    status: '',
    scale,
    rules: /** @type {string[]} */ ([]),
    dims_equal: true,
    cpp: { w: c.img.width, h: c.img.height, ox: c.origin.x, oy: c.origin.y },
    ts: { w: t.img.width, h: t.img.height, ox: t.origin.x, oy: t.origin.y },
  };
  if (t.reframed) {
    r.ts_plan = t.reframed;
    if (alignRule !== null) r.rules.push(String(alignRule));
  }
  let a = c.img;
  let b = t.img;
  let origin = c.origin;
  if (a.width !== b.width || a.height !== b.height) {
    r.dims_equal = false;
    const al = align(a, c.origin, b, t.origin, scale);
    a = al.a;
    b = al.b;
    origin = al.origin;
    if (alignRule !== null) r.rules.push(String(alignRule));
  }
  const d = diffImages(a, b);
  const bl = blobs(d.mask, d.width, d.height);
  const v = bar(d, bl, scale);
  Object.assign(r, { fraction: d.fraction, largest_blob: v.largestBlob, width: d.width, height: d.height });
  // §B.3 rule 4: a TS page all background where C++ is not
  const full = { x: 0, y: 0, w: d.width, h: d.height };
  if (inkPixels(b, full) === 0 && inkPixels(a, full) > 0) return { ...r, status: 'empty', a, b };
  if (v.pass && r.dims_equal && r.rules.length === 0) return { ...r, status: 'pass', a, b };
  if (v.pass) return { ...r, status: 'pass_rules', a, b };

  // §B.6 attribution: blobs over objects whose flags a register rule claims.
  const objs = (t.objects ?? []).map((/** @type {any} */ o) => ({
    id: o.id,
    kind: o.kind,
    px: {
      x: (o.rect.x - origin.x) * scale,
      y: (o.rect.y - origin.y) * scale,
      w: o.rect.w * scale,
      h: o.rect.h * scale,
    },
    flags: [...(flags.get(o.id) ?? []), ...(o.kind === 'connector' ? [] : [])],
  }));
  // A blob is over an object when it meets the object's rectangle grown by 2 px and by 30 % of its
  // size each way: text that overflows its box (C++ lets an over-long word or a CJK line run past
  // the box, DR-TXT-03) and stroke or arrowhead overhang are the object's own pixels.
  // An object flagged text-wrap (DR-TXT-03) also owns blobs anywhere in its horizontal band: a C++
  // line that never wrapped (CJK, Thai, a URL) runs past the box sideways, any distance.
  const hit = (/** @type {any} */ bb) =>
    objs.filter((/** @type {any} */ o) => {
      const gx = 2 + 0.3 * o.px.w;
      const gy = 2 + 0.3 * o.px.h;
      const band = bb.y < o.px.y + o.px.h + gy && o.px.y - gy < bb.y + bb.h;
      if (band && o.flags.includes('text-wrap')) return true;
      return band && bb.x < o.px.x + o.px.w + gx && o.px.x - gx < bb.x + bb.w;
    });
  let unexplained = d.count;
  let largestUnexplained = 0;
  /** @type {{ x: number, y: number, w: number, h: number, px: number }[]} */
  const unexplainedBlobs = [];
  /** @type {Set<string>} */
  const applied = new Set();
  /** @type {Record<string, number>} */
  const flagsUnder = {};
  for (const blob of bl) {
    const under = hit(blob);
    const fl = new Set(under.flatMap((/** @type {any} */ o) => o.flags.concat(`kind:${o.kind}`)));
    const rule = attributeRules.find((ar) => fl.has(ar.flag));
    if (rule !== undefined) {
      applied.add(rule.id);
      unexplained -= blob.pixels;
      continue;
    }
    largestUnexplained = Math.max(largestUnexplained, blob.pixels);
    if (blob.pixels > maxBlob(scale))
      unexplainedBlobs.push({ x: blob.x, y: blob.y, w: blob.w, h: blob.h, px: blob.pixels });
    if (blob.pixels > maxBlob(scale))
      for (const f of fl.size > 0 ? fl : new Set(['none'])) flagsUnder[f] = (flagsUnder[f] ?? 0) + 1;
  }
  r.rules.push(...applied);
  unexplainedBlobs.sort((p, q) => q.px - p.px);
  Object.assign(r, {
    unexplained_fraction: unexplained / d.total,
    largest_unexplained: largestUnexplained,
    flags_under: flagsUnder,
    blobs_top: unexplainedBlobs.slice(0, 5),
  });
  if (unexplained / d.total < 0.001 && largestUnexplained <= maxBlob(scale))
    return { ...r, status: 'pass_rules', a, b };

  // §B.5.2 masking fallback: text objects with ≥ 2 lines, dilated by 2 px, on both images.
  const multi = objs
    .filter((/** @type {any} */ o) => o.flags.includes('multiline-text'))
    .map((/** @type {any} */ o) => o.px);
  if (multi.length > 0) {
    const m = rectMask(d.width, d.height, multi);
    const masked = m.count / d.total;
    r.masked_fraction = masked;
    if (masked > 0.5) return { ...r, status: 'not_compared', a, b };
    const dm = diffImages(a, b, { ignore: m.mask });
    const blm = blobs(dm.mask, dm.width, dm.height);
    let un = dm.count;
    let lg = 0;
    for (const blob of blm) {
      const fl = new Set(hit(blob).flatMap((/** @type {any} */ o) => o.flags.concat(`kind:${o.kind}`)));
      if (attributeRules.some((ar) => fl.has(ar.flag))) un -= blob.pixels;
      else lg = Math.max(lg, blob.pixels);
    }
    r.masked_unexplained_fraction = un / dm.total;
    if (un / dm.total < 0.001 && lg <= maxBlob(scale)) {
      r.rules.push('mask:multiline-text');
      return { ...r, status: 'pass_rules', a, b };
    }
  }
  return { ...r, status: 'fail', a, b };
}

/**
 * For a phantom-page board: the TS page nearest each C++ page by drawing rectangle (origin and
 * size in board points, from a scale-0.125 export of every TS page, at most 16), falling back to
 * `guess` on a tie. Returns TS indices aligned with `cppPages`.
 * @param {string} text
 * @param {any[]} cppPages
 * @param {number[]} guess
 */
async function pairByGeometry(text, cppPages, guess) {
  const { context, page } = await openPage('ts');
  try {
    const geo = await page.evaluate(
      async (/** @type {{ text: string, compat: boolean }} */ a) => {
        const t = /** @type {any} */ (globalThis).__lekhTest;
        t.setConfig({ lineSpacingCompat: a.compat, fontFallbackCompat: a.compat });
        await t.loadDoc(a.text, { name: 'pairing' });
        await t.settle();
        const out = [];
        for (let j = 0; j < Math.min(16, t.pageCount()); j++) {
          const e = await t.exportPage(j, { region: 'drawing', padding: 20, scale: 0.125, background: false });
          out.push({ ox: e.origin.x, oy: e.origin.y, w: e.width / 0.125, h: e.height / 0.125 });
        }
        return out;
      },
      { text, compat: COMPAT },
    );
    const used = new Set();
    return cppPages.map((cp, i) => {
      if (!cp?.ok) return guess[i] ?? i;
      const w = cp.img.width / cp.scale;
      const h = cp.img.height / cp.scale;
      let best = guess[i] ?? i;
      let bestD = Infinity;
      geo.forEach((/** @type {any} */ g, /** @type {number} */ j) => {
        if (used.has(j)) return;
        const d = Math.abs(g.ox - cp.origin.x) + Math.abs(g.oy - cp.origin.y) + Math.abs(g.w - w) + Math.abs(g.h - h);
        if (d < bestD - 1e-9 || (Math.abs(d - bestD) < 1e-9 && j === guess[i])) {
          bestD = d;
          best = j;
        }
      });
      used.add(best);
      return best;
    });
  } finally {
    await context.close().catch(() => {});
  }
}

/** Deterministic per-board choice for the self-diff (§B.3 rule 3). @param {string} idx */
const selfdiffPick = (idx) =>
  parseInt(createHash('sha256').update(`${opt.seed}:${idx}`).digest('hex').slice(0, 8), 16) / 0xffffffff < SELFDIFF;

// ---- run ----
const servers = [
  await serveStatic(path.resolve(opt.builds, 'cpp'), PORTS.cpp),
  await serveStatic(path.resolve(opt.builds, 'ts'), PORTS.ts),
];

const runJson = path.join(OUT, 'run.json');
if (!existsSync(runJson)) {
  const env = (/** @type {string} */ c) => {
    try {
      return execSync(c, { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  /** @type {Record<string, any>} */
  const id = {};
  for (const e of /** @type {const} */ (['cpp', 'ts'])) {
    const { context, page } = await openPage(e);
    id[e] = await page.evaluate(() => {
      const t = /** @type {any} */ (globalThis).__lekhTest;
      return { version: t.version, engine: t.engine, build: t.build };
    });
    await context.close();
  }
  writeFileSync(
    runJson,
    JSON.stringify(
      {
        started: new Date().toISOString(),
        input: path.relative(WS, path.resolve(opt.input)),
        which: opt.which,
        compat: COMPAT,
        export: EXPORT,
        max_pages: MAX_PAGES,
        selfdiff_rate: SELFDIFF,
        seed: opt.seed,
        builds: path.resolve(opt.builds),
        identities: id,
        chromium: pw.chromium.executablePath(),
        fonts: { sans: env('fc-match sans-serif'), fc_list_sha256: env('fc-list | sort | sha256sum | cut -c1-16') },
        register_attribute_rules: attributeRules,
        lekhjs_commit: env(`git -C ${path.resolve(PARITY, '..')} rev-parse --short HEAD`),
      },
      null,
      1,
    ),
  );
}

let processed = 0;
const tStart = Date.now();
for (const { idx, file } of inputs) {
  if (done.has(idx)) continue;
  if (LIMIT > 0 && processed >= LIMIT) break;
  processed++;
  boardsInBrowser++;
  const text = readFileSync(file, 'utf8');
  /** @type {Record<string, any>} */
  const row = { idx, bytes: text.length };
  const tBoard = Date.now();
  try {
    const doc = JSON.parse(text);
    const flags = flagsByObject(doc);
    const c = await withTimeout(render('cpp', text, null, COMPAT), BOARD_TIMEOUT);
    const scales = c.ok ? c.pages.map((/** @type {any} */ p) => (p.ok ? p.scale : 1)) : null;
    const refs =
      c.ok && alignRule !== null
        ? c.pages.map((/** @type {any} */ p) =>
            p.ok ? { ox: p.origin.x, oy: p.origin.y, w: p.img.width, h: p.img.height } : null,
          )
        : null;
    // DR-FMT-01: C++ shows a phantom page (objects only) at order 0, TS after the real pages; the
    // pages are paired by their stored key, not by index.
    let tsIndices = c.ok ? phantomPageMap(doc, c.pages.length) : null;
    // The key-order guess is checked against the pages' drawing rectangles: each C++ page is paired
    // with the TS page whose rectangle (origin and size, board points) is nearest.
    if (tsIndices !== null) tsIndices = await pairByGeometry(text, c.pages, tsIndices);
    const t = await withTimeout(
      render('ts', text, scales, COMPAT, wrapCandidates(doc), refs, tsIndices),
      BOARD_TIMEOUT,
    );
    if (tsIndices !== null) row.page_map = tsIndices;
    // text-wrap (DR-TXT-03): an over-long word or a wrapping hyphen/slash paragraph (measured in
    // the TS page), or CJK/Thai text (native wrap).
    for (const id of t.overlong ?? []) flags.set(id, [...(flags.get(id) ?? []), 'text-wrap']);
    for (const [id, f] of flags)
      if (f.includes('cjk-text') && !f.includes('text-wrap')) flags.set(id, [...f, 'text-wrap']);
    row.ms = { cpp: c.ms, ts: t.ms };
    row.net = { cpp: c.net, ts: t.net };
    if (!c.ok || !t.ok)
      row.load_error = {
        cpp: c.ok ? null : String(c.error).slice(0, 120),
        ts: t.ok ? null : String(t.error).slice(0, 120),
      };
    if (c.net.blocked + t.net.blocked > 0) row.status = 'harness:blocked';
    else if (c.net.resMissing + t.net.resMissing > 0) row.status = 'harness:res_missing';
    else if (!c.ok && !t.ok) row.status = 'both_fail';
    else if (!c.ok) row.status = 'cpp_fail';
    else if (!t.ok) row.status = 'ts_fail';
    else if (c.pageCount !== t.pageCount) row.status = 'pagecount';
    if (c.ok && t.ok) {
      row.pages_total = c.pageCount;
      row.pages = [];
      for (let i = 0; i < c.pages.length; i++) {
        const cp = c.pages[i];
        const tp = t.pages[i];
        if (!cp?.ok || !tp?.ok) {
          row.pages.push({ i, status: !cp?.ok ? 'cpp_export_fail' : 'ts_export_fail' });
          continue;
        }
        /** @type {any} */
        const res = comparePage(cp, tp, flags);
        if (tsIndices !== null && tsIndices[i] !== i && phantomRule !== null) {
          res.rules.push(phantomRule);
          if (res.status === 'pass') res.status = 'pass_rules';
          // The pairing is checked: the TS page's objects must be the C++ page's stored ones.
          const ids = new Set(Object.keys(doc.pages[pagePairKey(doc, i)]?.objects ?? {}));
          if ((tp.objects ?? []).some((/** @type {any} */ o) => !ids.has(o.id)))
            /** @type {any} */ (res).page_map_mismatch = true;
        }
        const { a, b, ...rest } = res;
        row.pages.push({ i, ...rest });
        if (opt.save === 'all' || (opt.save === 'fail' && !['pass', 'pass_rules'].includes(res.status))) {
          writeFileSync(path.join(OUT, 'png', `${idx}-p${i}-cpp.png`), encodePng(a));
          writeFileSync(path.join(OUT, 'png', `${idx}-p${i}-ts.png`), encodePng(b));
          writeFileSync(path.join(OUT, 'png', `${idx}-p${i}-diff.png`), encodePng(diffPicture(a, b)));
          writeFileSync(
            path.join(OUT, 'png', `${idx}-p${i}-objects.json`),
            JSON.stringify((tp.objects ?? []).map((/** @type {any} */ o) => ({ ...o, flags: flags.get(o.id) ?? [] }))),
          );
        }
      }
      // §B.3 rule 3: self-diff of both builds in fresh contexts on a seeded 1 %.
      if (selfdiffPick(idx)) {
        const c2 = await withTimeout(render('cpp', text, null, COMPAT), BOARD_TIMEOUT);
        const t2 = await withTimeout(render('ts', text, scales, COMPAT, null, refs, tsIndices), BOARD_TIMEOUT);
        const same = (/** @type {any} */ x, /** @type {any} */ y) =>
          x.ok &&
          y.ok &&
          x.pages.length === y.pages.length &&
          x.pages.every(
            (/** @type {any} */ p, /** @type {number} */ k) =>
              p.ok && y.pages[k].ok && identical(p.img, y.pages[k].img),
          );
        row.selfdiff = { cpp: same(c, c2), ts: same(t, t2) };
        if (!row.selfdiff.cpp || !row.selfdiff.ts) for (const p of row.pages) p.status = 'nondeterministic';
      }
    }
  } catch (e) {
    const err = /** @type {any} */ (e);
    row.status = err?.timeout ? 'harness:timeout' : 'harness:error';
    row.error = String(err?.message ?? err).slice(0, 300);
    if (browser !== null) await browser.close().catch(() => {});
    browser = null;
  }
  row.wall_ms = Date.now() - tBoard;
  appendFileSync(RESULTS, JSON.stringify(row) + '\n');
  if (processed % 25 === 0) {
    const rate = (Date.now() - tStart) / processed / 1000;
    process.stdout.write(`progress: ${processed} boards this run, ${rate.toFixed(1)} s/board\n`);
  }
}
if (browser !== null) await browser.close().catch(() => {});
for (const s of servers) {
  /** @type {any} */ (s).closeAllConnections();
  await new Promise((r) => /** @type {any} */ (s).close(r));
}
const remaining = inputs.filter((x) => !done.has(x.idx)).length - processed;
process.stdout.write(`done: ${processed} boards this run, ${Math.max(0, remaining)} left\n`);
