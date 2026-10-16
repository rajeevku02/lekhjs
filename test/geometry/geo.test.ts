import { describe, expect, it } from 'vitest';
import { Span } from '../../src/base';
import {
  GeoUtil,
  LineEquation,
  Point,
  Rect,
  TurnDir,
  angleWithHorizontal,
  areaOfConvexPolygon,
  getAmplitudePointIndex,
  getAngle,
  getAngle4,
  getPointsBound,
  getPointsForArrow,
  getShapePoint,
  getSlope,
  getTurnDir,
  hasLoop,
  intersectionWithPolygon,
  intersects,
  isConvex,
  isInvalidPoint,
  isPointBetween,
  isPointInsidePolygon,
  preProcess,
  preProcess2,
  quickCheckRectangle,
  rectDistanceFrom,
  rectIntersects,
  rectIntersectsSegment,
  scale,
  scaleAnchored,
  toDegreeReadable,
  translate,
} from '../../src/geometry';

const P = (x: number, y: number): Point => new Point(x, y);
const square = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];

describe('GeoUtil angles', () => {
  it('getAngle is the turn in degrees (0 = straight on)', () => {
    expect(getAngle(P(0, 0), P(1, 0), P(2, 0))).toBe(0);
    expect(getAngle(P(0, 0), P(1, 0), P(1, 1))).toBeCloseTo(90, 9);
    expect(getAngle(P(0, 0), P(1, 0), P(0, 0))).toBeCloseTo(180, 9);
    expect(getAngle(P(0, 0), P(0, 0), P(1, 1))).toBeCloseTo(90, 9); // NaN → π/2
    expect(getAngle4(P(0, 0), P(1, 0), P(5, 5), P(5, 6))).toBeCloseTo(90, 9);
  });
  it('slope, horizontal angle, readable degrees', () => {
    expect(getSlope(P(0, 0), P(-1, -1))).toBeCloseTo(45, 9);
    expect(getSlope(P(1, 1), P(1, 1))).toBe(0);
    expect(angleWithHorizontal(P(10, 0), P(0, 10))).toBeCloseTo(-Math.PI / 4, 12);
    expect(toDegreeReadable((3 * Math.PI) / 2)).toBeCloseTo(-90, 9);
    expect(toDegreeReadable(5 * Math.PI)).toBeCloseTo(180, 9);
  });
  it('turn direction and convexity', () => {
    expect(getTurnDir(P(0, 0), P(1, 0), P(2, 0))).toBe(TurnDir.NoTurn);
    expect(getTurnDir(P(0, 0), P(1, 0), P(0, 0))).toBe(TurnDir.UTurn);
    expect(getTurnDir(P(0, 0), P(1, 0), P(1, -1))).toBe(TurnDir.Left);
    expect(getTurnDir(P(0, 0), P(1, 0), P(1, 1))).toBe(TurnDir.Right);
    expect(isConvex(square)).toBe(true);
    expect(isConvex([P(0, 0), P(10, 0), P(5, 2), P(10, 10), P(0, 10)])).toBe(false);
  });
});

describe('GeoUtil segments and polygons', () => {
  it('intersects and isPointBetween (1-unit tolerance on thin boxes)', () => {
    expect(intersects(P(0, 0), P(10, 10), P(0, 10), P(10, 0))).toBe(true);
    expect(intersects(P(0, 0), P(1, 1), P(0, 10), P(10, 0))).toBe(false);
    expect(intersects(P(0, 0), P(10, 0), P(0, 1), P(10, 1))).toBe(false);
    expect(isPointBetween(P(5, 0), P(5, 10), P(5.5, 3))).toBe(true);
    expect(isPointBetween(P(0, 0), P(10, 10), P(11, 5))).toBe(false);
  });
  it('point in polygon, area, loops', () => {
    expect(isPointInsidePolygon(square, P(5, 5))).toBe(true);
    expect(isPointInsidePolygon(square, P(15, 5))).toBe(false);
    expect(areaOfConvexPolygon(square)).toBe(100);
    expect(hasLoop([P(0, 0), P(10, 0), P(10, 10), P(5, -5)])).toBe(true);
    expect(hasLoop(square)).toBe(false);
  });
  it('intersection with a polygon gives the edge slopes', () => {
    const hits = intersectionWithPolygon(square, LineEquation.through(P(-5, 5), P(15, 5)));
    expect(hits.map((h) => h.point.x).sort((a, b) => a - b)).toEqual([0, 10]);
    for (const h of hits) expect(Math.abs(h.slope)).toBeCloseTo(Math.PI / 2, 12);
    expect(intersectionWithPolygon(square, LineEquation.through(P(-5, 5), P(15, 5)), false).length).toBe(1);
  });
  it('amplitude index over arrays and spans', () => {
    const pts = [P(0, 0), P(1, 3), P(2, 7), P(3, 1)];
    const eq = LineEquation.through(P(0, 0), P(3, 0));
    expect(getAmplitudePointIndex(pts, eq)).toBe(2);
    expect(getAmplitudePointIndex(new Span(pts, 2, 3), eq)).toBe(0);
    expect(getAmplitudePointIndex(new Span(pts, 3, 3), eq)).toBe(0);
  });
  it('arrow points', () => {
    const [a, tip, b] = getPointsForArrow(P(0, 0), P(10, 0), 4, 3);
    expect(tip).toEqual(P(10, 0));
    expect(a?.x).toBeCloseTo(6, 12);
    expect(Math.abs(a?.y ?? 0)).toBeCloseTo(3, 12);
    expect((a?.y ?? 0) + (b?.y ?? 0)).toBeCloseTo(0, 12);
  });
});

describe('GeoUtil point sets', () => {
  it('bounds of arrays and spans; empty is a zero rect', () => {
    expect(getPointsBound(square)).toEqual(new Rect(0, 0, 10, 10));
    expect(getPointsBound(new Span(square, 1, 2))).toEqual(new Rect(10, 0, 0, 10));
    expect(getPointsBound([])).toEqual(new Rect());
  });
  it('translate, scale (int shift), anchored scale', () => {
    expect(translate([P(1, 1)], 2, 3)).toEqual([P(3, 4)]);
    // mean (5, 5) → (10, 10): shifted back by (-5, -5)
    expect(scale(square, 2)).toEqual([P(-5, -5), P(15, -5), P(15, 15), P(-5, 15)]);
    // the C++ shift is an int: a 0.5 shift truncates to 0
    expect(scale([P(0, 0), P(1, 0)], 2)).toEqual([P(0, 0), P(2, 0)]);
    expect(scaleAnchored(square, 2, 3, 0)).toEqual([P(0, 0), P(20, 0), P(20, 30), P(0, 30)]);
    expect(scaleAnchored(square, 2, 3, 3)).toEqual([P(-10, -20), P(10, -20), P(10, 10), P(-10, 10)]);
    expect(scaleAnchored(square, 2, 3, -1)).toEqual([P(0, 0), P(20, 0), P(20, 30), P(0, 30)]);
  });
  it('preProcess densifies with pixels and skips points closer than 4', () => {
    const out = preProcess([P(0, 0), P(1, 0), P(6, 0)]);
    expect(out).toEqual([P(0, 0), P(1, 0), P(2, 0), P(3, 0), P(4, 0), P(5, 0), P(6, 0)]);
    expect(preProcess([])).toEqual([]);
    expect(preProcess([P(2, 2)])).toEqual([P(2, 2)]);
  });
  it('preProcess2 resamples to 3..7 apart', () => {
    const out = preProcess2([P(0, 0), P(1, 0), P(20, 0), P(25, 0)]);
    for (let i = 1; i < out.length - 1; i++) {
      const d = (out[i]?.x ?? 0) - (out[i - 1]?.x ?? 0);
      expect(d).toBeGreaterThanOrEqual(3);
      expect(d).toBeLessThanOrEqual(7);
    }
    expect(out[0]).toEqual(P(0, 0));
    expect(out[out.length - 1]).toEqual(P(25, 0));
  });
  it('invalid points', () => {
    expect(isInvalidPoint(P(NaN, 0))).toBe(true);
    expect(isInvalidPoint(P(0, Infinity))).toBe(true);
    expect(isInvalidPoint(P(0, 0))).toBe(false);
  });
  it('shape points use the C++ number format', () => {
    expect(getShapePoint(P(15, 0), new Rect(0, 0, 20, 30))).toEqual({ x: '0.25*w', y: '-0.5*h' });
    expect(getShapePoint(P(1, 1), new Rect(0, 0, 3, 0))).toEqual({ x: '-0.166667*w', y: '0*h' });
  });
});

describe('Rect operations in geo.ts', () => {
  const r = new Rect(0, 0, 10, 10);
  it('segment intersection', () => {
    expect(rectIntersectsSegment(r, P(-5, 5), P(15, 5))).toBe(true);
    expect(rectIntersectsSegment(r, P(5, 5), P(50, 50))).toBe(true);
    expect(rectIntersectsSegment(r, P(-5, -5), P(-1, 20))).toBe(false);
  });
  it('rect intersection: overlap, containment, separation, degenerate', () => {
    expect(rectIntersects(r, new Rect(5, 5, 10, 10))).toBe(true);
    expect(rectIntersects(r, new Rect(2, 2, 2, 2))).toBe(true);
    expect(rectIntersects(new Rect(2, 2, 2, 2), r)).toBe(true);
    expect(rectIntersects(r, new Rect(20, 20, 5, 5))).toBe(false);
    expect(rectIntersects(r, new Rect(5, -5, 0, 20))).toBe(true);
    expect(rectIntersects(r, new Rect(5, 5, 0, 0))).toBe(false);
    expect(rectIntersects(r, new Rect(5, 5, -1, 3))).toBe(false);
    expect(rectIntersects(new Rect(5, -5, 0, 20), r)).toBe(true);
  });
  it('rect intersection finds a crossing "plus" (no corner of either inside the other)', () => {
    expect(rectIntersects(new Rect(0, 4, 10, 2), new Rect(4, 0, 2, 10))).toBe(true);
  });
  it('distance from the nearest edge', () => {
    expect(rectDistanceFrom(r, P(5, 13))).toEqual({ dist: 3, near: P(5, 10) });
    expect(rectDistanceFrom(r, P(5, 6)).dist).toBe(4);
  });
  it('quickCheckRectangle', () => {
    expect(quickCheckRectangle([P(0, 0), P(0, 10), P(10, 10), P(10, 0)], 0)).toEqual({ sameX: 1, sameY: 3 });
    expect(quickCheckRectangle([P(0, 0), P(10, 0), P(10, 10), P(0, 10)], 0)).toEqual({ sameX: 3, sameY: 1 });
    expect(quickCheckRectangle([P(0, 0), P(1, 10), P(10, 10), P(10, 0)], 0)).toBeNull();
    expect(quickCheckRectangle(square.slice(0, 3), 0)).toBeNull();
  });
});

describe('GeoUtil object', () => {
  it('is frozen and carries the free functions', () => {
    expect(Object.isFrozen(GeoUtil)).toBe(true);
    expect(GeoUtil.getDistance(P(0, 0), P(3, 4))).toBe(5);
    expect(GeoUtil.pointLineSegmentDistance(P(0, 0), P(10, 0), P(5, 2)).dist).toBe(2);
  });
});
