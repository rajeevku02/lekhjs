import { describe, expect, it } from 'vitest';
import {
  BezierCurve,
  CurveFitter,
  EllipseFitter,
  FitLine,
  Point,
  Quadrilateral,
  Triangle,
  areComparableLength,
  getDistance,
} from '../../../src/geometry';

const P = (x: number, y: number): Point => new Point(x, y);

describe('FitLine', () => {
  it('snaps near-horizontal, near-vertical and near-45° lines', () => {
    const h = new FitLine(P(0, 0), P(100, 10), 2);
    h.regularize();
    expect(h.endPoint).toEqual(P(100, 0));
    const v = new FitLine(P(0, 0), P(5, 100), 2);
    v.regularize();
    expect(v.endPoint).toEqual(P(0, 100));
    const d = new FitLine(P(0, 0), P(100, -95), 2);
    d.regularize();
    expect(d.endPoint).toEqual(P(100, -100));
    const none = new FitLine(P(0, 0), P(100, 40), 2);
    none.regularize();
    expect(none.endPoint).toEqual(P(100, 40));
    const off = new FitLine(P(0, 0), P(100, 10), 0);
    off.regularize();
    expect(off.endPoint).toEqual(P(100, 10));
  });
});

describe('areComparableLength', () => {
  it('within max / factor', () => {
    expect(areComparableLength(100, 110, 10)).toBe(true);
    expect(areComparableLength(100, 112, 10)).toBe(false);
    expect(areComparableLength(5, 5, 1)).toBe(true);
  });
});

describe('Quadrilateral', () => {
  it('regularize snaps a slightly skewed axis rectangle', () => {
    const q = new Quadrilateral(P(0, 0), P(1, 100), P(201, 99), P(200, -1));
    expect(q.isRectangle()).toBe(true);
    q.regularize();
    const xs = new Set(q.points().map((p) => p.x));
    const ys = new Set(q.points().map((p) => p.y));
    expect([xs.size, ys.size]).toEqual([2, 2]);
    expect(q.angle()).toBe(0);
  });
  it('a trapezoid is not a parallelogram and is left alone', () => {
    const pts = [P(0, 0), P(200, 0), P(110, 100), P(90, 100)] as const; // opposite angles 48° vs 132°
    const q = new Quadrilateral(...pts);
    q.regularize();
    expect(q.points()).toEqual([...pts]);
  });
  it('makeSquare on the centroid with the mean side', () => {
    const q = new Quadrilateral(P(0, 0), P(0, 10), P(12, 10), P(12, 0));
    q.makeSquare();
    expect(q.points()).toEqual([P(0.5, -0.5), P(0.5, 10.5), P(11.5, 10.5), P(11.5, -0.5)]);
    expect(q.isSquare()).toBe(true);
    expect(q.clone().points()).toEqual(q.points());
  });
  it('honours the configured parallelogram angle', () => {
    const skew = (): Quadrilateral => new Quadrilateral(P(0, 0), P(60, 100), P(260, 110), P(200, 10));
    const a = skew();
    a.regularize({ parallelogramRegularizeAngle: 0 });
    const b = skew();
    b.regularize();
    expect(a.points()).not.toEqual(b.points());
  });
});

describe('Triangle', () => {
  it('makeEquilateral gives an upright triangle with the C++ sin/cos constants', () => {
    const t = new Triangle(P(0, -10), P(-8, 6), P(8, 6));
    t.makeEquilateral();
    expect(t.p1.x).toBeCloseTo(0, 12);
    expect(t.p2.y).toBeCloseTo(t.p3.y, 12);
    expect(t.isEquilateral()).toBe(true);
    const ic = Triangle.inCircle(P(0, 0), 10);
    expect(ic.p2).toEqual(P(-8.6602, 4.9999));
  });
});

describe('CurveFitter', () => {
  it('fits one cubic to points sampled from a cubic, ends exact', () => {
    const src = new BezierCurve(P(0, 0), P(30, 80), P(120, 80), P(150, 0));
    const pts: Point[] = [];
    for (let i = 0; i <= 60; i++) pts.push(src.getPoint(i / 60));
    const [c, ...rest] = CurveFitter.fitSingle(pts, 70);
    expect(rest).toEqual([]);
    expect(c?.point1).toEqual(P(0, 0));
    expect(c?.point4).toEqual(pts[60]);
    expect(c?.numPoints).toBe(4);
    for (let i = 0; i <= 10; i++) {
      const a = c?.getPoint(i / 10) ?? P(NaN, NaN);
      let best = Infinity;
      for (const p of pts) best = Math.min(best, getDistance(a, p));
      expect(best).toBeLessThan(6);
    }
  });
  it('fits nothing under eight points, and refuses under two', () => {
    expect(CurveFitter.fitSingle([P(0, 0), P(1, 1), P(2, 2)])).toEqual([]);
    const f = new CurveFitter(70);
    expect(f.initialise([P(0, 0)], 1)).toBe(false);
    f.fitSingle();
    expect(f.curves).toEqual([]);
  });
  it('all points equal: a degenerate curve on the point (zero tangents keep their length), as in C++', () => {
    const pts = Array.from({ length: 10 }, () => P(5, 5));
    const [c] = CurveFitter.fitSingle(pts);
    expect(c?.getPoints()).toEqual([P(5, 5), P(5, 5), P(5, 5), P(5, 5)]);
  });
});

describe('EllipseFitter', () => {
  const sample = (cx: number, cy: number, a: number, b: number, rot: number): Point[] =>
    Array.from({ length: 72 }, (_, i) => {
      const t = (i / 72) * 2 * Math.PI;
      const x = a * Math.cos(t);
      const y = b * Math.sin(t);
      return P(cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot));
    });

  it('a circle-ish ellipse snaps to a circle', () => {
    const e = new EllipseFitter(sample(50, 60, 40, 32, 0.3)).fit();
    expect(e.width).toBe(e.height);
    expect(e.rotation).toBe(0);
  });
  it('an axis-near ellipse keeps its axes and snaps its rotation', () => {
    const e = new EllipseFitter(sample(0, 0, 100, 40, 0.2)).fit();
    expect(e.width).toBeCloseTo(200, 0);
    expect(e.height).toBeGreaterThan(70);
    expect(e.rotation).toBe(0);
    const v = new EllipseFitter(sample(0, 0, 100, 40, Math.PI / 2 + 0.1)).fit();
    expect(Math.abs(v.rotation)).toBe(Math.PI / 2);
  });
  it('a diagonal ellipse keeps its rotation', () => {
    const e = new EllipseFitter(sample(0, 0, 100, 30, Math.PI / 4)).fit();
    expect(
      Math.abs(Math.abs(e.rotation) - Math.PI / 4) < 0.1 || Math.abs(Math.abs(e.rotation) - (3 * Math.PI) / 4) < 0.1,
    ).toBe(true);
  });
});
