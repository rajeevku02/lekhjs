import { describe, expect, it } from 'vitest';
import {
  BezierCurve,
  GeoShape,
  GeoShapeType,
  PathComponent,
  PathStepType,
  Point,
  Rect,
  SimplePath,
  SimplePolygon,
  Ellipse,
} from '../../src/geometry';

const P = (x: number, y: number): Point => new Point(x, y);

function square(n = 10): SimplePath {
  const p = new SimplePath();
  p.addLine(P(0, 0), P(n, 0));
  p.addLine(P(n, 0), P(n, n));
  p.addLine(P(n, n), P(0, n));
  p.addLine(P(0, n), P(0, 0));
  return p;
}

describe('SimplePath', () => {
  it('length, bound, points, curveCount', () => {
    const p = square();
    expect(p.length()).toBe(40);
    expect(p.bound()).toEqual(new Rect(0, 0, 10, 10));
    expect(p.points()).toEqual([P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(0, 0)]);
    expect(p.curveCount()).toBe(0);
    expect(new SimplePath().bound()).toEqual(new Rect());
  });

  it('reverse, clone, insert', () => {
    const p = square();
    p.addCurve(new BezierCurve(P(0, 0), P(1, 1), P(2, 1), P(3, 0)));
    const q = p.clone();
    q.reverse();
    expect(q.front().isCurve).toBe(true);
    expect(q.front().firstPoint()).toEqual(P(3, 0));
    expect(q.back().lastPoint()).toEqual(P(0, 0));
    expect(p.front().firstPoint()).toEqual(P(0, 0));
    const r = new SimplePath();
    r.addLine(P(-1, -1), P(0, 0));
    p.insert(0, r);
    expect(p.size).toBe(6);
    expect(p.front().firstPoint()).toEqual(P(-1, -1));
  });

  it('component end points can be moved', () => {
    const c = PathComponent.line(P(0, 0), P(1, 1));
    c.setFirstPoint(P(5, 5));
    c.setLastPoint(P(6, 6));
    expect([c.firstPoint(), c.lastPoint()]).toEqual([P(5, 5), P(6, 6)]);
    const k = PathComponent.ofCurve(new BezierCurve(P(0, 0), P(1, 1), P(2, 1), P(3, 0)));
    k.setLastPoint(P(9, 9));
    expect(k.curve.point4).toEqual(P(9, 9));
  });

  it('clip cuts out what lies inside the rect', () => {
    const p = new SimplePath();
    p.addLine(P(0, 5), P(30, 5));
    const parts = p.clip(new Rect(10, 0, 10, 10));
    expect(parts.length).toBe(2);
    expect(parts[0]?.back().lastPoint().x).toBeCloseTo(10, 9);
    expect(parts[1]?.front().firstPoint().x).toBeCloseTo(20, 9);
    expect(p.clipAll([new Rect(10, 0, 10, 10), new Rect(-5, 0, 7, 10)]).length).toBe(2);
    expect(p.clipAll([]).length).toBe(1);
  });

  it('clip of a curve keeps the outside parameter ranges', () => {
    const p = new SimplePath();
    p.addCurve(new BezierCurve(P(0, 0), P(0, 30), P(30, 30), P(30, 0)));
    const parts = p.clip(new Rect(-1, -1, 40, 11));
    expect(parts.length).toBe(1);
    expect(parts[0]?.size).toBe(1);
    expect(parts[0]?.front().isCurve).toBe(true);
  });

  it('findFirstLoop splits a figure-of-eight style stroke', () => {
    const p = new SimplePath();
    const pts = [P(0, 0), P(10, 0), P(10, 10), P(5, -5), P(5, -10)];
    for (let i = 0; i + 1 < pts.length; i++) p.addLine(pts[i] ?? P(0, 0), pts[i + 1] ?? P(0, 0));
    const [loop, rest] = p.findFirstLoop();
    expect(loop?.front().firstPoint().y).toBeCloseTo(0, 9);
    expect(loop?.back().lastPoint().y).toBeCloseTo(0, 9);
    expect(rest?.front().firstPoint()).toEqual(P(0, 0));
    expect(rest?.back().lastPoint()).toEqual(P(5, -10));
    expect(square().findFirstLoop().length).toBe(2);
    const open = new SimplePath();
    open.addLine(P(0, 0), P(1, 0));
    expect(open.findFirstLoop()).toEqual([]);
  });

  it('roundedRect and rectPathSteps', () => {
    const p = SimplePath.roundedRect(new Rect(0, 0, 100, 50), 10);
    expect(p.size).toBe(8);
    expect(p.closed()).toBe(true);
    expect(p.curveCount()).toBe(4);
    expect(p.front().firstPoint()).toEqual(P(90, 0));
    const b = p.bound();
    expect([b.x, b.y, b.width, b.height].map((v) => Math.round(v))).toEqual([0, 0, 100, 50]);
    const clamped = SimplePath.roundedRect(new Rect(0, 0, 10, 4), 10);
    expect(clamped.front().firstPoint()).toEqual(P(5, 0));
    const steps = SimplePath.rectPathSteps(new Rect(0, 0, 2, 3));
    expect(steps.map((s) => s.type)).toEqual([
      PathStepType.Move,
      PathStepType.Line,
      PathStepType.Line,
      PathStepType.Line,
      PathStepType.Close,
    ]);
    expect(steps[2]?.p1).toEqual(P(2, 3));
  });
});

describe('SimplePolygon', () => {
  it('canClose trims an overshooting end', () => {
    // a square drawn past its start: both ends can be trimmed 8 away; the tie goes to the end
    const pts = [P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(0, -8), P(10, -8)];
    const poly = new SimplePolygon(pts);
    expect(poly.canClose()).toBe(true);
    expect(poly.vertices()).toEqual([P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(0, -8), P(0, -8)]);
  });

  it('canClose is false for an open zigzag and for under four points', () => {
    expect(new SimplePolygon([P(0, 0), P(100, 0), P(200, 0), P(300, 0), P(400, 0)]).canClose()).toBe(false);
    expect(new SimplePolygon([P(0, 0), P(1, 0), P(1, 1)]).canClose()).toBe(false);
  });

  it('canMakeConvex keeps a convex quad and refuses a deep notch', () => {
    const ok = new SimplePolygon([P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(0, 2)]);
    expect(ok.canMakeConvex()).toBe(true);
    expect(ok.vertices().length).toBe(4);
    const notch = new SimplePolygon([P(0, 0), P(100, 0), P(100, 100), P(50, 10), P(0, 100), P(0, 2)]);
    expect(notch.canMakeConvex()).toBe(false);
  });

  it('computeHull drops interior points, keeping vertex order', () => {
    const poly = new SimplePolygon([P(0, 0), P(5, 5), P(10, 0), P(10, 10), P(0, 10)]);
    poly.computeHull();
    expect(poly.vertices()).toEqual([P(0, 0), P(10, 0), P(10, 10), P(0, 10)]);
    expect(SimplePolygon.fromPath(square()).vertices().length).toBe(5);
  });
});

describe('GeoShape', () => {
  it('holds an ellipse or a path', () => {
    const s = new GeoShape();
    expect(s.type()).toBe(GeoShapeType.Path);
    expect(s.snap()).toBe(true);
    s.setEllipse(new Ellipse(P(1, 1), 2, 2, 0));
    expect(s.type()).toBe(GeoShapeType.Ellipse);
    s.setPath(square());
    expect(s.path().size).toBe(4);
    s.setSnap(false);
    expect(s.snap()).toBe(false);
  });
});
