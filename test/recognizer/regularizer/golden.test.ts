// AC-REC-13 (spec 07 §7.5): the regularizer port against the C++ Regularizer::regularize golden
// (test/recognizer/golden/regularizer-cases.json, written by parity/tools/rec-golden/regen.mjs).
// `expect` is the C++ built with doubles and PI = π, the port's numeric model and the gate:
// discrete outcomes (which regularizers ran and which feature won, component count, curve flags,
// closed) exact; vertices within 0.05 px. `shipped` is the C++ as shipped (float), for
// information only.
//
// C1/C2 (DR-REC-01 ShapeColl.takeOut, DR-REC-02 CxPoly width) change the poly and shape
// collections upstream; they cannot reach these pure path-in/path-out cases, so no case is tagged.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BezierCurve, PathComponent, Point, SimplePath } from '../../../src/geometry';
import { RECOGNIZER_CONFIG_DEFAULTS } from '../../../src/recognizer/core/RecognizerConfig';
import { Regularizer } from '../../../src/recognizer/regularizer';

type Comp = number[];
interface Out {
  out: Comp[];
  outClosed: boolean;
  trace: string[];
}
interface Case {
  id: string;
  group: string;
  convex: boolean;
  closed: boolean;
  in: Comp[];
  cpts: [number, number][];
  expect: Out;
  shipped: Out;
}
const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, '../golden/regularizer-cases.json'), 'utf8')) as {
  cases: Case[];
};

const TOL = 0.05;

function toPath(c: Case): SimplePath {
  const p = new SimplePath();
  for (const k of c.in) {
    const pt = (i: number): Point => new Point(k[i], k[i + 1]);
    if (k.length === 8) p.push(PathComponent.ofCurve(new BezierCurve(pt(0), pt(2), pt(4), pt(6))));
    else p.push(PathComponent.line(pt(0), pt(2)));
  }
  p.setClosed(c.closed);
  return p;
}

function fromPath(p: SimplePath): Comp[] {
  return p.components.map((c) =>
    c.isCurve
      ? c.curve.getPoints().flatMap((q) => [q.x, q.y])
      : [c.segment.p1.x, c.segment.p1.y, c.segment.p2.x, c.segment.p2.y],
  );
}

function run(c: Case): Out & { path: SimplePath } {
  const p = toPath(c);
  const trace = new Regularizer(RECOGNIZER_CONFIG_DEFAULTS).regularizeTraced(
    p,
    c.cpts.map(([x, y]) => new Point(x, y)),
    c.convex,
  );
  return { out: fromPath(p), outClosed: p.closed(), trace, path: p };
}

/** Same shape (count, kinds) and the worst coordinate difference, or Infinity when the shapes differ. */
function compare(got: Comp[], want: Comp[]): number {
  if (got.length !== want.length) return Infinity;
  let m = 0;
  for (let i = 0; i < want.length; i++) {
    const g = got[i] ?? [];
    const w = want[i] ?? [];
    if (g.length !== w.length) return Infinity;
    for (let k = 0; k < w.length; k++) m = Math.max(m, Math.abs((g[k] ?? NaN) - (w[k] ?? NaN)));
  }
  return Number.isNaN(m) ? Infinity : m;
}

describe('AC-REC-13: the regularizer against the C++ golden', () => {
  it('covers every dispatch branch, every feature and both snap outcomes', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(300);
    const traces = new Set(golden.cases.flatMap((c) => c.expect.trace));
    const want = [
      'one',
      'polyline',
      'curve',
      ...[0, 1, 2, 3, -1].map((f) => `two:${String(f)}`),
      ...[0, 1, 2, 3, 4, 5, 6, 7, -1].map((f) => `three:${String(f)}`),
      ...[0, 1, 2, 3, 4, 5, 6, 7, -2].map((f) => `four:${String(f)}`),
      ...[0, 1, 2, 3, -1, -2].map((f) => `five:${String(f)}`),
      ...[0, 1, -1, -2].map((f) => `six:${String(f)}`),
      ...[0, -1, -2].map((f) => `eight:${String(f)}`),
    ];
    expect(want.filter((t) => !traces.has(t))).toEqual([]);
    // the closed two-line path that TwoLine turns into a triangle for ThreeLine
    expect(golden.cases.some((c) => c.expect.trace.length === 2)).toBe(true);
    // the no-op paths (7, 9, 10 lines, two curves, a non-convex curve, empty)
    expect(golden.cases.filter((c) => c.expect.trace.length === 0).length).toBeGreaterThan(10);
  });

  it('takes the same branches and features on every case', () => {
    const bad = golden.cases.filter((c) => JSON.stringify(run(c).trace) !== JSON.stringify(c.expect.trace));
    expect(bad.map((c) => `${c.id}: ${JSON.stringify(run(c).trace)} != ${JSON.stringify(c.expect.trace)}`)).toEqual([]);
  });

  it('produces the same components (count, kinds, closed exact; coordinates within 0.05 px)', () => {
    let worst = 0;
    const bad: string[] = [];
    for (const c of golden.cases) {
      const r = run(c);
      const d = compare(r.out, c.expect.out);
      if (d > TOL || r.outClosed !== c.expect.outClosed) bad.push(`${c.id}: Δ=${String(d)}`);
      worst = Math.max(worst, d);
    }
    expect(bad).toEqual([]);
    expect(worst).toBeLessThanOrEqual(TOL);
  });

  it('per group: at least 40 cases for every regularizer branch with features', () => {
    const count = (g: string): number => golden.cases.filter((c) => c.group === g).length;
    for (const g of ['one', 'two', 'three', 'four', 'five', 'six', 'eight', 'polyline']) {
      expect(count(g), g).toBeGreaterThanOrEqual(40);
    }
  });

  it('the shipped float C++ takes the same decisions (information: coordinates differ by float rounding)', () => {
    let discrete = 0;
    let worst = 0;
    for (const c of golden.cases) {
      const same =
        JSON.stringify(c.shipped.trace) === JSON.stringify(c.expect.trace) &&
        c.shipped.outClosed === c.expect.outClosed &&
        compare(c.shipped.out, c.expect.out) !== Infinity;
      if (!same) discrete++;
      else worst = Math.max(worst, compare(run(c).out, c.shipped.out));
    }
    // Recorded at capture time: 0 discrete differences in 700 cases.
    expect(discrete).toBe(0);
    // float has ~7 significant digits and the cases reach ~1,500 px (measured: 4.9e-5)
    expect(worst).toBeLessThanOrEqual(1e-3);
  });
});
