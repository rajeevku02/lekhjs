// Regenerates test/recognizer/golden/pipeline.json, the recognizer pipeline golden (spec 07 §7.3,
// task R2): synthetic line sets through the C++ `Recognizer::process()` against an empty scene
// (see harness.cpp), so the TS shapes/, paths/, regularizer/ and the specialists' no-match paths
// can be checked stage by stage before the LineAggregator handoff.
//
// Built twice from a scratch copy of the C++ sources, both with number_t = double and PI = π (the
// port's numeric model, OQ-46):
//   - "fixed":  C1 (ShapeColl::takeOut keeps the first final shape's perimeter) and C2
//               (CxPoly::computeBasicFeatures `maxx = p.x`) fixed: the TS default;
//   - "legacy": the sources as they are: TS with quirks { legacyTakeOut, legacyWidthBug };
//   - "chordCost": as "fixed", with the stub's static `LineAggregator::getCost` replaced by the
//               largest distance of the points from their chord (test/recognizer/support's
//               `chordCostLineAggregatorModule` is the TS twin). The stub's cost of 0 makes every
//               poly smooth, so most closed figures come out as ellipses; this variant reaches the
//               polygon, PolyMatcher and regularizer branches.
//
//   node parity/tools/pipeline-golden/regen.mjs [--src <C++ repo root>]
// Builds with g++ -O1 serially. Hold the heavy-job lock when running it.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const OUT = path.join(PKG, 'test', 'recognizer', 'golden', 'pipeline.json');

const DIRS = ['base', 'geometry', 'math', 'fitter', 'recognizer', 'regularizer'];
const BASE_UNITS = ['base/BaseUtil.cpp', 'base/Config.cpp', 'base/Logger.cpp', 'base/Object.cpp', 'base/Identity.cpp'];

/** @param {string} file @param {string} from @param {string} to */
function patch(file, from, to) {
  const s = readFileSync(file, 'utf8');
  if (!s.includes(from)) throw new Error(`patch target not found in ${file}: ${from}`);
  writeFileSync(file, s.replace(from, to));
}

/** @param {string} dir @param {string} sub */
const cppIn = (dir, sub) =>
  readdirSync(path.join(dir, sub))
    .filter((f) => f.endsWith('.cpp'))
    .map((f) => path.join(sub, f));

/**
 * @param {'fixed' | 'legacy' | 'chordCost'} variant
 * @returns {{ number_t_bytes: number; cases: unknown[] }}
 */
function build(variant) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `pipeline-golden-${variant}-`));
  try {
    for (const d of DIRS) cpSync(path.join(SRC, d), path.join(dir, d), { recursive: true });
    cpSync(GENERATORS, path.join(dir, 'LineSetGenerators.h'));
    // Pin scribble's argument evaluation order left to right (see cxpoly-golden/regen.mjs).
    patch(
      path.join(dir, 'LineSetGenerators.h'),
      'b.start(100 + 80 * rng.next(), 100 + 80 * rng.next());',
      '{ const double sx = 100 + 80 * rng.next(); const double sy = 100 + 80 * rng.next(); b.start(sx, sy); }',
    );
    // The dead matching/ pipeline is only included (its calls are commented out) and needs the lekh/
    // document headers; drop the include.
    patch(path.join(dir, 'recognizer/Recognizer.cpp'), '#include "matching/ShapeMatcher.h"', '');
    patch(path.join(dir, 'base/TypeDefinitions.h'), 'typedef float number_t;', 'typedef double number_t;');
    patch(path.join(dir, 'base/Const.h'), '#define PI 3.14159265', '#define PI 3.14159265358979323846');
    if (variant === 'chordCost') {
      patch(
        path.join(dir, 'recognizer/LineAggreagtor.cpp'),
        'RangeNumber LineAggregator::getCost(const geometry::Points& pts)\n{\n    RangeNumber range(0, 0);',
        'RangeNumber LineAggregator::getCost(const geometry::Points& pts)\n{\n    number_t d = 0;\n' +
          '    if (pts.size() > 2) {\n        geometry::LineEquation eq(pts.first(), pts.last());\n' +
          '        for (size_t i = 1; i + 1 < pts.size(); i++) { number_t t = eq.getDistanceFrom(pts[i]); if (t > d) d = t; }\n' +
          '    }\n    RangeNumber range(d, d);',
      );
      patch(
        path.join(dir, 'recognizer/LineAggreagtor.cpp'),
        '#include "LineAggreagtor.h"',
        '#include "LineAggreagtor.h"\n#include "../geometry/LineEquation.h"',
      );
    }
    if (variant === 'fixed' || variant === 'chordCost') {
      // C2 (DR-REC-02).
      patch(
        path.join(dir, 'recognizer/CxPoly.cpp'),
        'if (maxx < p.x) {\n            maxx = p.y;',
        'if (maxx < p.x) {\n            maxx = p.x;',
      );
      // C1 (DR-REC-01): the first final shape records its perimeter (missing = 0), so a later
      // shape replaces it only when strictly longer.
      patch(
        path.join(dir, 'recognizer/ShapeColl.cpp'),
        'if (shape.get() == nullptr) {\n                shape = sp;\n            }',
        'if (shape.get() == nullptr) {\n                shape = sp;\n                auto it0 = sp->numberAttrs().find(ShapeAttrs::perimeter);\n                pm = it0 != sp->numberAttrs().end() ? it0->second : 0;\n            }',
      );
    }
    const units = [
      ...BASE_UNITS,
      ...cppIn(dir, 'recognizer').filter((u) => !u.endsWith('PolyLineMatcher.cpp')),
      ...cppIn(dir, 'regularizer'),
      ...cppIn(dir, 'geometry'),
      ...cppIn(dir, 'math'),
      ...cppIn(dir, 'fitter'),
    ];
    const exe = path.join(dir, 'harness');
    execFileSync(
      'g++',
      [
        '-std=c++17',
        '-O1',
        '-ffp-contract=off',
        '-w',
        '-DLEKH_SEMANTIC_TEST_HOOKS',
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
const chordCost = build('chordCost');
if ([fixed, legacy, chordCost].some((v) => v.number_t_bytes !== 8)) throw new Error('number_t patch did not take');
const golden = {
  about:
    'Recognizer pipeline golden, written by parity/tools/pipeline-golden/regen.mjs: synthetic line ' +
    'sets through the C++ Recognizer::process() against an empty scene, built with doubles and PI = π. ' +
    '`fixed` has the C1 and C2 fixes (the TS default); `legacy` is the C++ as is (TS with both quirks); ' +
    '`chordCost` is `fixed` with the chord-distance LineAggregator::getCost (see regen.mjs).',
  fixed: fixed.cases,
  legacy: legacy.cases,
  chordCost: chordCost.cases,
};
const r12 = (/** @type {number} */ v) => (Number.isInteger(v) ? v : Number(v.toPrecision(12)));
writeFileSync(OUT, JSON.stringify(golden, (_k, v) => (typeof v === 'number' ? r12(v) : v)) + '\n');
execFileSync(path.join(PKG, 'node_modules', '.bin', 'prettier'), ['--write', OUT], { stdio: 'ignore' });
console.log(`wrote ${path.relative(PKG, OUT)}: ${String(fixed.cases.length)} cases per variant`);
