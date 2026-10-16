// Regenerates test/fixtures/golden/fit-akaar.json, the AC-REC-02 golden (spec 07 §10): the C++
// akaar Quadrilateral (isRectangle, isSquare, makeSquare, polish) and Triangle (isEquilateral,
// makeEquilateral), plus fitter::Quadrilateral::regualarize (the recognizer's twin, which differs
// from akaar polish in areHorizontalLine), on a deterministic 200 + 200 case set.
//
// The harness is built twice from a scratch copy of the C++ sources:
//   - "double": number_t = double and PI = π, the numeric model the port adopted (doubles,
//     Math.PI: OQ-46). The TS fitters must match it within 1e-6 px; this is the gate.
//   - "float":  the sources as shipped (number_t = float, PI = 3.14159265). Recorded so the test
//     can report how far the shipped C++ is from the port; not a gate.
//
//   node parity/tools/fit-golden/regen.mjs [--src <C++ src dir>] [--n 200]
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
const OUT = path.join(PKG, 'test', 'fixtures', 'golden', 'fit-akaar.json');

const DIRS = ['base', 'geometry', 'akaar', 'bodh', 'math', 'fitter', 'recognizer'];
const UNITS = [
  'akaar/Geometry.cpp',
  'akaar/Line.cpp',
  'fitter/QuadFitter.cpp',
  'fitter/Line.cpp',
  'recognizer/Util.cpp',
  'bodh/Util.cpp',
  'base/BaseUtil.cpp',
  'base/Config.cpp',
  'geometry/GeoUtil.cpp',
  'geometry/LineEquation.cpp',
  'geometry/LineSegment.cpp',
  'geometry/Rectangle.cpp',
];

/** @param {string} file @param {string} from @param {string} to */
function patch(file, from, to) {
  const s = readFileSync(file, 'utf8');
  if (!s.includes(from)) throw new Error(`patch target not found in ${file}: ${from}`);
  writeFileSync(file, s.replace(from, to));
}

/**
 * @typedef {Record<string, unknown> & { in: number[][] }} Case
 * @typedef {{ number_t_bytes: number; quads: Case[]; triangles: Case[] }} HarnessOut
 * @param {'double' | 'float'} variant
 * @returns {HarnessOut}
 */
function build(variant) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `fit-golden-${variant}-`));
  try {
    for (const d of DIRS) cpSync(path.join(SRC, d), path.join(dir, d), { recursive: true });
    if (variant === 'double') {
      patch(path.join(dir, 'base/TypeDefinitions.h'), 'typedef float number_t;', 'typedef double number_t;');
      patch(path.join(dir, 'base/Const.h'), '#define PI 3.14159265', '#define PI 3.14159265358979323846');
    }
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
    return JSON.parse(execFileSync(exe, [String(N)], { encoding: 'utf8', maxBuffer: 64 << 20 }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const dbl = build('double');
const flt = build('float');
if (dbl.number_t_bytes !== 8 || flt.number_t_bytes !== 4) throw new Error('number_t patch did not take');

/** @param {Case} c */
const strip = (c) => {
  return Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'in'));
};
const golden = {
  about:
    'AC-REC-02 golden, written by parity/tools/fit-golden/regen.mjs from the C++ akaar Quadrilateral ' +
    'and Triangle. `expect` is the C++ built with doubles and PI = π (the gate, 1e-6 px); `shipped` is ' +
    'the C++ as shipped (float, PI = 3.14159265), for information.',
  cases: N,
  quads: dbl.quads.map((q, i) => ({ in: q.in, expect: strip(q), shipped: strip(/** @type {Case} */ (flt.quads[i])) })),
  triangles: dbl.triangles.map((t, i) => ({
    in: t.in,
    expect: strip(t),
    shipped: strip(/** @type {Case} */ (flt.triangles[i])),
  })),
};
writeFileSync(OUT, JSON.stringify(golden) + '\n');
console.log(`wrote ${path.relative(PKG, OUT)}: ${N} quads, ${N} triangles`);
