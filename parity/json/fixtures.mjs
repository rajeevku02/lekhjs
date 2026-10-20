// T6, the parity fixtures with the oracle in the loop (verification 01 §2.2, verification 02 §A.4):
// the JSON comparison P1 × {app, backend} over the C++-written fixture sets read in place
// (`lekhcore/test/fixtures`, `lbs/kashi/test/core/fixtures`, `e2e/fixtures/two-images.lekh`) and
// every register fixture under `parity/fixtures/`, then P2 × app over those with text in the
// browser (skipped, and said so, until the browser oracle exists: task H1).
//
//   cd lekhjs && npm run build && cd parity && npm run fixtures [-- --build] [-- --keep-going]
//
// `--build` runs `npm run build` in lekhjs first (under the same lock). `--no-gaps` ignores
// `parity/gaps.json`, so an owned gap counts as `differ` (the phase-exit run). Takes the heavy-job lock.
// Output: parity/out/fixtures/<date>/<pass>/ (gitignored); the merge-gate lines go to stdout.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { boardsIn, PARITY, runComparison } from './compare.mjs';
import { browserOracleStatus } from '../oracle/browser.mjs';
import { holdHeavyLock } from '../tools/lock.mjs';

const PKG = path.resolve(PARITY, '..');

/** The T6 input sets: `[prefix, directory or file]`, in report order. */
export function fixtureInputs() {
  const sets = JSON.parse(readFileSync(path.join(PARITY, 'fixture-sets.json'), 'utf8'));
  /** @type {import('./compare.mjs').BoardInput[]} */
  const boards = [];
  /** @type {Record<string, number>} */
  const counts = {};
  /** @type {string[]} */
  const missing = [];
  /** @param {string} prefix @param {string} p */
  const add = (prefix, p) => {
    if (!existsSync(p)) {
      missing.push(`${prefix} (${path.relative(PKG, p)})`);
      return;
    }
    const found = p.endsWith('.lekh') ? [{ idx: path.basename(p), file: p }] : boardsIn(p);
    for (const b of found) boards.push({ idx: `${prefix}/${b.idx}`, file: b.file });
    counts[prefix] = (counts[prefix] ?? 0) + found.length;
  };
  add('core', path.resolve(PKG, sets.core));
  add('backend', path.resolve(PKG, sets.backend));
  add('e2e', path.resolve(PKG, '..', 'e2e', 'fixtures', 'two-images.lekh'));
  add('register', path.join(PARITY, 'fixtures'));
  return { boards, counts, missing };
}

/** The lekhjs build the runner will load, and whether it is the checked-out HEAD. */
function buildState() {
  const info = path.join(PKG, 'dist', 'build-info.json');
  if (!existsSync(info)) return { ok: false, note: 'lekhjs/dist is not built (npm run build)' };
  const b = JSON.parse(readFileSync(info, 'utf8'));
  const head = execFileSync('git', ['-C', PKG, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (b.commit !== head)
    return {
      ok: true,
      note: `dist/ was built from ${String(b.commit).slice(0, 7)}, HEAD is ${head.slice(0, 7)}: stale`,
    };
  return {
    ok: true,
    note: b.dirty
      ? `dist/ built from HEAD ${head.slice(0, 7)} with uncommitted changes`
      : `dist/ built from HEAD ${head.slice(0, 7)}`,
  };
}

/** Whether a board holds text (P2 input): any non-empty `text` member. */
function hasText(/** @type {string} */ file) {
  return /"text"\s*:\s*"[^"]/.test(readFileSync(file, 'utf8'));
}

async function main() {
  holdHeavyLock();
  const args = process.argv.slice(2);
  if (args.includes('--build')) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: PKG, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const bs = buildState();
  if (!bs.ok) {
    process.stderr.write(bs.note + '\n');
    process.exit(2);
  }
  const { boards, counts, missing } = fixtureInputs();
  const date = new Date().toISOString().slice(0, 10);
  const root = path.join(PARITY, 'out', 'fixtures', date);
  mkdirSync(root, { recursive: true });
  process.stdout.write(
    `T6 fixtures: ${boards.length} boards (${Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')})${missing.length > 0 ? `; missing: ${missing.join(', ')}` : ''}\n${bs.note}\n`,
  );
  /** @type {string[]} */
  const lines = [];
  let pass = true;
  for (const stamp of /** @type {const} */ (['app', 'backend'])) {
    const out = path.join(root, `p1-${stamp}`);
    const s = await runComparison({
      boards,
      pipeline: 'p1',
      stamp,
      out,
      label: 'T6 fixtures',
      noGaps: args.includes('--no-gaps'),
      // A fresh wasm instance per board (~0.3 s each). The C++ engine reads uninitialised memory on
      // some register fixtures: LuaShapeGenerator never initialises savedw_/savedh_
      // (lekhcore src/lekh/shapegen/LuaShapeGenerator.h:36, constructor .cpp:534), a script that
      // raises returns before setting them (.cpp:622-646), and setDimension (.cpp:685) grows the
      // shape by whatever is there. DR-GEN-05/malformed-date's calendar raises on its first
      // generation, so its C++ width was 400 or 2.4e20 depending on what earlier boards (and a
      // --resume or --limit) had left in a shared instance's heap. A fresh instance's heap history
      // is the board's own, so the output is the same on every run.
      recycleEvery: 1,
    });
    lines.push(s.line);
    pass &&= s.pass;
    // Every board that is not equal is listed, including an owned gap (with its task).
    for (const x of /** @type {string[]} */ (s.summary['not_equal'] ?? []).slice(0, 40)) lines.push(`    ${x}`);
  }
  const withText = boards.filter((b) => hasText(b.file));
  const st = browserOracleStatus();
  if (st.available) {
    const s = await runComparison({
      boards: withText,
      pipeline: 'p2',
      stamp: 'app',
      out: path.join(root, 'p2-app'),
      label: 'T6 fixtures',
    });
    lines.push(s.line);
    pass &&= s.pass;
  } else lines.push(`T6 fixtures p2×app: ${withText.length} boards with text — SKIPPED (${st.reason})`);
  const text = lines.join('\n') + '\n';
  writeFileSync(path.join(root, 'merge-gate.txt'), `${bs.note}\n${text}`);
  process.stdout.write(`\n${text}\nresults: ${path.relative(PKG, root)}/\n`);
  process.exit(pass ? 0 : 1);
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  await main();
}
