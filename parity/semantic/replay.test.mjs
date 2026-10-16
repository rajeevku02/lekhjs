// The semantic parity replay (AC-BE-07, lekhjs side): every case kashi's core tier ran on the
// vendored backend wasm — captured by `tools/semantic-capture/capture-setup.cjs` and de-duplicated
// by `dedupe.mjs` — is run again through lekhjs's `semantic/` from `src/`, and the two answers are
// compared after renaming the ids each engine minted (verification 02 §A.5 step 6) and with the JSON
// tool's numeric tolerance (`../json/tolerance.cjs`).
//
//   npx vitest run --config parity/semantic/vitest.config.mjs              (all cases)
//   SEMANTIC_OPS=project,lint SEMANTIC_LIMIT=50 SEMANTIC_ID=<id> …        (a subset)
//   SEMANTIC_CASES=<cases.jsonl>  SEMANTIC_REPORT=<dir>                    (paths)
//
// Writes `<report>/<op>.json` (per case: status and the first differences) and `summary.json`, and
// prints the summary. It asserts nothing unless SEMANTIC_STRICT=1 (then: no `differs`, no `threw`).
// The text measurement runs over @napi-rs/canvas with the test-only `lineSpacingCompat` and
// `fontFallbackCompat` switches on, as the JSON comparison does (spec 06 §3.6).
import { createCanvas } from '@napi-rs/canvas';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/generators';
import { compile, generate, lint, project } from '../../src/semantic';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler, createTestRuntime, sequentialIds } from '../../src/testing';

const require = createRequire(import.meta.url);
const { withinTolerance } = require('../json/tolerance.cjs');

const HERE = import.meta.dirname;
const LEKHJS = path.resolve(HERE, '..', '..');
const KASHI = path.resolve(process.env.LEKH_KASHI_DIR ?? path.join(LEKHJS, '..', 'lbs', 'kashi'));
const CAPTURE = path.join(LEKHJS, 'parity', 'out', 'semantic-capture');
const CASES = path.resolve(process.env.SEMANTIC_CASES ?? path.join(CAPTURE, 'cases.jsonl'));
const TEXTS = path.join(path.dirname(CASES), 'texts');
const REPORT = path.resolve(process.env.SEMANTIC_REPORT ?? path.join(LEKHJS, 'parity', 'out', 'semantic-report'));
const OPS = (process.env.SEMANTIC_OPS ?? 'project,compile,generate,lint,visualBounds').split(',');
const LIMIT = Number(process.env.SEMANTIC_LIMIT ?? '0');
const ONLY = process.env.SEMANTIC_ID ?? '';
const STRICT = process.env.SEMANTIC_STRICT === '1';
const MAX_DIFFS = 12;
const SKIP = new Set(['_index.json', '_text_syntax.json', 'libnames.json']);

/** @param {string} dir */
function libraryFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !SKIP.has(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
}

/** The catalogue kashi's wasm had: the published (v4) set, then lekhjs's core and builtin sets. */
function catalog() {
  return buildCatalog([
    ...libraryFiles(path.join(KASHI, 'vendor', 'stencils', 'published')),
    ...libraryFiles(path.join(LEKHJS, 'stencils', 'core')),
    ...libraryFiles(path.join(LEKHJS, 'stencils', 'builtin')),
  ]);
}

/** @param {string | undefined} ref */
const text = (ref) => (ref === undefined ? undefined : readFileSync(path.join(TEXTS, ref + '.txt'), 'utf8'));

// ---------------------------------------------------------------- canonicalisation

const ID_RE = /[1-9A-HJ-NP-Za-km-z]{21,22}/g;

/**
 * Renames every 21-22 character base58 token that the inputs do not contain (an id the engine
 * minted) to `#<n>`, numbered by first appearance in a sorted-key walk, inside keys and strings.
 * @param {unknown} tree @param {string} inputs
 */
function renameMinted(tree, inputs) {
  /** @type {Map<string, string>} */
  const alias = new Map();
  /** @param {string} s */
  const re = (s) =>
    s.replace(ID_RE, (tok) => {
      if (inputs.includes(tok)) return tok;
      let a = alias.get(tok);
      if (a === undefined) {
        a = `#${alias.size + 1}`;
        alias.set(tok, a);
      }
      return a;
    });
  /** @param {unknown} v @returns {unknown} */
  const walk = (v) => {
    if (typeof v === 'string') return re(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const o = /** @type {Record<string, unknown>} */ (v);
      /** @type {Record<string, unknown>} */
      const out = {};
      let keys = Object.keys(o).sort();
      // A map keyed by minted ids (a page's objects, the pages): its keys sort randomly, so they
      // are numbered in the order of each entry's stored `order` (then its id-free content).
      if (keys.length > 1 && keys.every(minted)) {
        const rank = (/** @type {string} */ k) => {
          const e = /** @type {any} */ (o[k]);
          return typeof e?.order === 'number' ? e.order : Number.POSITIVE_INFINITY;
        };
        const content = (/** @type {string} */ k) => JSON.stringify(o[k]).replace(ID_RE, '~');
        keys = keys.sort(
          (a, b) => rank(a) - rank(b) || (content(a) < content(b) ? -1 : content(a) > content(b) ? 1 : 0),
        );
        for (const k of keys) re(k);
      }
      for (const k of keys) out[re(k)] = walk(o[k]);
      return out;
    }
    return v;
  };
  /** @param {string} k */
  const minted = (k) => {
    const m = k.match(ID_RE);
    return m !== null && m[0] === k && !inputs.includes(k);
  };
  return walk(tree);
}

/**
 * Differences between two canonical trees, as `path: cpp | ts` strings (at most `MAX_DIFFS`).
 * @param {unknown} a @param {unknown} b
 */
function differences(a, b) {
  /** @type {string[]} */
  const out = [];
  let count = 0;
  /** @param {unknown} x @param {unknown} y @param {string} at */
  const walk = (x, y, at) => {
    if (typeof x === 'number' && typeof y === 'number') {
      if (!withinTolerance(x, y)) push(at, x, y);
      return;
    }
    if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') {
      if (x !== y) push(at, x, y);
      return;
    }
    if (Array.isArray(x) !== Array.isArray(y)) return push(at, x, y);
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) push(at + '.length', x.length, y.length);
      for (let i = 0; i < Math.min(x.length, y.length); i++) walk(x[i], y[i], `${at}[${String(i)}]`);
      return;
    }
    const xo = /** @type {Record<string, unknown>} */ (x);
    const yo = /** @type {Record<string, unknown>} */ (y);
    for (const k of new Set([...Object.keys(xo), ...Object.keys(yo)])) {
      if (!(k in yo)) push(`${at}.${k}`, xo[k], '<absent>');
      else if (!(k in xo)) push(`${at}.${k}`, '<absent>', yo[k]);
      else walk(xo[k], yo[k], `${at}.${k}`);
    }
  };
  /** @param {string} at @param {unknown} x @param {unknown} y */
  const push = (at, x, y) => {
    count++;
    if (out.length < MAX_DIFFS) out.push(`${at}: ${brief(x)} | ${brief(y)}`);
  };
  walk(a, b, '$');
  return { count, first: out };
}

/** @param {unknown} v */
function brief(v) {
  const s = typeof v === 'string' ? JSON.stringify(v) : (JSON.stringify(v) ?? String(v));
  return s.length > 160 ? s.slice(0, 157) + '…' : s;
}

/** @param {string} s */
const parse = (s) => (s === '' ? null : JSON.parse(s));

// ---------------------------------------------------------------- seeding

const SEEDED = process.env.SEMANTIC_SEEDED !== '0';
/** @type {Map<string, any>} */
const seededCache = new Map();

/**
 * The catalogue the wasm had for this case (unless SEMANTIC_SEEDED=0): C++ `TemplateStore` held
 * only what kashi had seeded in that process (`ops.seeded().ids`, captured per call), and the 26
 * arrowheads once anything was seeded. A case captured with nothing recorded as seeded (a tier test
 * that called the core directly) gets no templates, and the arrowheads unless the wasm's answer names
 * an arrowhead by its raw id (the capture did not record the arrowhead flag; this is inferred).
 * @param {any} full @param {any} c
 */
function seededCatalog(full, c) {
  if (!SEEDED) return full;
  const ids = /** @type {string[]} */ (c.seeded ?? []);
  const out = typeof c.out === 'string' ? c.out : '';
  // A compiled arrowhead change carries the registry's body, which proves the arrowheads were seeded.
  const arrows = ids.length > 0 || /\.arrows\.(start|end)":\{/.test(out) || !/"avabodh\.arrow\.[^"]*"/.test(out);
  const key = (arrows ? 'a:' : 'n:') + ids.join(',');
  let cat = seededCache.get(key);
  if (cat === undefined) {
    const templates = [];
    for (const id of ids) {
      const def = full.get(id);
      if (def !== undefined) templates.push(def.json);
    }
    const arrowBodies = arrows ? full.arrowheads().map((/** @type {any} */ d) => d.json) : [];
    cat = buildCatalog([{ templates, arrows: arrowBodies }]);
    if (seededCache.size > 64) seededCache.clear();
    seededCache.set(key, cat);
  }
  return cat;
}

// ---------------------------------------------------------------- one case

/** The wasm's generate answer per payload text ref (its page and object ids, by order and by ref). */
const GENERATED = new Map();

/**
 * A lint or project case whose board the wasm generated names the ids the wasm minted (page ids,
 * created object ids); lekhjs mints others. Each such id in the options text is replaced by the
 * id lekhjs minted for the same page (by order) or the same `ref`.
 * @param {unknown} options @param {any} cppAnswer @param {any} tsAnswer
 */
function remapGenerated(options, cppAnswer, tsAnswer) {
  if (typeof options !== 'string' || cppAnswer?.ok !== true || tsAnswer?.ok !== true) return options;
  /** @type {Map<string, string>} */
  const map = new Map();
  const cp = Array.isArray(cppAnswer.pages) ? cppAnswer.pages : [];
  const tp = Array.isArray(tsAnswer.pages) ? tsAnswer.pages : [];
  cp.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
    if (typeof p?.id === 'string' && typeof tp[i]?.id === 'string') map.set(p.id, tp[i].id);
  });
  for (const [ref, id] of Object.entries(cppAnswer.created ?? {}))
    if (typeof id === 'string' && typeof tsAnswer.created?.[ref] === 'string') map.set(id, tsAnswer.created[ref]);
  let out = options;
  for (const [from, to] of map) out = out.split(from).join(to);
  return out;
}

/**
 * @param {any} runtime @param {any} c
 * @returns {{ status: 'same' | 'differs' | 'threw', diffs?: number, first?: string[], error?: string }}
 */
function runCase(runtime, c) {
  const rt = Object.freeze({ ...runtime, catalog: seededCatalog(runtime.catalog, c), ids: sequentialIds() });
  const session = new BoardSession(rt, { images: new FakeImagePort(), scheduler: new FakeScheduler() });
  const raw = text(c.raw);
  const payload = text(c.payload);
  // A generate-sourced case's options name ids each engine minted: they are not input ids.
  const optionText = raw === undefined && payload !== undefined ? '' : JSON.stringify(c.options ?? '');
  const inputs = [raw ?? '', payload ?? '', optionText, JSON.stringify(c.batch ?? '')].join('\n');
  try {
    if (c.op !== 'generate') {
      if (raw !== undefined) {
        const r = session.load(raw);
        if (!r.ok) return { status: 'threw', error: `load refused: ${r.code}` };
      } else if (payload !== undefined) {
        const answer = generate(session, payload);
        c = {
          ...c,
          options: remapGenerated(
            c.options,
            typeof c.generated === 'string' ? parse(c.generated) : GENERATED.get(c.payload),
            answer,
          ),
        };
      }
    }
    /** @type {unknown} */
    let ts;
    /** @type {unknown} */
    let cpp = parse(c.out);
    switch (c.op) {
      case 'project':
        ts = project(session, c.options);
        break;
      case 'compile':
        ts = compile(session, c.batch);
        break;
      case 'lint':
        ts = lint(session, c.options);
        break;
      case 'generate': {
        const answer = generate(session, payload ?? '');
        ts = {
          answer,
          serialized:
            /** @type {any} */ (answer)?.ok === true ? JSON.parse(session.serialize({ stamp: 'cloud' })) : null,
        };
        cpp = {
          answer: cpp,
          serialized:
            c.serialized === undefined || /** @type {any} */ (cpp)?.ok !== true
              ? null
              : JSON.parse(text(c.serialized) ?? 'null'),
        };
        break;
      }
      case 'visualBounds': {
        const [pageId, nodeId] = c.args;
        const r = session.visualBounds(pageId === '' ? (session.document.pages[0]?.id ?? '') : pageId, nodeId);
        ts = r === null ? null : { minx: r.x, miny: r.y, maxx: r.x + r.width, maxy: r.y + r.height };
        const o = /** @type {any} */ (cpp);
        cpp = o?.ok === true ? { minx: o.minx, miny: o.miny, maxx: o.maxx, maxy: o.maxy } : null;
        break;
      }
      default:
        return { status: 'threw', error: `unknown op ${String(c.op)}` };
    }
    const d = differences(renameMinted(cpp, inputs), renameMinted(JSON.parse(JSON.stringify(ts ?? null)), inputs));
    if (d.count === 0) return { status: 'same' };
    // A refusal on one side only: name it, since the first differences are the missing members.
    /** @param {unknown} v */
    const refusal = (v) => {
      const o = /** @type {any} */ (v);
      return o !== null && typeof o === 'object' && o.ok === false ? `${String(o.error)}: ${String(o.message)}` : null;
    };
    const tsRefusal = refusal(ts);
    const cppRefusal = refusal(cpp);
    const first = [...d.first];
    if (tsRefusal !== cppRefusal) first.unshift(`refusal: ${String(cppRefusal)} | ${String(tsRefusal)}`);
    return { status: 'differs', diffs: d.count, first };
  } catch (e) {
    const err = /** @type {Error} */ (e);
    return {
      status: 'threw',
      error: String(err?.stack ?? err)
        .split('\n')
        .slice(0, 6)
        .join(' | '),
    };
  } finally {
    session.dispose();
  }
}

// ---------------------------------------------------------------- the run

describe('semantic parity replay (AC-BE-07, lekhjs side)', () => {
  it.runIf(existsSync(CASES))('replays the captured wasm cases through lekhjs', { timeout: 3_600_000 }, () => {
    const runtime = createTestRuntime({
      canvas: { createCanvas: (w, h) => /** @type {any} */ (createCanvas(w, h)) },
      catalog: catalog(),
      testing: { lineSpacingCompat: true, fontFallbackCompat: true },
      config: {},
    });
    const cases = readFileSync(CASES, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l))
      .filter((c) => OPS.includes(c.op) && (ONLY === '' || c.id === ONLY));
    const picked = LIMIT > 0 ? cases.slice(0, LIMIT) : cases;
    for (const l of readFileSync(CASES, 'utf8').split('\n')) {
      if (!l.includes('"op":"generate"')) continue;
      const g = JSON.parse(l);
      if (g.op === 'generate' && typeof g.payload === 'string') GENERATED.set(g.payload, parse(g.out));
    }
    /** @type {Record<string, any[]>} */
    const byOp = {};
    /** @type {Record<string, Record<string, number>>} */
    const summary = {};
    for (const c of picked) {
      const r = { id: c.id, ...runCase(runtime, c) };
      (byOp[c.op] ??= []).push(r);
      const s = (summary[c.op] ??= { same: 0, differs: 0, threw: 0 });
      s[r.status] = (s[r.status] ?? 0) + 1;
    }
    mkdirSync(REPORT, { recursive: true });
    for (const [op, rows] of Object.entries(byOp))
      writeFileSync(path.join(REPORT, op + '.json'), JSON.stringify(rows, null, 1));
    writeFileSync(path.join(REPORT, 'summary.json'), JSON.stringify(summary, null, 1));
    console.log('semantic parity:', JSON.stringify(summary));
    if (STRICT) {
      for (const s of Object.values(summary)) {
        expect(s['differs'] ?? 0).toBe(0);
        expect(s['threw'] ?? 0).toBe(0);
      }
    }
  });
});
