// ShapeToLekh (C++ `ShapeToLekh::getLekhObject(geometry::Shape)`): which object a recognised shape
// becomes, as the model-independent description the MutationApplier (task R3) builds from.
import { describe, expect, it } from 'vitest';
import {
  BezierCurve,
  Ellipse,
  GeoShape,
  getPointsBound,
  PathComponent,
  Point,
  SimplePath,
} from '../../../src/geometry';
import { ELLIPSE_TEMPLATE_ID, shapeToLekh } from '../../../src/recognizer/client';

const P = (x: number, y: number): Point => new Point(x, y);

function pathShape(build: (p: SimplePath) => void, snap = true): GeoShape {
  const path = new SimplePath();
  build(path);
  const s = new GeoShape();
  s.setPath(path);
  s.setSnap(snap);
  return s;
}

describe('shapeToLekh', () => {
  it('an ellipse is the basic ellipse template in its rect, rotation normalised into ±π/2', () => {
    const s = new GeoShape();
    s.setEllipse(new Ellipse(P(100, 50), 80, 40, Math.PI * 0.75));
    s.setSnap(false);
    const spec = shapeToLekh(s, true);
    if (spec.kind !== 'ellipse') throw new Error(spec.kind);
    expect(spec.templateId).toBe(ELLIPSE_TEMPLATE_ID);
    expect([spec.rect.x, spec.rect.y, spec.rect.width, spec.rect.height]).toEqual([60, 30, 80, 40]);
    expect(spec.angle).toBeCloseTo(-Math.PI / 4, 12);
    // C++ ignores the shape's own snap flag for ellipses.
    expect(spec.snap).toBe(true);
    expect(shapeToLekh(s, false).snap).toBe(false);
  });

  it('a closed straight path is a closed polygon without the repeated first point', () => {
    const s = pathShape((p) => {
      p.addLine(P(0, 0), P(10, 0));
      p.addLine(P(10, 0), P(10, 10));
      p.addLine(P(10, 10), P(0, 0));
      p.setClosed(true);
    });
    const spec = shapeToLekh(s, true);
    if (spec.kind !== 'polygon') throw new Error(spec.kind);
    expect(spec.closed).toBe(true);
    expect(spec.points).toEqual([P(0, 0), P(10, 0), P(10, 10)]);
    expect(spec.snap).toBe(true);
  });

  it('an open polyline keeps every point; snap needs both the config and the shape', () => {
    const s = pathShape((p) => {
      p.addLine(P(0, 0), P(10, 0));
      p.addLine(P(10, 0), P(10, 10));
    }, false);
    const spec = shapeToLekh(s, true);
    if (spec.kind !== 'polygon') throw new Error(spec.kind);
    expect(spec.closed).toBe(false);
    expect(spec.points).toEqual([P(0, 0), P(10, 0), P(10, 10)]);
    expect(spec.snap).toBe(false);
  });

  it('a single curve is a Bezier object bounded by its rendered points', () => {
    const curve = new BezierCurve(P(0, 0), P(30, -40), P(70, -40), P(100, 0));
    const s = pathShape((p) => {
      p.addCurve(curve);
    });
    const spec = shapeToLekh(s, true);
    if (spec.kind !== 'bezier') throw new Error(spec.kind);
    expect(spec.curve.getPoints()).toEqual(curve.getPoints());
    expect(spec.bound).toEqual(getPointsBound(curve.clone().render([]).points));
    expect(spec.snap).toBe(true);
  });

  it('a mixed path is a path object, never snapped', () => {
    const s = pathShape((p) => {
      p.addLine(P(0, 0), P(10, 0));
      p.push(PathComponent.ofCurve(new BezierCurve(P(10, 0), P(20, 5), P(25, 15), P(30, 30))));
    });
    const spec = shapeToLekh(s, true);
    if (spec.kind !== 'path') throw new Error(spec.kind);
    expect(spec.path.size).toBe(2);
    expect(spec.snap).toBe(false);
  });
});
