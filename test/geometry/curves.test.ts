import { describe, expect, it } from 'vitest';
import { BezierCurve, Ellipse, LineEquation, LineSegment, Point, QuadBezier, Rect } from '../../src/geometry';

const P = (x: number, y: number): Point => new Point(x, y);
const close = (p: Point | undefined, x: number, y: number, d = 9): void => {
  expect(p?.x).toBeCloseTo(x, d);
  expect(p?.y).toBeCloseTo(y, d);
};

describe('BezierCurve', () => {
  const arch = (): BezierCurve => new BezierCurve(P(0, 0), P(0, 30), P(30, 30), P(30, 0));

  it('evaluates and splits (De Casteljau)', () => {
    const c = arch();
    close(c.getPoint(0.5), 15, 22.5);
    const [l, r] = c.split(0.5);
    close(l.point4, 15, 22.5);
    close(r.point1, 15, 22.5);
    close(l.getPoint(0.5), c.getPoint(0.25).x, c.getPoint(0.25).y);
    const sub = c.subCurve(0.25, 0.75);
    close(sub.point1, c.getPoint(0.25).x, c.getPoint(0.25).y);
    close(sub.point4, c.getPoint(0.75).x, c.getPoint(0.75).y);
  });

  it('slope at the ends and at the peak', () => {
    const c = arch();
    expect(c.slopeAt(0.5)).toBeCloseTo(0, 12);
    expect(Math.abs(c.slopeAt(0))).toBeCloseTo(Math.PI / 2, 12);
  });

  it('intersects a line and a segment', () => {
    const c = arch();
    const ts = c.intersectLine(LineEquation.through(P(0, 10), P(30, 10))).sort((a, b) => a - b);
    expect(ts.length).toBe(2);
    for (const t of ts) expect(c.getPoint(t).y).toBeCloseTo(10, 6);
    expect(c.intersectSegment(new LineSegment(P(0, 10), P(10, 10))).length).toBe(1);
  });

  it('clips to a rect', () => {
    const c = arch();
    expect(c.clip(new Rect(-1, -1, 40, 40))).toEqual([{ start: 0, end: 1 }]);
    const ranges = c.clip(new Rect(-1, -1, 40, 11));
    expect(ranges.length).toBe(2);
    expect(ranges[0]?.start).toBe(0);
    expect(ranges[1]?.end).toBe(1);
    expect(c.clip(new Rect(100, 100, 5, 5))).toEqual([]);
  });

  it('single control: peak and moving it', () => {
    const c = arch();
    close(c.getSingleControl(), 15, 22.5);
    c.moveSingleControlPoint(P(15, 30));
    close(c.getSingleControl(), 15, 30, 6);
    close(c.point1, 0, 0);
    close(c.point4, 30, 0);
  });

  it('transformToOrigin / transform round-trip', () => {
    const c = new BezierCurve(P(5, 5), P(10, 20), P(20, 20), P(25, 15));
    const tr = c.transformToOrigin();
    close(c.point1, 0, 0);
    expect(c.point4.y).toBeCloseTo(0, 9);
    c.transform(tr);
    close(c.point1, 5, 5);
    close(c.point2, 10, 20);
    close(c.point4, 25, 15);
  });

  it('approxLines: a straight cubic is one segment, an arch several', () => {
    expect(new BezierCurve(P(0, 0), P(10, 0), P(20, 0), P(30, 0)).approxLines().length).toBe(1);
    const lines = arch().approxLines();
    expect(lines.length).toBeGreaterThan(1);
    close(lines[0]?.p1, 0, 0);
    close(lines[lines.length - 1]?.p2, 30, 0);
  });

  it('render samples about 2 units apart; numPoints 2 renders the line', () => {
    const { points, step } = arch().render();
    expect(step).toBeGreaterThan(0);
    expect(points.length).toBeGreaterThan(10);
    const line = new BezierCurve(P(0, 0), P(3, 0), P(9, 9), P(9, 9), 2);
    expect(line.render().points).toEqual([P(1, 0), P(2, 0), P(3, 0)]);
  });

  it('left and top parameters; reversePoints; clone is independent', () => {
    const c = new BezierCurve(P(0, 0), P(-10, -30), P(40, -30), P(30, 0));
    const lt = c.getTForLeftAndTopPoint();
    expect(lt.left).toBeGreaterThan(0);
    expect(lt.top).toBeGreaterThan(0.3);
    const d = c.clone();
    d.reversePoints();
    expect(d.point1).toEqual(P(30, 0));
    expect(c.point1).toEqual(P(0, 0));
  });
});

describe('QuadBezier', () => {
  it('evaluates, slopes and intersects', () => {
    const q = new QuadBezier(P(0, 0), P(10, 20), P(20, 0));
    close(q.getPoint(0.5), 10, 10);
    expect(q.slopeAt(0.5)).toBeCloseTo(0, 12);
    const hits = q.intersect(LineEquation.through(P(0, 5), P(20, 5)));
    expect(hits.length).toBe(2);
    for (const h of hits) expect(h.point.y).toBeCloseTo(5, 9);
    expect(q.intersect(LineEquation.through(P(0, 50), P(20, 50)))).toEqual([]);
  });
  it('rotate and setPoints', () => {
    const q = new QuadBezier(P(1, 0), P(2, 0), P(3, 0));
    q.rotate(Math.PI / 2, P(0, 0));
    close(q.point3, 0, 3);
    q.setPoints([P(9, 9)]);
    close(q.point3, 0, 3);
  });
});

describe('Ellipse', () => {
  const e = new Ellipse(P(0, 0), 20, 10, 0);
  it('inside test', () => {
    expect(e.isInside(P(9.9, 0))).toBe(true);
    expect(e.isInside(P(0, 5.1))).toBe(false);
    const r = new Ellipse(P(0, 0), 20, 10, Math.PI / 2);
    expect(r.isInside(P(0, 9.9))).toBe(true);
    expect(r.isInside(P(9.9, 0))).toBe(false);
  });
  it('distance from the outline along the centre ray', () => {
    expect(e.getDistanceFrom(P(15, 0))).toBeCloseTo(5, 9);
    expect(e.getDistanceFrom(P(0, 8))).toBeCloseTo(3, 9);
    expect(e.getDistanceFrom(P(0, 0))).toBe(10);
    expect(new Ellipse(P(1, 1), 0, 0, 0).getDistanceFrom(P(4, 5))).toBe(5);
  });
  it('intersections with their slopes', () => {
    const hits = e.getIntersection(LineEquation.through(P(-30, 0), P(30, 0)));
    expect(hits.map((h) => Math.abs(h.point.x)).sort()).toEqual([10, 10]);
    for (const h of hits) expect(Math.abs(h.slope)).toBeCloseTo(Math.PI / 2, 9);
    const v = e.getIntersection(LineEquation.through(P(0, -30), P(0, 30)));
    expect(v.map((h) => Math.abs(h.point.y))).toEqual([5, 5]);
    const g = e.getIntersection(LineEquation.through(P(-30, 3), P(30, 3)));
    for (const h of g) expect((h.point.x * h.point.x) / 100 + (h.point.y * h.point.y) / 25).toBeCloseTo(1, 9);
    expect(e.getIntersection(LineEquation.through(P(-30, 7), P(30, 7)))).toEqual([]);
  });
  it('bounding rectangle, rotated', () => {
    const b = e.boundingRectangle();
    expect([b.x, b.y, b.width, b.height].map((v) => +v.toFixed(9))).toEqual([-10, -5, 20, 10]);
    const r = new Ellipse(P(5, 5), 20, 10, Math.PI / 2).boundingRectangle();
    expect([r.x, r.y, r.width, r.height].map((v) => +v.toFixed(9))).toEqual([0, -5, 10, 20]);
  });
});
