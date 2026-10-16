// Regenerates the AC-REC-13 goldens (spec 07 §7.5): the C++ regularizer through
// Regularizer::regularize (test/recognizer/golden/regularizer-cases.json) and the live fitters
// CurveFitObject Initialise + FitSingle, EllipseFitter::fit and fitter::Quadrilateral::
// isNonRotatedRectangle (test/fixtures/golden/fit-curve-ellipse.json). The other
// fitter::Quadrilateral functions are in fit-akaar.json (parity/tools/fit-golden).
//
// The harness is built twice from a scratch copy of the C++ sources:
//   - "double": number_t = double and PI = π, the numeric model the port adopted (doubles,
//     Math.PI: OQ-46). This is the gate.
//   - "float":  the sources as shipped (number_t = float, PI = 3.14159265). Recorded so the test
//     can report how far the shipped C++ is from the port; not a gate.
// Both builds get the same two scratch-only edits, neither of which changes a result:
//   - the regularizer headers include geometry/SimplePath.h instead of recognizer/Path.h (they use
//     only geometry::SimplePath; Path.h would drag in the whole recognizer);
//   - PolyRegularizer::regularize stores the chosen feature index in the harness's g_regFid.
//
//   node parity/tools/rec-golden/regen.mjs [--src <C++ src dir>] [--n 200]
// Builds with g++ -O0 serially. Hold the heavy-job lock when running it.
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
const SRC = path.resolve(opt('--src', path.join(PKG, '..', 'lekhcore', 'src')));
const N = Number(opt('--n', '200'));
const OUT_REC = path.join(PKG, 'test', 'recognizer', 'golden', 'regularizer-cases.json');
const OUT_FIT = path.join(PKG, 'test', 'fixtures', 'golden', 'fit-curve-ellipse.json');

const DIRS = ['base', 'geometry', 'math', 'fitter', 'recognizer', 'regularizer'];
const REGULARIZERS = [
  'Regularizer',
  'OneLineRegularizer',
  'TwoLineRegularizer',
  'ThreeLineRegularizer',
  'FourLineRegularizer',
  'FiveLineRegularizer',
  'SixLineRegularizer',
  'EightLineRegularizer',
  'PolyLineRegularizer',
  'PolyRegularizer',
  'CurveRegularizer',
];
const UNITS = [
  ...REGULARIZERS.map((r) => `regularizer/${r}.cpp`),
  'fitter/CurveFitter.cpp',
  'fitter/EllipseFitter.cpp',
  'fitter/QuadFitter.cpp',
  'fitter/Line.cpp',
  'recognizer/Util.cpp',
  'base/BaseUtil.cpp',
  'base/Config.cpp',
  'geometry/GeoUtil.cpp',
  'geometry/LineEquation.cpp',
  'geometry/LineSegment.cpp',
  'geometry/Rectangle.cpp',
  'geometry/SimplePath.cpp',
  'geometry/BezierCurve.cpp',
  'geometry/Ellipse.cpp',
  'math/MathUtil.cpp',
];

/** @param {string} file @param {string} from @param {string} to */
function patch(file, from, to) {
  const s = readFileSync(file, 'utf8');
  if (!s.includes(from)) throw new Error(`patch target not found in ${file}: ${from}`);
  writeFileSync(file, s.split(from).join(to));
}

/** @param {'double' | 'float'} variant @returns {{ rec: any; fit: any }} */
function build(variant) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `rec-golden-${variant}-`));
  try {
    for (const d of DIRS) cpSync(path.join(SRC, d), path.join(dir, d), { recursive: true });
    if (variant === 'double') {
      patch(path.join(dir, 'base/TypeDefinitions.h'), 'typedef float number_t;', 'typedef double number_t;');
      patch(path.join(dir, 'base/Const.h'), '#define PI 3.14159265', '#define PI 3.14159265358979323846');
    }
    for (const h of [
      'Regularizer',
      'OneLineRegularizer',
      'PolyLineRegularizer',
      'PolyRegularizer',
      'CurveRegularizer',
    ]) {
      patch(
        path.join(dir, `regularizer/${h}.h`),
        '#include "../recognizer/Path.h"',
        '#include <math.h>\n#include <set>\n#include <vector>\n#include "../geometry/SimplePath.h"\n#include "../geometry/Rectangle.h"\n#include "../geometry/GeoUtil.h"\nnamespace avabodh { namespace recognizer { } }',
      );
    }
    const poly = path.join(dir, 'regularizer/PolyRegularizer.cpp');
    patch(poly, '#include "../base/Logger.h"', '#include "../base/Logger.h"\nextern int g_regFid;');
    patch(poly, '    if (features.size() == 0) {', '    if (features.size() == 0) {\n        g_regFid = -2;');
    patch(poly, '    if (minIdx >= 0) {', '    g_regFid = minIdx;\n    if (minIdx >= 0) {');
    const exe = path.join(dir, 'harness');
    execFileSync(
      'g++',
      [
        '-std=c++17',
        '-O0',
        '-ffp-contract=off',
        '-w',
        '-I',
        dir,
        '-o',
        exe,
        path.join(HERE, 'harness.cpp'),
        ...UNITS.map((u) => path.join(dir, u)),
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    const run = (/** @type {string[]} */ a) =>
      JSON.parse(execFileSync(exe, a, { encoding: 'utf8', maxBuffer: 256 << 20 }));
    return { rec: run(['rec']), fit: run(['fit', String(N)]) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const dbl = build('double');
const flt = build('float');
if (dbl.rec.number_t_bytes !== 8 || flt.rec.number_t_bytes !== 4) throw new Error('number_t patch did not take');

/** @param {Record<string, unknown>} c @param {string[]} keep */
const pick = (c, keep) => Object.fromEntries(keep.map((k) => [k, c[k]]));
const OUT_KEYS = ['out', 'outClosed', 'trace'];
const rec = {
  about:
    'AC-REC-13 regularizer golden, written by parity/tools/rec-golden/regen.mjs from the C++ ' +
    'Regularizer::regularize. `expect` is the C++ built with doubles and PI = π (the gate); `shipped` ' +
    'is the C++ as shipped (float, PI = 3.14159265), for information. Components are [x1,y1,x2,y2] ' +
    'lines or [8 numbers] cubics. `trace` names the regularizers run (<count>:<feature index>).',
  cases: dbl.rec.cases.map((/** @type {Record<string, unknown>} */ c, /** @type {number} */ i) => ({
    ...pick(c, ['id', 'group', 'convex', 'closed', 'in', 'cpts']),
    expect: pick(c, OUT_KEYS),
    shipped: pick(flt.rec.cases[i], OUT_KEYS),
  })),
};
for (const [i, c] of rec.cases.entries()) {
  if (JSON.stringify(c.in) !== JSON.stringify(flt.rec.cases[i].in)) throw new Error(`input ${String(i)} differs`);
}
writeFileSync(OUT_REC, JSON.stringify(rec) + '\n');
// test/recognizer/golden/ is prettier-checked (test/fixtures/golden/ is not), as for cxpoly-golden.
execFileSync(path.join(PKG, 'node_modules', '.bin', 'prettier'), ['--write', OUT_REC], { stdio: 'ignore' });

/** @param {string} key @param {string[]} keep */
const section = (key, keep) =>
  dbl.fit[key].map((/** @type {Record<string, unknown>} */ c, /** @type {number} */ i) => ({
    in: c.in,
    expect: pick(c, keep),
    shipped: pick(flt.fit[key][i], keep),
  }));
const fit = {
  about:
    'AC-REC-13 fitter golden, written by parity/tools/rec-golden/regen.mjs from the C++ ' +
    'CurveFitObject (Initialise + FitSingle, error 70), EllipseFitter::fit and ' +
    'fitter::Quadrilateral::isNonRotatedRectangle. `expect` is the C++ built with doubles and ' +
    'PI = π (the gate); `shipped` is the C++ as shipped (float), for information.',
  cases: N,
  curves: section('curves', ['init', 'curves']),
  ellipses: section('ellipses', ['center', 'width', 'height', 'rotation']),
  quads: section('quads', ['isNonRotatedRectangle']),
};
writeFileSync(OUT_FIT, JSON.stringify(fit) + '\n');
console.log(
  `wrote ${path.relative(PKG, OUT_REC)}: ${String(rec.cases.length)} cases; ` +
    `${path.relative(PKG, OUT_FIT)}: ${String(N)} curves, ellipses, quads`,
);
