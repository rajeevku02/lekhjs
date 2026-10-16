// Regenerates test/fixtures/golden/gesture-traces/traces.json, the AC-UI-03 golden (spec 05 §4.1,
// verification 05 AC-UI-03): the listener calls the C++ GestureRecognizer makes for each trace of
// traces.json, on a fake clock.
//
// The harness is built from a scratch copy of the C++ sources (base, geometry, lekh/event) with a
// stub lekh/Platform.h that has only the timers, and with number_t = double and PI = π (the
// numeric model the port adopted, OQ-46), like the other goldens.
//
//   node parity/tools/capture-gesture-traces/regen.mjs [--src <C++ src dir>]
// Builds with g++ -O0 serially. Hold the heavy-job lock when running it.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const PKG = path.resolve(HERE, '../../..');
const args = process.argv.slice(2);
const i = args.indexOf('--src');
const SRC = path.resolve((i >= 0 ? args[i + 1] : undefined) ?? path.join(PKG, '..', 'lekhcore', 'src'));
const OUT_DIR = path.join(PKG, 'test', 'fixtures', 'golden', 'gesture-traces');
const TRACES = JSON.parse(readFileSync(path.join(HERE, 'traces.json'), 'utf8'));

const EVENT_FILES = [
  'Event.h',
  'GestureListener.h',
  'GestureRecognizer.h',
  'GestureRecognizer.cpp',
  'MultiTouchRecognizer.h',
  'MultiTouchRecognizer.cpp',
  'ScaleRecognizer.h',
  'ScaleRecognizer.cpp',
  'ScrollRecognizer.h',
  'ScrollRecognizer.cpp',
  'RotateRecognizer.h',
  'RotateRecognizer.cpp',
];
const UNITS = [
  'lekh/event/GestureRecognizer.cpp',
  'lekh/event/MultiTouchRecognizer.cpp',
  'lekh/event/ScaleRecognizer.cpp',
  'lekh/event/ScrollRecognizer.cpp',
  'lekh/event/RotateRecognizer.cpp',
  'geometry/GeoUtil.cpp',
  'geometry/LineEquation.cpp',
  'geometry/LineSegment.cpp',
  'geometry/Rectangle.cpp',
  'base/BaseUtil.cpp',
  'base/Config.cpp',
  'base/Logger.cpp',
];

const STUB_PLATFORM = `// Stub for the AC-UI-03 harness: only the timers GestureRecognizer uses.
#ifndef _LEKH_PLATFORM_H_
#define _LEKH_PLATFORM_H_
#include <functional>
namespace avabodh { namespace lekh {
class Platform {
public:
    virtual ~Platform() {}
    static Platform* currentPlatform;
    virtual long setTimer(long milliSec, std::function<void()> cb) = 0;
    virtual void clearTimer(long timerId) = 0;
};
}}
#endif
`;

/** @param {string} file @param {string} from @param {string} to */
function patch(file, from, to) {
  const s = readFileSync(file, 'utf8');
  if (!s.includes(from)) throw new Error(`patch target not found in ${file}: ${from}`);
  writeFileSync(file, s.replace(from, to));
}

/** The traces as the harness's line format. */
function input() {
  /** @type {string[]} */
  const lines = [];
  for (const tr of TRACES.traces) {
    lines.push(
      `trace ${tr.name} ${tr.canDoubleClick ? 1 : 0} ${tr.canLongPress ? 1 : 0} ${tr.canRotate ? 1 : 0} ${tr.drawOnly ? 1 : 0} ${tr.longPressMs ?? 0}`,
    );
    for (const st of tr.steps) {
      if (st.advance !== undefined) lines.push(`adv ${st.advance}`);
      else if (st.reset === true) lines.push(`reset ${st.t}`);
      else {
        const pts = st.points.map(
          (/** @type {any} */ p) => `${p.id} ${p.x} ${p.y} ${p.state} ${p.kind} ${p.button ?? 'none'}`,
        );
        lines.push(`ev ${st.t} ${st.points.length} ${pts.join(' ')}`);
      }
    }
    lines.push('end');
  }
  return lines.join('\n') + '\n';
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'gesture-traces-'));
try {
  for (const d of ['base', 'geometry']) cpSync(path.join(SRC, d), path.join(dir, d), { recursive: true });
  mkdirSync(path.join(dir, 'lekh', 'event'), { recursive: true });
  for (const f of EVENT_FILES) cpSync(path.join(SRC, 'lekh', 'event', f), path.join(dir, 'lekh', 'event', f));
  writeFileSync(path.join(dir, 'lekh', 'Platform.h'), STUB_PLATFORM);
  patch(path.join(dir, 'base/TypeDefinitions.h'), 'typedef float number_t;', 'typedef double number_t;');
  patch(path.join(dir, 'base/Const.h'), '#define PI 3.14159265', '#define PI 3.14159265358979323846');
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
  const out = JSON.parse(execFileSync(exe, [], { input: input(), encoding: 'utf8', maxBuffer: 64 << 20 }));
  mkdirSync(OUT_DIR, { recursive: true });
  const golden = {
    about:
      'AC-UI-03 golden, written by parity/tools/capture-gesture-traces/regen.mjs: the C++ GestureRecognizer ' +
      'listener calls for each trace of parity/tools/capture-gesture-traces/traces.json (number_t = double).',
    traces: out.traces.map((/** @type {any} */ t, /** @type {number} */ k) => ({
      ...TRACES.traces[k],
      calls: t.calls,
    })),
  };
  writeFileSync(path.join(OUT_DIR, 'traces.json'), JSON.stringify(golden, null, 1) + '\n');
  console.log(`wrote ${path.relative(PKG, path.join(OUT_DIR, 'traces.json'))}: ${out.traces.length} traces`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
