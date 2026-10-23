// Reference capture for the recognizer parity run (spec 07 §7.4.1): every case of
// test/recognizer/corpus/ goes through `window.__lekhTest.recognizeStroke` of the owner-built C++
// web wasm (H-REC-2) in headless Chromium, and the recorded delegate calls are written to
// test/recognizer/parity/reference/<case>.json with reference/MANIFEST.json (`{ wasmCommit,
// wasmSha256, capturedAt, lineAggregatorId, tsLineAggregatorId, tsComparedAt, cases }`, AC-REC-33);
// the oracle's path and build info go to reference-provenance.json beside this tool (AC-ARC-12).
//
// Each case is also run on 8 seeded ±0.01 px jitters of its stroke; their calls (ink points left
// out) are kept beside the reference so the comparison can apply the borderline rule (§7.4.2: a
// discrete mismatch is accepted only if a jitter flips the wasm's own outcome).
//
//   node parity/tools/rec-parity/capture.mjs [--url http://127.0.0.1:4009] [--webapp <lekhboardwebapp checkout>]
//                                            [--only <name-substring>]
//
// Needs the C++ web board (lekhboardwebapp/v2 with the owner-built wasm) served on 127.0.0.1 (never
// all interfaces). Its permanent home during the Work is the detached oracle worktree at fa71c40
// (the default --webapp), because ws/lekhboardwebapp moves to the TS board:
//   (cd ../../oracle/lekhboardwebapp/v2 && npx vite --host 127.0.0.1 --port 4009 --strictPort)
// The served wasm must be byte-identical to <webapp>/v2/public/a1/lekhapp.wasm (checked).
// and Playwright from the e2e package (E2E_NODE_MODULES, default ../e2e/node_modules). Hold the
// heavy-job lock. Re-captured only on purpose: the files are committed.

/** @typedef {Record<string, any> & { op: string }} Call */
/** @typedef {{ name: string, origin: string, scene: string, view: { zoom: number, tx: number, ty: number }, strokeWidth: number, points: number[] }} Case */
/** @typedef {{ version: number, engine: string, build: any, ready(): Promise<void>, recognizeStroke(i: object): { calls: Call[] } }} LekhTest */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const HERE = import.meta.dirname;
const PKG = path.resolve(HERE, '../../..');
const WS = path.resolve(PKG, '..');
const CORPUS = path.join(PKG, 'test', 'recognizer', 'corpus');
const REF = path.join(PKG, 'test', 'recognizer', 'parity', 'reference');
const OUT = path.join(PKG, 'parity', 'out', 'rec-parity');

const args = process.argv.slice(2);
/** @param {string} name @param {string} dflt @returns {string} */
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return (i >= 0 ? args[i + 1] : undefined) ?? dflt;
};
const URL_ = opt('--url', 'http://127.0.0.1:4009');
const WEBAPP = path.resolve(opt('--webapp', path.resolve(WS, '..', 'oracle', 'lekhboardwebapp')));
const WASM = path.join(WEBAPP, 'v2', 'public', 'a1', 'lekhapp.wasm');
const ONLY = opt('--only', '');
const JITTERS = 8;
const JITTER_PX = 0.01;

const require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(process.env.E2E_NODE_MODULES ?? path.join(WS, 'e2e', 'node_modules'), 'playwright'),
);

/** Park-Miller LCG (as corpus.mjs). @param {number} seed */
function lcg(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

/**
 * Jitter `k` (1…8) of a flat stroke: every coordinate moved by up to ±0.01 px.
 * @param {number[]} points @param {number} k @returns {number[]}
 */
export function jittered(points, k) {
  const rnd = lcg(9973 * k + 17);
  return points.map((v) => v + (rnd() * 2 - 1) * JITTER_PX);
}

const stripInk = (/** @type {Call[]} */ calls) =>
  calls.map((c) => (c.op === 'ink' ? { op: 'ink', n: c.points.length / 2 } : c));

/** @param {string} repo @param {string[]} a */
function git(repo, ...a) {
  return execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
}

/** @type {{ cases: Case[] }} */
const { cases } = JSON.parse(readFileSync(path.join(CORPUS, 'strokes.json'), 'utf8'));
/** @type {{ scenes: Record<string, unknown> }} */
const { scenes } = JSON.parse(readFileSync(path.join(CORPUS, 'scenes.json'), 'utf8'));
const todo = cases.filter((c) => c.name.includes(ONLY));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${URL_}/?offline=true&lekhtest=1`);
await page.waitForFunction(() => /** @type {any} */ (globalThis).__lekhTest !== undefined, null, { timeout: 60000 });
const build = await page.evaluate(async () => {
  const t = /** @type {LekhTest} */ (/** @type {any} */ (globalThis).__lekhTest);
  await t.ready();
  return { version: t.version, engine: t.engine, build: t.build };
});
if (build.version !== 1 || build.engine !== 'cpp')
  throw new Error(`not the C++ __lekhTest v1 build: ${JSON.stringify(build)}`);
const servedSha = build.build.wasmSha256;
const diskSha = createHash('sha256').update(readFileSync(WASM)).digest('hex');
if (servedSha !== diskSha) throw new Error(`served wasm ${servedSha} is not ${path.relative(WS, WASM)} (${diskSha})`);

if (!ONLY) {
  rmSync(REF, { recursive: true, force: true });
}
mkdirSync(REF, { recursive: true });
mkdirSync(OUT, { recursive: true });

/** @type {{ name: string, scene: string, ms: number }[]} */
const timings = [];
for (const c of todo) {
  const boardJson = JSON.stringify(scenes[c.scene]);
  const run = (/** @type {number[]} */ points) =>
    page.evaluate(
      (
        /** @type {{ boardJson: string, view: object, strokeWidth: number, points: number[] }} */ {
          boardJson,
          view,
          strokeWidth,
          points,
        },
      ) => {
        const t0 = performance.now();
        const out = /** @type {LekhTest} */ (/** @type {any} */ (globalThis).__lekhTest).recognizeStroke({
          boardJson,
          view,
          strokeWidth,
          points,
        });
        const ms = performance.now() - t0;
        return {
          ms,
          calls: /** @type {Call[]} */ (
            JSON.parse(JSON.stringify(out.calls, (_k, v) => (v instanceof Float64Array ? Array.from(v) : v)))
          ),
        };
      },
      { boardJson, view: c.view, strokeWidth: c.strokeWidth, points },
    );
  const base = await run(c.points);
  /** @type {Call[][]} */
  const jitter = [];
  for (let k = 1; k <= JITTERS; k++) jitter.push(stripInk((await run(jittered(c.points, k))).calls));
  // Includes the scene load (negligible on the empty board, which the perf summary uses).
  timings.push({ name: c.name, scene: c.scene, ms: base.ms });
  writeFileSync(
    path.join(REF, `${c.name}.json`),
    `${JSON.stringify({ name: c.name, origin: c.origin, calls: base.calls, jitter }, null, 0)}\n`,
  );
}

const files = readdirSync(REF).filter((f) => f.endsWith('.json') && f !== 'MANIFEST.json');
// The reference under test/ carries what AC-REC-33 checks (the wasm commit and sha256, the
// LineAggregator id) and no path or repository name of the oracle (AC-ARC-12: nothing in
// lekhjs/test names one); where the oracle came from — its path and the C++ build info — is
// written beside this tool, in parity/ (spec 01 §7 rule 2).
const PROVENANCE = path.join(HERE, 'reference-provenance.json');
const manifest = {
  about:
    'Recognizer parity reference (spec 07 §7.4.1), captured by parity/tools/rec-parity/capture.mjs through window.__lekhTest.recognizeStroke.',
  wasmCommit: git(WEBAPP, 'log', '-1', '--format=%H', '--', 'v2/public/a1/lekhapp.wasm'),
  wasmSha256: servedSha,
  provenance: 'parity/tools/rec-parity/reference-provenance.json',
  lineAggregatorId: build.build.lineAggregator,
  // The TS line aggregator id (lekhjs lineAggregatorImplModule.id) this reference was last compared
  // against, and the date: set by hand after a REC_PARITY=1 run (AC-REC-33, parity.test.ts); a fresh
  // capture has not been compared yet.
  tsLineAggregatorId: null,
  tsComparedAt: null,
  capturedAt: new Date().toISOString(),
  browser: `chromium ${browser.version()} (headless)`,
  jitter: { variants: JITTERS, px: JITTER_PX },
  cases: files.length,
};
const provenance = {
  about: 'Where the recognizer parity reference (test/recognizer/parity/reference/) came from: the C++ web oracle.',
  wasmCommit: manifest.wasmCommit,
  wasmPath: 'lekhboardwebapp/v2/public/a1/lekhapp.wasm',
  wasmSha256: servedSha,
  wasmBuild: build.build.info,
  lekhcoreCommit: build.build.commit,
  capturedAt: manifest.capturedAt,
};
writeFileSync(PROVENANCE, `${JSON.stringify(provenance, null, 2)}\n`);
writeFileSync(path.join(REF, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  path.join(OUT, 'wasm-timings.json'),
  `${JSON.stringify({ capturedAt: manifest.capturedAt, timings }, null, 0)}\n`,
);
await browser.close();
console.log(
  `captured ${todo.length} cases (${files.length} in reference/), wasm ${manifest.wasmCommit.slice(0, 7)} ${servedSha.slice(0, 12)}, lineAggregator ${manifest.lineAggregatorId}`,
);
