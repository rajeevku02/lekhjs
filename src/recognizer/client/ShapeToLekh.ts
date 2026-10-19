// Which board object a recognised shape becomes (port of the live half of C++ `lekh::ShapeToLekh`,
// `getLekhObject(geometry::Shape::Ptr)`; spec 07 §6.6). It runs on the main thread when a mutation
// is applied, on a shape already mapped to CANVAS coordinates by `MutationApplier`.
//
// The lekhjs object model (templates, `TemplatedObject`) does not exist yet (tasks E4-E6), so this
// returns a model-independent description, `RecognizedObjectSpec`, of exactly what C++ builds; the
// final step (template lookup / `PolygonTemplate.getPolygonTemplate` / `PathTemplate.from`, the
// `TemplatedObject` and `generateData`) is `MutationApplier`'s (task R3).
//
// Dropped as dead: the `recognizer::Shape` overloads (`getEllipse`, `getPolygon(Shape)`,
// `getPolyline`, `getCurve`) and the commented-out `getLekhForPath`.
import {
  GeoShapeType,
  getPointsBound,
  normalizeInHalfPI,
  Rect,
  type BezierCurve,
  type GeoShape,
  type Point,
  type SimplePath,
} from '../../geometry';

/** C++ `"avabodh.basic.ellipse"`. */
export const ELLIPSE_TEMPLATE_ID = 'avabodh.basic.ellipse';

export type RecognizedObjectSpec =
  /** `TemplatedObject(getTemplate("avabodh.basic.ellipse"), rect, angle, snapToGridNewObject)`. */
  | {
      readonly kind: 'ellipse';
      readonly templateId: string;
      readonly rect: Rect;
      readonly angle: number;
      readonly snap: boolean;
    }
  /**
   * `PolygonTemplate.getPolygonTemplate(points, closed, false)` → (template, bound, angle);
   * `TemplatedObject(template, bound, angle, snap)`; `generateData()`. A closed path's repeated
   * last point is already dropped.
   */
  | { readonly kind: 'polygon'; readonly points: readonly Point[]; readonly closed: boolean; readonly snap: boolean }
  /** `TemplatedObject(new BezierCurveTemplate(curve), bound, 0, snap)` (no `generateData`, as C++). */
  | { readonly kind: 'bezier'; readonly curve: BezierCurve; readonly bound: Rect; readonly snap: boolean }
  /** `PathTemplate.from(path)` → (template, bound); `load()`; `TemplatedObject(template, bound, 0, false)`; `generateData()`. */
  | { readonly kind: 'path'; readonly path: SimplePath; readonly snap: false };

/**
 * C++ `getLekhObject(geometry::Shape)`. `snapToGridNewObject` is the engine `Config` field. C++
 * returns null when `PathTemplate::from` fails; that check belongs to the caller that builds it.
 */
export function shapeToLekh(shape: GeoShape, snapToGridNewObject: boolean): RecognizedObjectSpec {
  if (shape.type() === GeoShapeType.Ellipse) {
    const e = shape.ellipse();
    const angle = e.rotation !== 0 ? normalizeInHalfPI(e.rotation) : e.rotation;
    // C++ ignores the shape's own `snap` for ellipses.
    return {
      kind: 'ellipse',
      templateId: ELLIPSE_TEMPLATE_ID,
      rect: Rect.fromCenter(e.center, e.width, e.height),
      angle,
      snap: snapToGridNewObject,
    };
  }
  const path = shape.path();
  const snap = snapToGridNewObject && shape.snap();
  const polygon = getPolygon(path, snap);
  if (polygon !== null) return polygon;
  const curve = getSingleCurve(path, snap);
  if (curve !== null) return curve;
  return { kind: 'path', path: path.clone(), snap: false };
}

/** C++ `getPolygon(SimplePath, snap)`: a path without curves (null when it has curves or no points). */
function getPolygon(path: SimplePath, snap: boolean): RecognizedObjectSpec | null {
  if (path.curveCount() > 0) return null;
  const points = path.points();
  const closed = path.closed();
  if (closed) points.pop();
  if (points.length === 0) return null;
  return { kind: 'polygon', points, closed, snap };
}

/** C++ `getSingleCurve`: exactly one component, a curve; bound of its rendered points. */
function getSingleCurve(path: SimplePath, snap: boolean): RecognizedObjectSpec | null {
  if (path.size !== 1 || path.curveCount() !== 1) return null;
  const bzc = path.at(0).curve.clone();
  const { points } = bzc.render([]);
  return { kind: 'bezier', curve: bzc, bound: getPointsBound(points), snap };
}
