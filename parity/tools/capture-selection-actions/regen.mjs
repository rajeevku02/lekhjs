// Regenerates test/fixtures/golden/selection-actions/selection-actions.json, the AC-UI-22 golden
// (spec 05 §8, verification 05 AC-UI-22): for every board of the core fixture set and every
// selectable target on its active page, the C++ SelectionMenuWidget's items in registration order
// with `shown` and `collapsed`.
//
// It builds the lekhcore native test tier (`make -C <lekhcore>/test build`, serial), compiles
// capture.cpp with the tier's flags, links it against the tier's core and support objects (not its
// main), and runs it with the test Platform environment.
//
//   node parity/tools/capture-selection-actions/regen.mjs [--core <lekhcore dir>]
// Heavy (a full native build the first time): hold the heavy-job lock when running it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const PKG = path.resolve(HERE, '../../..');
const args = process.argv.slice(2);
const i = args.indexOf('--core');
const CORE = path.resolve((i >= 0 ? args[i + 1] : undefined) ?? path.join(PKG, '..', 'lekhcore'));
const TEST = path.join(CORE, 'test');
const OUT = path.join(PKG, 'test', 'fixtures', 'golden', 'selection-actions', 'selection-actions.json');

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

execFileSync('make', ['-C', TEST, 'build', 'JOBS=1'], { stdio: ['ignore', 'inherit', 'inherit'] });

const objs = walk(path.join(TEST, 'build', 'core'))
  .filter((p) => p.endsWith('.o'))
  .filter((p) => {
    const rel = path.relative(path.join(TEST, 'build', 'core'), p);
    if (rel.startsWith('src' + path.sep)) return true;
    return rel.startsWith(path.join('test', 'support') + path.sep) && !rel.endsWith(path.sep + 'main.o');
  });
const gtest = ['gtest-all.o', 'gmock-all.o'].map((o) => path.join(TEST, 'build', 'gtest', o));

const fixtures = path.join(TEST, 'fixtures');
const boards = walk(fixtures)
  .filter((p) => p.endsWith('.lekh'))
  .map((p) => path.relative(fixtures, p))
  .sort();

const dir = mkdtempSync(path.join(os.tmpdir(), 'selection-actions-'));
try {
  const obj = path.join(dir, 'capture.o');
  const gt = path.join(TEST, 'third_party', 'googletest');
  execFileSync(
    'clang++',
    [
      '-std=c++17',
      '-O0',
      '-g',
      '-w',
      '-isystem',
      path.join(CORE, 'src'),
      '-I',
      path.join(TEST, 'support'),
      '-I',
      path.join(gt, 'googletest', 'include'),
      '-I',
      path.join(gt, 'googlemock', 'include'),
      `-DLEKH_TEST_ROOT="${TEST}"`,
      '-DLEKH_SEMANTIC_TEST_HOOKS',
      '-c',
      path.join(HERE, 'capture.cpp'),
      '-o',
      obj,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const exe = path.join(dir, 'capture');
  execFileSync('clang++', ['-o', exe, obj, ...objs, ...gtest, '-lpthread', '-ldl'], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const list = path.join(dir, 'boards.txt');
  writeFileSync(list, boards.join('\n') + '\n');
  const out = path.join(dir, 'out.json');
  execFileSync(exe, ['--gtest_filter=SelectionActionsCapture.*'], {
    env: { ...process.env, LEKH_CAPTURE_OUT: out, LEKH_CAPTURE_BOARDS: list },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const data = JSON.parse(readFileSync(out, 'utf8'));
  mkdirSync(path.dirname(OUT), { recursive: true });
  const golden = {
    about:
      'AC-UI-22 golden, written by parity/tools/capture-selection-actions/regen.mjs: per core fixture board ' +
      '(paths relative to the core fixture set) and per target on its active page (a top-level object by ' +
      'its store index, or "multi" for all of them), the C++ SelectionMenuWidget items in registration ' +
      'order with isVisible (shown) and isCollapsedAlways (collapsed). The clipboard is empty.',
    boards: data.boards,
  };
  writeFileSync(OUT, JSON.stringify(golden, null, 1) + '\n');
  const targets = data.boards.reduce(
    (/** @type {number} */ n, /** @type {{ targets: unknown[] }} */ b) => n + b.targets.length,
    0,
  );
  console.log(`wrote ${path.relative(PKG, OUT)}: ${data.boards.length} boards, ${targets} targets`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
