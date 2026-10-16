// AC-REC-13 (spec 07 §7.5): the live fitters not covered by fit-akaar.json against the C++
// golden test/fixtures/golden/fit-curve-ellipse.json (parity/tools/rec-golden/regen.mjs):
// CurveFitObject Initialise + FitSingle with error 70 (Bézier control points within 0.25 px),
// EllipseFitter::fit (centre, width and height within 0.05 px, rotation within 1e-3 rad) and
// fitter::Quadrilateral::isNonRotatedRectangle (exact). fitter::Quadrilateral regualarize,
// isRectangle, isSquare and makeSquare are in golden.test.ts (fit-akaar.json).
// `expect` is the C++ built with doubles and PI = π (the gate); `shipped` the C++ as shipped (float).
//
// C1/C2 (DR-REC-01, DR-REC-02) are poly/shape-collection fixes upstream of the fitters; no case
// here can be affected by them, so none is tagged.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CurveFitter, EllipseFitter, Point, Quadrilateral } from '../../../src/geometry';

type XY = [number, number];
interface CurveOut {
  init: boolean;
  curves: XY[][];
}
interface EllipseOut {
  center: XY;
  width: number;
  height: number;
  rotation: number;
}
interface Golden {
  cases: number;
  curves: { in: XY[]; expect: CurveOut; shipped: CurveOut }[];
  ellipses: { in: XY[]; expect: EllipseOut; shipped: EllipseOut }[];
  quads: { in: XY[]; expect: { isNonRotatedRectangle: boolean }; shipped: { isNonRotatedRectangle: boolean } }[];
}
const golden = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '../../fixtures/golden/fit-curve-ellipse.json'), 'utf8'),
) as Golden;

const pts = (a: XY[]): Point[] => a.map(([x, y]) => new Point(x, y));

function fitCurve(input: XY[]): CurveOut {
  const f = new CurveFitter(70);
  const points = pts(input);
  const init = f.initialise(points, points.length);
  if (init) f.fitSingle();
  return { init, curves: f.curves.map((c) => c.getPoints().map((p): XY => [p.x, p.y])) };
}

function curveDiff(got: CurveOut, want: CurveOut): number {
  if (got.init !== want.init || got.curves.length !== want.curves.length) return Infinity;
  let m = 0;
  want.curves.forEach((c, i) => {
    c.forEach(([x, y], k) => {
      const g = got.curves[i]?.[k];
      m = Math.max(m, Math.abs((g?.[0] ?? NaN) - x), Math.abs((g?.[1] ?? NaN) - y));
    });
  });
  return Number.isNaN(m) ? Infinity : m;
}

function fitEllipse(input: XY[]): EllipseOut {
  const e = new EllipseFitter(pts(input)).fit();
  return { center: [e.center.x, e.center.y], width: e.width, height: e.height, rotation: e.rotation };
}

/** Worst length difference and rotation difference. */
function ellipseDiff(got: EllipseOut, want: EllipseOut): { len: number; rot: number } {
  return {
    len: Math.max(
      Math.abs(got.center[0] - want.center[0]),
      Math.abs(got.center[1] - want.center[1]),
      Math.abs(got.width - want.width),
      Math.abs(got.height - want.height),
    ),
    rot: Math.abs(got.rotation - want.rotation),
  };
}

function quad(a: XY[]): Quadrilateral {
  const [p1, p2, p3, p4] = pts(a);
  if (p1 === undefined || p2 === undefined || p3 === undefined || p4 === undefined) throw new Error('bad case');
  return new Quadrilateral(p1, p2, p3, p4);
}

describe('AC-REC-13: CurveFitter, EllipseFitter and isNonRotatedRectangle against the C++ golden', () => {
  it('has 200 cases of each, covering both outcomes', () => {
    expect(golden.curves.length).toBe(200);
    expect(golden.ellipses.length).toBe(200);
    expect(golden.quads.length).toBe(200);
    const fitted = golden.curves.filter((c) => c.expect.curves.length > 0).length;
    const nonRot = golden.quads.filter((q) => q.expect.isNonRotatedRectangle).length;
    const circles = golden.ellipses.filter((e) => e.expect.width === e.expect.height).length;
    const snapped = golden.ellipses.filter((e) => e.expect.width !== e.expect.height && e.expect.rotation === 0);
    for (const n of [fitted, nonRot, circles, snapped.length]) {
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(200);
    }
    expect(golden.curves.some((c) => !c.expect.init)).toBe(true);
  });

  it('CurveFitter (Initialise + FitSingle) gives the same curve within 0.25 px', () => {
    let worst = 0;
    const bad: string[] = [];
    for (const [i, c] of golden.curves.entries()) {
      const d = curveDiff(fitCurve(c.in), c.expect);
      if (d > 0.25) bad.push(`curve ${String(i)}: Δ=${String(d)}`);
      worst = Math.max(worst, d);
    }
    expect(bad).toEqual([]);
    expect(worst).toBeLessThanOrEqual(0.25);
  });

  it('EllipseFitter.fit gives the same ellipse (0.05 px, 1e-3 rad)', () => {
    const bad: string[] = [];
    for (const [i, c] of golden.ellipses.entries()) {
      const d = ellipseDiff(fitEllipse(c.in), c.expect);
      if (d.len > 0.05 || d.rot > 1e-3) bad.push(`ellipse ${String(i)}: ${JSON.stringify(d)}`);
    }
    expect(bad).toEqual([]);
  });

  it('Quadrilateral.isNonRotatedRectangle matches on every case', () => {
    for (const [i, c] of golden.quads.entries()) {
      expect(quad(c.in).isNonRotatedRectangle(), `quad ${String(i)}`).toBe(c.expect.isNonRotatedRectangle);
    }
  });

  it('the shipped float C++ (information): discrete outcomes recorded', () => {
    const curveDiscrete = golden.curves.filter((c) => curveDiff(c.shipped, c.expect) === Infinity).length;
    const circleFlips = golden.ellipses.filter(
      (e) => (e.shipped.width === e.shipped.height) !== (e.expect.width === e.expect.height),
    ).length;
    const quadFlips = golden.quads.filter(
      (q) => q.shipped.isNonRotatedRectangle !== q.expect.isNonRotatedRectangle,
    ).length;
    // Recorded at capture time.
    expect({ curveDiscrete, circleFlips, quadFlips }).toEqual({ curveDiscrete: 0, circleFlips: 0, quadFlips: 0 });
  });
});
