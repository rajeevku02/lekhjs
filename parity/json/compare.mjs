// The JSON comparison (verification 02 §A): one pipeline × one stamp pass over a fixture directory
// or a corpus manifest, the Node oracle and lekhjs on the same input, results per board in
// `results.jsonl`, then the summary (`report.mjs`).
//
//   node parity/json/compare.mjs --input <dir|manifest.jsonl> --pipeline p1|p2 --stamp app|backend
//        --out <dir> [--resume] [--limit N] [--register parity/register] [--accepted-only] [--compat on|off]
//
// Takes the heavy-job lock. Customer inputs (anything under a `corpus/` directory) may only write
// under that corpus's `out/`, and their results carry the manifest's opaque idx, counts and
// generalised paths, never file names, values or ids (verification 01 §1 rule 3).
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { canonicalise } from './canon.mjs';
import { diff } from './diff.mjs';
import { LenientParseError, lenientParse } from './lenient-parse.mjs';
import { report } from './report.mjs';
import { attributeGaps, gapOwnerOfId, loadGaps } from './gaps.mjs';
import { applyRules, compileRules, cppFailEntry } from './rules.mjs';
import { activeEntries, loadRegister, REGISTER_DIR } from '../register/load.mjs';
import { browserOracleStatus } from '../oracle/browser.mjs';
import { TsRunner } from '../oracle/ts-runner.mjs';
import { holdHeavyLock } from '../tools/lock.mjs';

const require = createRequire(import.meta.url);
const { NodeOracle } = /** @type {typeof import('../oracle/node-oracle.cjs')} */ (require('../oracle/node-oracle.cjs'));

const HERE = import.meta.dirname;
export const PARITY = path.resolve(HERE, '..');

/** @typedef {{ idx: string, file: string }} BoardInput */

/** A control character JSON requires escaped and the C++ writer leaves raw (not \n \r \t \b \f). */
// eslint-disable-next-line no-control-regex
export const RAW_CTRL = /[\x00-\x07\x0b\x0e-\x1f]/;

/**
 * The customer corpus `file` lies in, or null: a `corpus/` directory at a workspace root (the
 * directory holding `ecosystem.config.js`, spec 11 §8). Other folders named `corpus` (kashi's
 * sample boards) are synthetic.
 * @param {string} file
 */
export function corpusRootOf(file) {
  const parts = path.resolve(file).split(path.sep);
  for (let i = 1; i < parts.length; i++) {
    if (parts[i] !== 'corpus') continue;
    const parent = parts.slice(0, i).join(path.sep) || path.sep;
    if (existsSync(path.join(parent, 'ecosystem.config.js'))) return path.join(parent, 'corpus');
  }
  return null;
}

/**
 * Every `.lekh` under `dir`, recursively, sorted; idx = the path relative to `base`.
 * @param {string} dir
 * @param {string} [base]
 * @returns {BoardInput[]}
 */
export function boardsIn(dir, base = dir) {
  /** @type {BoardInput[]} */
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...boardsIn(p, base));
    else if (name.endsWith('.lekh')) out.push({ idx: path.relative(base, p), file: p });
  }
  return out;
}

/**
 * The boards of a corpus manifest (`corpus/manifest.jsonl`: `{ idx, … }` per line; the board is
 * `boards/<idx>.lekh` beside it).
 * @param {string} manifest
 * @returns {BoardInput[]}
 */
export function boardsOfManifest(manifest) {
  const dir = path.dirname(manifest);
  return readFileSync(manifest, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const idx = String(JSON.parse(l).idx);
      return { idx, file: path.join(dir, 'boards', `${idx}.lekh`) };
    })
    .filter((b) => existsSync(b.file));
}

/** A load error reduced to its class: quoted text and digits removed, so no content survives. */
function errorClass(/** @type {string | undefined} */ msg) {
  if (msg === undefined) return undefined;
  return msg
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '…')
    .replace(/\d+/g, 'N')
    .slice(0, 120);
}

/**
 * Compares one board's two engine results.
 * @param {object} a
 * @param {BoardInput} a.board
 * @param {string} a.inputText
 * @param {any} a.cpp   node oracle result
 * @param {any} a.ts    ts runner result
 * @param {'app' | 'backend'} a.stamp
 * @param {import('./rules.mjs').CompiledRegister} a.reg
 * @param {Set<string>} a.filed
 * @param {boolean} a.customer
 * @param {import('./gaps.mjs').Gap[]} [a.gaps]  owned gaps (`parity/gaps.json`); none by default
 */
export function compareBoard({ board, inputText, cpp, ts, stamp, reg, filed, customer, gaps = [] }) {
  /** @type {Record<string, any>} */
  const rec = {
    idx: board.idx,
    status: '',
    bytes: { input: inputText.length, cpp: cpp.json?.length ?? 0, ts: ts.json?.length ?? 0 },
    ms: { cpp: Math.round(cpp.ms ?? 0), ts: Math.round(ts.ms ?? 0) },
    heap: cpp.heap ?? null,
  };
  if (cpp.timeout || ts.timeout) {
    rec.status = 'timeout';
    rec.timeout = cpp.timeout ? 'cpp' : 'ts';
    return rec;
  }
  if (!cpp.ok && cpp.oom) {
    rec.status = ts.ok ? 'cpp_oom' : 'both_fail';
    rec.browser_retry = 'unavailable';
    if (!ts.ok) rec.ts_code = ts.code;
    return rec;
  }
  if (!cpp.ok && !ts.ok) {
    rec.status = 'both_fail';
    rec.ts_code = ts.code;
    rec.cpp_error = customer ? errorClass(cpp.error) : cpp.error;
    return rec;
  }
  if (!cpp.ok) {
    rec.status = 'cpp_fail';
    rec.cpp_error = customer ? errorClass(cpp.error) : cpp.error;
    const tied = cppFailEntry(reg, inputText, filed);
    if (tied !== null) rec.register = { [tied]: 1 };
    return rec;
  }
  if (!ts.ok) {
    rec.status = 'ts_fail';
    rec.ts_code = ts.code;
    if (!customer) rec.ts_error = ts.error;
    return rec;
  }

  // Raw control characters other than \n \r \t \b \f in the C++ output (E7: the C++ writer
  // emits them unescaped; lekhjs's reader rejects them with json_parse). A flag, never the bytes.
  if (typeof cpp.json === 'string' && RAW_CTRL.test(cpp.json)) rec.cpp_raw_ctrl = true;

  let canon;
  try {
    canon = canonicalise({
      inputText,
      cppText: cpp.json,
      tsText: ts.json,
      stamp,
      unported: (id) => gapOwnerOfId(gaps, id) !== null,
    });
  } catch (e) {
    if (!(e instanceof LenientParseError)) throw e;
    // Which side's output did not parse: each on its own. A C++ key with an unescaped `"` is
    // `json_unescaped_key` (OQ-12), counted apart from the other failures.
    const bad = (/** @type {string} */ t) => {
      try {
        lenientParse(t);
        return null;
      } catch (x) {
        return x instanceof LenientParseError ? x.code : 'json_syntax';
      }
    };
    const cBad = bad(cpp.json);
    rec.status = cBad !== null ? 'cpp_fail' : 'ts_fail';
    if (cBad !== null) rec.cpp_error = `output: ${cBad}`;
    else rec.ts_code = `output_${bad(ts.json) ?? e.code}`;
    if (cBad === 'json_unescaped_key') rec.unescaped_key = true;
    return rec;
  }
  const { diffs, tolerance } = diff(canon.cpp, canon.ts);
  const ruled = applyRules(reg, diffs, canon.cpp, canon.ts, canon.input ?? undefined);
  const { applied } = ruled;
  const { unexplained, gaps: gapCounts } = attributeGaps(gaps, ruled.unexplained, canon.cpp, canon.ts);
  rec.stamp = { ok: canon.stamp.ok, cpp: canon.stamp.cpp, ts: canon.stamp.ts, expected: canon.stamp.expected };
  rec.generator_parts = canon.generatorParts;
  rec.root_style_ok = canon.rootStyleOk;
  rec.renamed_ids = canon.renamedIds;
  rec.duplicate_keys = canon.duplicateKeys;
  if (tolerance.size > 0) rec.tolerance = Object.fromEntries(tolerance);
  if (applied.size > 0) rec.register = Object.fromEntries(applied);
  // A stamp an unported generator kept below 5.0 is the gap's too (C++ ran that Lua).
  for (const id of canon.stamp.gapLua) {
    const owner = gapOwnerOfId(gaps, id);
    if (owner !== null) gapCounts.set(owner, (gapCounts.get(owner) ?? 0) + 1);
  }
  if (gapCounts.size > 0) rec.gap = Object.fromEntries(gapCounts);
  if (unexplained.length > 0) {
    rec.status = 'differ';
    /** @type {Record<string, number>} */
    const paths = {};
    for (const d of unexplained) {
      const k = `${d.kind} ${d.gpath}`;
      paths[k] = (paths[k] ?? 0) + 1;
    }
    rec.paths = paths;
    if (!customer) rec.examples = unexplained.slice(0, 5).map((d) => `${d.kind} /${d.path.join('/')}`);
  } else if (gapCounts.size > 0) rec.status = 'gap';
  else if (applied.size > 0) rec.status = 'equal_rules';
  else if (tolerance.size > 0) rec.status = 'equal_tol';
  else rec.status = 'equal';
  return rec;
}

/**
 * @typedef {object} RunOptions
 * @property {BoardInput[]} boards
 * @property {'p1' | 'p2'} pipeline
 * @property {'app' | 'backend'} stamp
 * @property {string} out
 * @property {boolean} [resume]
 * @property {number} [limit]
 * @property {string} [registerDir]
 * @property {boolean} [acceptedOnly]
 * @property {boolean} [compat]  TS test switches lineSpacingCompat + fontFallbackCompat (default on)
 * @property {boolean} [noGaps]  ignore `parity/gaps.json` (a phase-exit run: an owned gap is a differ)
 * @property {string} [label]
 * @property {(line: string) => void} [progress]
 */

/**
 * Runs one pass; writes `<out>/run.json`, `results.jsonl`, `summary.json`, `summary.md`.
 * @param {RunOptions} o
 */
export async function runComparison(o) {
  const customer = o.boards.some((b) => corpusRootOf(b.file) !== null);
  if (customer) {
    const roots = new Set(o.boards.map((b) => corpusRootOf(b.file)));
    if (roots.size !== 1 || roots.has(null)) throw new Error('compare: a run may not mix corpus and other inputs');
    const outRoot = path.join(/** @type {string} */ ([...roots][0]), 'out');
    if (!path.resolve(o.out).startsWith(outRoot + path.sep))
      throw new Error(`compare: customer inputs write only under ${outRoot}/ (got ${o.out})`);
  }
  if (o.pipeline === 'p2') {
    const st = browserOracleStatus();
    if (!st.available)
      throw Object.assign(new Error(`compare: pipeline p2 needs the browser oracle: ${st.reason}`), {
        unavailable: true,
      });
  }
  mkdirSync(o.out, { recursive: true });
  const resultsFile = path.join(o.out, 'results.jsonl');
  /** @type {Set<string>} */
  const done = new Set();
  if (o.resume === true && existsSync(resultsFile)) {
    for (const l of readFileSync(resultsFile, 'utf8').split('\n')) if (l.trim() !== '') done.add(JSON.parse(l).idx);
  } else writeFileSync(resultsFile, '');

  const entries = loadRegister(o.registerDir ?? REGISTER_DIR);
  const filed = new Set(entries.map((e) => String(e.data['id'])));
  const reg = compileRules(activeEntries(entries, { acceptedOnly: o.acceptedOnly === true }));
  const gaps = o.noGaps === true ? [] : loadGaps();
  if (reg.errors.length > 0) throw new Error('compare: register rules do not compile:\n  ' + reg.errors.join('\n  '));

  const log = createWriteStream(path.join(o.out, 'engines.log'));
  const oracle = new NodeOracle({ log });
  const ts = new TsRunner({ log, compat: o.compat !== false });
  const started = new Date().toISOString();
  /** @type {Record<string, any>} */
  const run = {
    label: o.label ?? null,
    pipeline: o.pipeline,
    stamp: o.stamp,
    customer,
    started,
    boards: o.boards.length,
    oracle: await oracle.identity(),
    lekhjs: await ts.identity(),
    register: { entries: entries.length, json_rules: reg.json.length, accepted_only: o.acceptedOnly === true },
    gaps: gaps.map((g) => g.owner),
    tz: 'UTC',
    clock: '2026-01-15T00:00:00Z',
  };
  writeFileSync(path.join(o.out, 'run.json'), JSON.stringify(run, null, 2) + '\n');

  let n = 0;
  try {
    for (const board of o.boards) {
      if (o.limit !== undefined && n >= o.limit) break;
      if (done.has(board.idx)) continue;
      n++;
      const inputText = readFileSync(board.file, 'utf8');
      const cpp = await oracle.load(inputText, { stamp: o.stamp });
      const tsr = await ts.load(inputText, { stamp: o.stamp });
      const rec = compareBoard({ board, inputText, cpp, ts: tsr, stamp: o.stamp, reg, filed, customer, gaps });
      appendFileSync(resultsFile, JSON.stringify(rec) + '\n');
      o.progress?.(`${rec.status.padEnd(11)} ${customer ? rec.idx : board.idx}`);
    }
  } finally {
    run.oracle.instances = oracle.instances;
    await oracle.close();
    await ts.close();
    log.end();
  }
  const finished = { ...run, finished: new Date().toISOString() };
  writeFileSync(path.join(o.out, 'run.json'), JSON.stringify(finished, null, 2) + '\n');
  return report(o.out);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i] ?? '';
    if (!k.startsWith('--')) throw new Error(`compare: unexpected argument ${k}`);
    const name = k.slice(2);
    if (['resume', 'accepted-only'].includes(name)) a[name] = true;
    else a[name] = argv[++i] ?? '';
  }
  return a;
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  holdHeavyLock();
  const a = parseArgs(process.argv.slice(2));
  const input = String(a['input'] ?? '');
  const pipeline = /** @type {'p1' | 'p2'} */ (String(a['pipeline'] ?? 'p1'));
  const stamp = /** @type {'app' | 'backend'} */ (String(a['stamp'] ?? 'app'));
  if (input === '' || !['p1', 'p2'].includes(pipeline) || !['app', 'backend'].includes(stamp)) {
    process.stderr.write(
      'usage: compare.mjs --input <dir|manifest.jsonl> --pipeline p1|p2 --stamp app|backend --out <dir> [--resume] [--limit N] [--register <dir>] [--accepted-only] [--compat on|off]\n',
    );
    process.exit(2);
  }
  const real = realpathSync(input);
  const boards = statSync(real).isDirectory() ? boardsIn(real) : boardsOfManifest(real);
  const corpus = corpusRootOf(real);
  const stampDir = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.resolve(
    String(
      a['out'] ??
        (corpus !== null ? path.join(corpus, 'out', 'json', stampDir) : path.join(PARITY, 'out', 'json', stampDir)),
    ),
  );
  try {
    const s = await runComparison({
      boards,
      pipeline,
      stamp,
      out,
      resume: a['resume'] === true,
      ...(a['limit'] !== undefined ? { limit: Number(a['limit']) } : {}),
      ...(a['register'] !== undefined ? { registerDir: path.resolve(String(a['register'])) } : {}),
      acceptedOnly: a['accepted-only'] === true,
      compat: a['compat'] !== 'off',
      progress: corpus !== null ? undefined : (l) => process.stdout.write(l + '\n'),
    });
    process.stdout.write(`\n${s.line}\nsummary: ${path.join(out, 'summary.md')}\n`);
    process.exit(s.pass ? 0 : 1);
  } catch (e) {
    process.stderr.write(String(/** @type {Error} */ (e).message ?? e) + '\n');
    process.exit(/** @type {{ unavailable?: boolean }} */ (e).unavailable ? 3 : 1);
  }
}
