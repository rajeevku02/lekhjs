// Regenerates test/recognizer/golden/cxpoly-order.json, the ordered CxPoly golden behind AC-REC-07
// and the C2 cases of AC-REC-11 (spec 07 §7.3). The C++ golden that ships with the C++ tests
// (cxpoly-golden.txt) pins only the sorted line-id sets; this one pins the order too, and the part
// ends, the features and the PolySplitter output.
//
// The harness (harness.cpp, on the C++ synthetic line sets of test/recognizer/LineSetGenerators.h)
// is built twice from a scratch copy of the C++ sources, both with number_t = double and PI = π
// (the port's numeric model, OQ-46):
//   - "fixed":  C2 fixed (`maxx = p.x` in CxPoly::computeBasicFeatures), what the TS port does;
//   - "legacy": the sources as they are (`maxx = p.y`), what TS does with quirks.legacyWidthBug.
//
//   node parity/tools/cxpoly-golden/regen.mjs [--src <C++ repo root>]
// Builds with g++ -O1 serially. Hold the heavy-job lock when running it.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const PKG = path.resolve(HERE, '../../..');
const args = process.argv.slice(2);
/** @param {string} name @param {string} dflt */
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return (i >= 0 ? args[i + 1] : undefined) ?? dflt;
};
const ROOT = path.resolve(opt('--src', path.join(PKG, '..', 'lekhcore')));
const SRC = path.join(ROOT, 'src');
const GENERATORS = path.join(ROOT, 'test', 'recognizer', 'LineSetGenerators.h');
const OUT = path.join(PKG, 'test', 'recognizer', 'golden', 'cxpoly-order.json');

const DIRS = ['base', 'geometry', 'math', 'fitter', 'recognizer'];
const UNITS = [
  'base/BaseUtil.cpp',
  'base/Config.cpp',
  'base/Logger.cpp',
  'base/Object.cpp',
  'base/Identity.cpp',
  'recognizer/CxPoly.cpp',
  'recognizer/CxPolyAggregator.cpp',
  'recognizer/LineColl.cpp',
  'recognizer/Line.cpp',
  'recognizer/LineRelation.cpp',
  'recognizer/Util.cpp',
  'recognizer/PolyColl.cpp',
  'recognizer/PolySplitter.cpp',
  'recognizer/BasicShapeRecognizer.cpp',
  'recognizer/RangeNumber.cpp',
  'recognizer/LineAggreagtor.cpp',
];

/** @param {string} file @param {string} from @param {string} to */
function patch(file, from, to) {
  const s = readFileSync(file, 'utf8');
  if (!s.includes(from)) throw new Error(`patch target not found in ${file}: ${from}`);
  writeFileSync(file, s.replace(from, to));
}

/**
 * @param {'fixed' | 'legacy'} variant
 * @returns {{ number_t_bytes: number; cases: unknown[] }}
 */
function build(variant) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `cxpoly-golden-${variant}-`));
  try {
    for (const d of DIRS) cpSync(path.join(SRC, d), path.join(dir, d), { recursive: true });
    cpSync(GENERATORS, path.join(dir, 'LineSetGenerators.h'));
    // scribble's first point is `b.start(100 + 80 * rng.next(), 100 + 80 * rng.next())`: the two
    // draws happen in the compiler's argument-evaluation order (unspecified in C++; g++ on x86-64
    // goes right to left, clang left to right). Pin it left to right, as the shipped golden
    // (captured with clang) and the TS port have it.
    patch(
      path.join(dir, 'LineSetGenerators.h'),
      'b.start(100 + 80 * rng.next(), 100 + 80 * rng.next());',
      '{ const double sx = 100 + 80 * rng.next(); const double sy = 100 + 80 * rng.next(); b.start(sx, sy); }',
    );
    patch(path.join(dir, 'base/TypeDefinitions.h'), 'typedef float number_t;', 'typedef double number_t;');
    patch(path.join(dir, 'base/Const.h'), '#define PI 3.14159265', '#define PI 3.14159265358979323846');
    if (variant === 'fixed') {
      patch(
        path.join(dir, 'recognizer/CxPoly.cpp'),
        'if (maxx < p.x) {\n            maxx = p.y;',
        'if (maxx < p.x) {\n            maxx = p.x;',
      );
    }
    const units = [...UNITS];
    for (const f of ['geometry', 'math', 'fitter']) {
      const list = execFileSync('sh', ['-c', `ls ${path.join(dir, f)}/*.cpp`], { encoding: 'utf8' });
      units.push(
        ...list
          .trim()
          .split('\n')
          .map((p) => path.relative(dir, p)),
      );
    }
    const exe = path.join(dir, 'harness');
    execFileSync(
      'g++',
      [
        '-std=c++17',
        '-O1',
        '-ffp-contract=off',
        '-w',
        '-I',
        dir,
        '-o',
        exe,
        path.join(HERE, 'harness.cpp'),
        ...units.map((u) => path.join(dir, u)),
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    return JSON.parse(execFileSync(exe, [], { encoding: 'utf8', maxBuffer: 256 << 20 }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const fixed = build('fixed');
const legacy = build('legacy');
if (fixed.number_t_bytes !== 8 || legacy.number_t_bytes !== 8) throw new Error('number_t patch did not take');
const golden = {
  about:
    'AC-REC-07 ordered CxPoly golden, written by parity/tools/cxpoly-golden/regen.mjs from the C++ ' +
    'PolyColl on the synthetic line sets, built with doubles and PI = π. `fixed` has the C2 width fix ' +
    '(the TS default, DR-REC-02); `legacy` is the C++ as is (TS with quirks.legacyWidthBug).',
  fixed: fixed.cases,
  legacy: legacy.cases,
};
// 12 significant digits keep the file small; the test compares within 1e-9 (relative).
// `ids` and `parts` are written as strings ("1,2,3"; "x1 y1 x2 y2,…") so the file stays compact
// once formatted.
const r12 = (/** @type {number} */ v) => (Number.isInteger(v) ? v : Number(v.toPrecision(12)));
const round = (/** @type {string} */ k, /** @type {unknown} */ v) => {
  if (k === 'ids' && Array.isArray(v)) return v.join(',');
  if (k === 'parts' && Array.isArray(v)) return v.map((p) => /** @type {number[]} */ (p).map(r12).join(' ')).join(',');
  return typeof v === 'number' ? r12(v) : v;
};
writeFileSync(OUT, JSON.stringify(golden, round) + '\n');
// Formatted as `npm run format:check` expects.
execFileSync(path.join(PKG, 'node_modules', '.bin', 'prettier'), ['--write', OUT], { stdio: 'ignore' });
console.log(`wrote ${path.relative(PKG, OUT)}: ${String(fixed.cases.length)} cases per variant`);
