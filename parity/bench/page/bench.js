// The in-page bench of verification 03 §4.3 (T21, floor devices; H-REC-4, H-ROL-4): the C++ web
// build and the TS web build (bench-dist/{cpp,ts}/, both built with VITE_LEKH_TEST_ANY_HOST=1) are
// served at "/" of this page's origin, the one the `lekhbench` cookie names (build-device-bench.mjs
// --serve), each opened in an iframe and driven through
// the v1 `window.__lekhTest` hooks with the same code as the box bench (web-bench.mjs):
//
//   P-01  warm load + first frame: loadDoc → settle, one sample per board
//   P-02  pan/zoom frame time: 150 pan steps of 40 px, 150 zoom steps 0.25 → 4 → 1, drawFrame() each
//   P-03  hit test: 10,000 seeded points, 'near' and 'connection', in batches of 200 (§3.2.5)
//
// One discarded warm-up pass per build, then N passes interleaved C++, TS, TS, C++, … with a pause
// between engine switches (default 180 s, §4.3 step 4). Each pass reloads the build's iframe. The
// result JSON (perf-device/1) carries the raw per-pass samples; `node parity/bench/verdict.mjs
// <file>` turns it into the §6.3 table. Synthetic boards only (boards/*.json, from synth.mjs).
//
// URL: bench.html?lekhtest=1[&engines=cpp|ts][&runs=5][&pause=180][&boards=a,b][&metrics=P-01,P-02,P-03][&device=name]
//      [&post=1: also POST the result JSON to the bench server][&autostart=1]
/* global document, location */

const q = new URLSearchParams(location.search);
const RUNS = Number(q.get('runs') ?? 5);
const PAUSE_S = Number(q.get('pause') ?? 180);
const METRICS = new Set((q.get('metrics') ?? 'P-01,P-02,P-03').split(','));
const DEVICE = q.get('device') ?? '';
// engines=cpp or engines=ts: one engine only, so a driver can give each run its own fresh WebView
// process (on iOS a C++ pass on a large board can end the WebView content process).
const ENGINES = (q.get('engines') ?? 'cpp,ts').split(',');
const out = document.getElementById('log');
const log = (/** @type {string} */ s) => {
  out.textContent += s + '\n';
  out.scrollTop = out.scrollHeight;
};

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Removes a build's iframe. WebKit frees a canvas backing store only on GC, so the canvases are shrunk
 * to 0 x 0 first; otherwise the next build's getContext('2d') can return null under the canvas memory
 * cap (seen on an iPhone 8: the C++ board then never installs its hooks).
 * @param {HTMLIFrameElement} f
 */
function releaseFrame(f) {
  try {
    for (const c of f.contentDocument?.querySelectorAll('canvas') ?? []) {
      c.width = 0;
      c.height = 0;
    }
  } catch {
    // A frame we cannot reach: just remove it.
  }
  f.remove();
}

/** Opens a build, retried up to twice when its hooks did not appear. @param {'cpp' | 'ts'} engine */
async function openBuild(engine) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await openBuildOnce(engine);
    } catch (e) {
      if (attempt >= 3 || !/no __lekhTest/.test(String(/** @type {any} */ (e)?.message))) throw e;
      log(`${engine}: hooks missing, retry ${attempt}`);
    }
  }
}

/** Opens a fresh iframe on the build and waits for its hooks. @param {'cpp' | 'ts'} engine */
async function openBuildOnce(engine) {
  const old = document.getElementById('frame');
  if (old) releaseFrame(/** @type {HTMLIFrameElement} */ (old));
  const f = document.createElement('iframe');
  f.id = 'frame';
  f.width = '1280';
  f.height = '800';
  document.cookie = `lekhbench=${engine}; path=/; SameSite=Strict`;
  f.src = `/?offline=true&lekhtest=1&engine=${engine}`;
  document.getElementById('stage').appendChild(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  const w = /** @type {any} */ (f.contentWindow);
  for (let i = 0; i < 600 && w.__lekhTest === undefined; i++) await sleep(100);
  if (w.__lekhTest === undefined)
    throw new Error(`${engine}: no __lekhTest (built without VITE_LEKH_TEST_ANY_HOST=1?)`);
  if (w.__lekhTest.engine !== engine)
    throw new Error(`asked for ${engine}, got ${w.__lekhTest.engine} (cookie not honoured?)`);
  await w.__lekhTest.ready();
  return w;
}

/** One board on one build: the box bench's per-board measurement. */
async function measure(/** @type {any} */ w, /** @type {any} */ b) {
  const t = w.__lekhTest;
  const perf = w.performance;
  /** @type {Record<string, any>} */
  const res = {};
  const l0 = perf.now();
  const ld = await t.loadDoc(b.text, { name: 'bench' });
  if (!ld.ok) return { error: String(ld.error) };
  await t.settle();
  res.load = perf.now() - l0;
  // As the box bench (web-bench.mjs, IM1): P-01 above waits for fonts and paint but not images on
  // either build; the pan/zoom and hit paths run with the images decoded (untimed).
  await t.settle({ images: true });
  const v0 = t.getView();
  if (METRICS.has('P-02')) {
    const vw = w.innerWidth / 2;
    const vh = w.innerHeight / 2;
    const cx = (vw - v0.tx) / v0.zoom;
    const cy = (vh - v0.ty) / v0.zoom;
    const frames = [];
    for (let k = 0; k < 150; k++) {
      const dx = k < 75 ? -40 * (k + 1) : -40 * (150 - k - 1);
      t.setView({ zoom: v0.zoom, tx: v0.tx + dx, ty: v0.ty });
      frames.push(t.drawFrame().ms);
      await sleep(0);
    }
    for (let k = 0; k < 150; k++) {
      const z = k < 75 ? 0.25 * Math.pow(16, k / 74) : 4 * Math.pow(0.25, (k - 75) / 74);
      t.setView({ zoom: z, tx: vw - cx * z, ty: vh - cy * z });
      frames.push(t.drawFrame().ms);
      await sleep(0);
    }
    res.frames = frames;
    t.setView(v0);
  }
  if (METRICS.has('P-03') && b.hit) {
    let s = 20261018 >>> 0;
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let x = s;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const pts = new Float64Array(20000);
    for (let i = 0; i < pts.length; i++) pts[i] = rnd() * (b.side ?? 6000);
    const B = 200;
    /** @type {Record<string, number[]>} */
    const hit = { near: [], connection: [] };
    for (const kind of ['near', 'connection']) {
      for (let i = 0; i < pts.length; i += 2 * B) hit[kind].push(t.hitTest(pts.subarray(i, i + 2 * B), kind).ms / B);
    }
    res.hit = hit;
  }
  return res;
}

/** One pass of one build over every board. @param {'cpp' | 'ts'} engine @param {any[]} boards */
async function pass(engine, boards) {
  const w = await openBuild(engine);
  /** @type {Record<string, any>} */
  const r = { _meta: { engine, isolated: w.crossOriginIsolated === true, build: w.__lekhTest.build } };
  for (const b of boards) {
    try {
      r[b.name] = await measure(w, b);
    } catch (e) {
      r[b.name] = { error: String(/** @type {any} */ (e)?.message ?? e).slice(0, 160) };
    }
  }
  return r;
}

async function main() {
  const manifest = await (await fetch('boards/manifest.json')).json();
  const only = q.get('boards');
  const pick = only
    ? manifest.boards.filter((/** @type {any} */ b) => only.split(',').includes(b.set))
    : manifest.boards;
  /** @type {any[]} */
  const boards = [];
  for (const b of pick) boards.push({ ...b, text: await (await fetch(`boards/${b.file}`)).text() });
  log(`device ${DEVICE || navigator.userAgent}; ${boards.length} boards; ${RUNS} runs per build; pause ${PAUSE_S} s`);
  const started = new Date().toISOString();
  if (ENGINES.includes('cpp')) {
    log('warm-up C++');
    await pass('cpp', boards);
  }
  if (ENGINES.includes('ts')) {
    log('warm-up TS');
    await pass('ts', boards);
  }
  const order = [];
  for (let i = 0; order.length < 2 * RUNS; i++) order.push(...(i % 2 === 0 ? ['cpp', 'ts'] : ['ts', 'cpp']));
  for (let i = order.length - 1; i >= 0; i--) if (!ENGINES.includes(order[i])) order.splice(i, 1);
  /** @type {{ cpp: any[], ts: any[] }} */
  const runs = { cpp: [], ts: [] };
  let prev = 'ts';
  for (const e of order) {
    if (e !== prev && PAUSE_S > 0) {
      log(`pause ${PAUSE_S} s before ${e}`);
      await sleep(PAUSE_S * 1000);
    }
    prev = e;
    const t0 = Date.now();
    runs[/** @type {'cpp' | 'ts'} */ (e)].push(await pass(/** @type {any} */ (e), boards));
    log(`run ${e} #${runs[/** @type {'cpp' | 'ts'} */ (e)].length} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  const last = document.getElementById('frame');
  if (last) releaseFrame(/** @type {HTMLIFrameElement} */ (last));
  const result = {
    schema: 'perf-device/1',
    device: DEVICE,
    user_agent: navigator.userAgent,
    started,
    finished: new Date().toISOString(),
    runs_per_build: RUNS,
    pause_s: PAUSE_S,
    metrics: [...METRICS],
    order,
    boards: boards.map((b) => ({ set: b.set, name: b.name, objects: b.objects })),
    runs,
  };
  const text = JSON.stringify(result);
  document.getElementById('result').value = text;
  const a = /** @type {HTMLAnchorElement} */ (document.getElementById('download'));
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `perf-device-${(DEVICE || 'device').replace(/[^A-Za-z0-9-]+/g, '_')}-${started.slice(0, 16).replace(/[:T]/g, '')}.json`;
  a.style.display = 'inline';
  if (q.get('post') === '1') {
    // build-device-bench.mjs --serve stores a POSTed result under <out>/results/ (no Download step).
    const r = await fetch('result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
    log(r.ok ? `posted to the bench server: ${await r.text()}` : `post failed: ${r.status}`);
  }
  log('done: press Download and send the file');
}

document.getElementById('start').addEventListener('click', () => {
  document.getElementById('start').setAttribute('disabled', 'true');
  main().catch((e) => log(`FAILED: ${e?.message ?? e}`));
});
if (q.get('autostart') === '1') document.getElementById('start').click();
