import { describe, expect, it } from 'vitest';
import {
  LineEquation,
  Point,
  Rect,
  Size,
  Vector,
  normalizeAngleIn2PI,
  normalizeAngleInPI,
  normalizeInHalfPI,
  rotate,
  rotateAboutMid,
  rotatePoint,
  toDegree,
  toRadian,
} from '../../src/geometry';

const close = (p: Point, x: number, y: number, d = 9): void => {
  expect(p.x).toBeCloseTo(x, d);
  expect(p.y).toBeCloseTo(y, d);
};

describe('Point and Size', () => {
  it('are immutable values', () => {
    const p = new Point(1, 2);
    expect(p.zoomed(2)).toEqual(new Point(2, 4));
    expect(p.withDelta(1, 1)).toEqual(new Point(2, 3));
    expect(p).toEqual(new Point(1, 2));
    expect(p.equals(new Point(1, 2))).toBe(true);
    expect(new Point().toStr()).toBe('(0, 0)');
    expect(new Size(3, 4).equals(new Size(3, 4))).toBe(true);
  });
});

describe('rotation and angles', () => {
  it('rotates about a pivot', () => {
    close(rotatePoint(new Point(2, 1), new Point(1, 1), Math.PI / 2), 1, 2);
    const r = rotate([new Point(0, 0), new Point(2, 0)], new Point(1, 0), Math.PI);
    close(r[0] ?? new Point(), 2, 0);
    close(r[1] ?? new Point(), 0, 0);
    const m = rotateAboutMid([new Point(0, 0), new Point(2, 0)], Math.PI / 2);
    close(m[0] ?? new Point(), 1, -1);
  });
  it('angle 0 returns the points unchanged', () => {
    const pts = [new Point(0.1, 0.2)];
    expect(rotate(pts, new Point(5, 5), 0)).toEqual(pts);
  });
  it('normalises', () => {
    expect(normalizeAngleInPI(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeAngleInPI(-3 * Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(normalizeAngleIn2PI(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(normalizeInHalfPI((3 * Math.PI) / 4)).toBeCloseTo(-Math.PI / 4, 12);
    expect(normalizeInHalfPI((-3 * Math.PI) / 4)).toBeCloseTo(Math.PI / 4, 12);
    expect(toDegree(Math.PI)).toBe(180);
    expect(toRadian(90)).toBe(Math.PI / 2);
  });
});

describe('Rect', () => {
  const r = new Rect(10, 20, 30, 40);
  it('corners, centre and contains (edges inclusive)', () => {
    expect(r.getPoints()).toEqual([new Point(10, 20), new Point(10, 60), new Point(40, 60), new Point(40, 20)]);
    expect(r.center()).toEqual(new Point(25, 40));
    expect(r.contains(new Point(10, 60))).toBe(true);
    expect(r.contains(new Point(9.99, 60))).toBe(false);
    expect(r.containsRect(new Rect(11, 21, 5, 5))).toBe(true);
    expect(r.right()).toBe(40);
    expect(r.bottom()).toBe(60);
    expect(r.area()).toBe(1200);
  });
  it('inflate, zoom, include return new rects', () => {
    expect(r.inflate(10)).toEqual(new Rect(5, 15, 40, 50));
    expect(r.inflate(-100)).toEqual(new Rect(60, 70, 0, 0));
    expect(r.zoom(2)).toEqual(new Rect(20, 40, 60, 80));
    expect(r.include(new Point(0, 100))).toEqual(new Rect(0, 20, 40, 80));
    expect(r.includeRect(new Rect(0, 0, 1, 1))).toEqual(new Rect(0, 0, 40, 60));
    expect(r).toEqual(new Rect(10, 20, 30, 40));
  });
  it('checkMinDimension and the static constructors', () => {
    expect(new Rect(0, 0, 4, 100).checkMinDimension(5, 20)).toEqual(new Rect(-8, 0, 20, 100));
    expect(Rect.fromCenter(new Point(5, 5), 4, 2)).toEqual(new Rect(3, 4, 4, 2));
    const ic = Rect.inCircle(new Point(0, 0), 1);
    expect(ic.width).toBeCloseTo(Math.SQRT2, 12);
  });
});

describe('LineEquation and Vector', () => {
  it('through two points, distance and solve', () => {
    const l = LineEquation.through(new Point(0, 0), new Point(10, 0));
    expect(l.getDistanceFrom(new Point(3, 4))).toBe(4);
    const m = LineEquation.through(new Point(5, -5), new Point(5, 5));
    const s = l.solveWith(m);
    expect(s?.x).toBe(5);
    expect(s?.y).toBeCloseTo(0, 12);
    expect(l.solveWith(LineEquation.through(new Point(0, 1), new Point(1, 1)))).toBeNull();
  });
  it('fromAngle, perpendicular and getY', () => {
    const l = LineEquation.fromAngle(Math.PI / 4, new Point(0, 1));
    expect(l.getY(2)).toBeCloseTo(3, 12);
    expect(l.angleWithHorizontal()).toBeCloseTo(Math.PI / 4, 12);
    const p = l.getPerpendicularPassingThrough(new Point(0, 1));
    expect(p.getY(1)).toBeCloseTo(0, 12);
  });
  it('points at a distance', () => {
    const l = LineEquation.through(new Point(0, 0), new Point(3, 4));
    const [a, b] = l.getPointsAtDistanceFrom(5, new Point(0, 0));
    close(a ?? new Point(), 3, 4);
    close(b ?? new Point(), -3, -4);
    expect(LineEquation.through(new Point(0, 0), new Point(0, 4)).getPointsAtDistanceFrom(1, new Point(0, 0))).toEqual([
      new Point(0, 1),
      new Point(0, -1),
    ]);
  });
  it('translateOrigin and rotate', () => {
    const l = LineEquation.through(new Point(0, 0), new Point(10, 0));
    const t = l.translateOrigin(new Point(0, 5));
    expect(t.getY(0)).toBeCloseTo(-5, 12);
    // pivot on the line
    const r1 = l.rotate(new Point(2, 0), Math.PI / 2);
    expect(r1.getDistanceFrom(new Point(2, 7))).toBeCloseTo(0, 9);
    // pivot off the line: y = 0 rotated 90° about (0, 1) is x = 1
    const r2 = l.rotate(new Point(0, 1), Math.PI / 2);
    expect(r2.getDistanceFrom(new Point(1, 50))).toBeCloseTo(0, 9);
    expect(l.rotate(new Point(0, 1), 0)).toBe(l);
  });
  it('touches', () => {
    const l = LineEquation.through(new Point(0, 0), new Point(10, 0));
    expect(l.touches(new Point(0, 1), new Point(0, -1))).toBe(true);
    expect(l.touches(new Point(0, 1), new Point(0, 2))).toBe(false);
  });
  it('Vector', () => {
    const v = Vector.between(new Point(1, 1), new Point(4, 5));
    expect(v.normalize().dx).toBeCloseTo(0.6, 12);
    expect(v.sum(new Vector(1, 1))).toEqual(new Vector(4, 5));
    expect(v.lineEquation(new Point(1, 1)).getDistanceFrom(new Point(4, 5))).toBeCloseTo(0, 12);
  });
});
