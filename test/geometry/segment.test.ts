import { describe, expect, it } from 'vitest';
import { LineEquation, LineSegment, Point, Rect, distanceToSegment, joinTrim } from '../../src/geometry';

const seg = (a: number, b: number, c: number, d: number): LineSegment =>
  new LineSegment(new Point(a, b), new Point(c, d));

describe('LineSegment', () => {
  it('distance to the foot of the perpendicular, or to the nearer end', () => {
    const s = seg(0, 0, 10, 0);
    expect(s.getDistanceFrom(new Point(5, 3))).toEqual({ dist: 3, near: new Point(5, 0) });
    const e = s.getDistanceFrom(new Point(13, 4));
    expect(e.dist).toBe(5);
    expect(e.near).toEqual(new Point(10, 0));
  });
  it('a degenerate segment measures to its ends', () => {
    const s = seg(2, 2, 2, 2);
    expect(s.getDistanceFrom(new Point(5, 6)).dist).toBe(5);
  });
  it('intersections', () => {
    expect(seg(0, 0, 10, 10).getIntersection(seg(0, 10, 10, 0))).toEqual(new Point(5, 5));
    expect(seg(0, 0, 1, 1).getIntersection(seg(0, 10, 10, 0))).toBeNull();
    expect(seg(0, 0, 10, 0).getIntersection(seg(0, 1, 10, 1))).toBeNull();
    const w = seg(0, -5, 0, 5).getIntersectionWithLine(LineEquation.through(new Point(-1, 2), new Point(1, 2)));
    expect(w?.x).toBeCloseTo(0, 12);
    expect(w?.y).toBe(2);
  });
  it('clip to a rect', () => {
    const r = new Rect(0, 0, 10, 10);
    expect(seg(1, 1, 2, 2).clip(r)).toEqual([seg(1, 1, 2, 2)]);
    const [c] = seg(5, 5, 15, 5).clip(r);
    expect(c?.p1).toEqual(new Point(5, 5));
    expect(c?.p2.x).toBeCloseTo(10, 9);
    const [d] = seg(-5, 5, 15, 5).clip(r);
    expect(d?.p1.x).toBeCloseTo(0, 9);
    expect(d?.p2.x).toBeCloseTo(10, 9);
    expect(seg(-5, -5, -1, -1).clip(r)).toEqual([]);
  });
  it('Bresenham pixels without the first, truncating coordinates', () => {
    expect(seg(0.9, 0.9, 3.2, 1.7).getRenderedPoints()).toEqual([new Point(1, 0), new Point(2, 1), new Point(3, 1)]);
    const out: Point[] = [];
    LineSegment.addIntermediatePoints(out, new Point(0, 0), new Point(0, 2));
    expect(out).toEqual([new Point(0, 1), new Point(0, 2)]);
  });
  it('inRange, containsEqPoint, length, with/reversed', () => {
    const s = seg(0, 0, 3, 4);
    expect(s.length()).toBe(5);
    expect(s.inRange(new Point(3.1, 4.1))).toBe(true);
    expect(s.inRange(new Point(3.3, 4))).toBe(false);
    expect(s.containsEqPoint(new Point(1.5, 2))).toBe(true);
    expect(s.containsEqPoint(new Point(6, 8))).toBe(false);
    expect(s.reversed()).toEqual(seg(3, 4, 0, 0));
    expect(s.withPoint2(new Point(1, 1))).toEqual(seg(0, 0, 1, 1));
  });
  it('tryJoin', () => {
    const j = LineSegment.tryJoin(seg(0, 0, 10, 10), seg(0, 10, 10, 0));
    expect(j).toMatchObject({ at: new Point(5, 5), dist: 0 });
    expect(joinTrim(j)).toBeCloseTo(2 * Math.hypot(5, 5), 9);
    const k = LineSegment.tryJoin(seg(0, 1, 10, 1), seg(-3, 0, -3, 10));
    expect(k.dist).toBe(3);
    expect(k.at).toEqual(new Point(-3, 1));
    expect(k.other).toEqual(new Point(0, 1));
  });
});

describe('distanceToSegment (P3)', () => {
  // The allocation-free form the freehand hit test uses must give exactly LineSegment's number.
  it('equals LineSegment.getDistanceFrom(...).dist bit for bit', () => {
    let s = 7;
    const r = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
    const pick = () => (r() < 0.2 ? Math.round(r() * 20) : r() * 2000 - 1000);
    for (let i = 0; i < 20000; i++) {
      const p1 = new Point(pick(), pick());
      const p2 =
        i % 50 === 0 ? new Point(p1.x, p1.y) : i % 7 === 0 ? new Point(p1.x, pick()) : new Point(pick(), pick());
      const q = new Point(pick(), pick());
      expect(Object.is(distanceToSegment(p1, p2, q), new LineSegment(p1, p2).getDistanceFrom(q).dist)).toBe(true);
    }
  });
});
