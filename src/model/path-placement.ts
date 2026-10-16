// Snaps a drawn path's ends to nearby polygon and ellipse outlines (port of C++ `PathPlacement`,
// `L/PathPlacement.{h,cpp}`). The path is in screen (view) coordinates, as the recognizer hands
// it; `view` maps between screen and canvas (C++ `LekhUtil::mapPoint` / `mapPointR` over the
// global zoom and scroll). The candidates of each end come from the spatial index (spec 03 §4
// #18) instead of a scan of the page; the loop and its strict-`<` tie-break are unchanged.
import { INT_MAX } from '../base';
import { LineEquation, Point, Rect, getDistance, rectIntersects, type SimplePath } from '../geometry';
import { EllipseShape, PolygonTemplate } from '../template';
import type { LekhObject, SceneQuery } from './lekh-object';
import { ObjectKind } from './lekh-object';
import { TemplatedObject } from './templated-object';

/** Screen ↔ canvas mapping (`ViewTransform.toDoc` / `toScreen`). */
export interface ViewMapping {
  toDoc(p: Point): Point;
  toScreen(p: Point): Point;
}

const IDENTITY: ViewMapping = Object.freeze({ toDoc: (p: Point) => p, toScreen: (p: Point) => p });

/** C++ `PathPlacement::DistCheck`. */
interface DistCheck {
  dist: number;
  pt: Point;
  contains: boolean;
  obj: TemplatedObject | null;
}

/** C++ `maxAllowedDist`, in screen units. */
const MAX_ALLOWED_DIST = 55;

function isPolygon(t: TemplatedObject): boolean {
  const st = t.shapeTemplate();
  return st instanceof PolygonTemplate && st.isClosed();
}

function isEllipse(t: TemplatedObject): boolean {
  const st = t.shapeTemplate();
  const paths = t.paths();
  if (st === null || paths === null || paths.length !== 1 || st.embeds().length > 0) return false;
  const sp = paths[0]?.shapes() ?? [];
  return sp.length === 1 && sp[0] instanceof EllipseShape;
}

export class PathPlacement {
  private readonly scene_: SceneQuery;
  private readonly view_: ViewMapping;

  constructor(scene: SceneQuery, view: ViewMapping = IDENTITY) {
    this.scene_ = scene;
    this.view_ = view;
  }

  /** C++ `place(path)`: true when an end of `path` (edited in place) was moved onto an outline. */
  place(path: SimplePath): boolean {
    if (path.size === 0 || path.curveCount() > 0) return false;
    const seg1 = path.front().segment;
    const seg2 = path.back().segment;
    const v = this.view_;
    const eq1 = LineEquation.through(v.toDoc(seg1.point1()), v.toDoc(seg1.point2()));
    const eq2 = LineEquation.through(v.toDoc(seg2.point1()), v.toDoc(seg2.point2()));
    const p1 = seg1.point1();
    const p2 = seg2.point2();
    const endPtDist = getDistance(p1, p2);
    if (endPtDist < 8) return false;
    const dc1: DistCheck = { dist: INT_MAX, pt: p1, contains: false, obj: null };
    const dc2: DistCheck = { dist: INT_MAX, pt: p2, contains: false, obj: null };
    for (const t of this.candidates(p1)) this.check(eq1, p1, t, endPtDist, path, dc1);
    for (const t of this.candidates(p2)) this.check(eq2, p2, t, endPtDist, path, dc2);
    return this.apply(path, dc1, dc2);
  }

  /** The closed polygons and plain ellipses whose extent comes within the snap reach of `p`. */
  private candidates(p: Point): TemplatedObject[] {
    const v = this.view_;
    const r = MAX_ALLOWED_DIST + 1;
    const a = v.toDoc(new Point(p.x - r, p.y - r));
    const b = v.toDoc(new Point(p.x + r, p.y + r));
    const rect = new Rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    const pred = (o: LekhObject): boolean =>
      o.kind === ObjectKind.Templated &&
      o instanceof TemplatedObject &&
      (isPolygon(o) || isEllipse(o)) &&
      rectIntersects(o.extent(), rect);
    return this.scene_.objectsWhere(rect, pred) as TemplatedObject[];
  }

  private check(
    eq: LineEquation,
    pt: Point,
    tobj: TemplatedObject,
    endPtDist: number,
    path: SimplePath,
    dc: DistCheck,
  ): void {
    const pts = tobj.getIntersection(eq);
    if (pts.length === 0 || pts.length > 2) return;
    const mapped = pts.map((ps) => this.view_.toScreen(ps.point));
    // C++ read mappedPts[1] of a one-point list (undefined behaviour); here the distance is 0.
    const intersectDist = getDistance(mapped[0] as Point, mapped[1] ?? (mapped[0] as Point));
    let allowedDist = Math.min(MAX_ALLOWED_DIST, intersectDist * 0.4);
    if (path.size === 1) allowedDist = Math.min(allowedDist, endPtDist * 0.3);
    for (const point of mapped) {
      const d = getDistance(point, pt);
      if (d <= allowedDist && d < dc.dist) {
        dc.dist = d;
        dc.pt = point;
        dc.obj = tobj;
        dc.contains = tobj.isPointInside(this.view_.toDoc(pt));
      }
    }
  }

  private apply(path: SimplePath, dc1: DistCheck, dc2: DistCheck): boolean {
    const front = path.front();
    const back = path.back();
    const p1 = front.segment.point1();
    const p2 = back.segment.point2();
    const endPtDist = getDistance(p1, p2);
    if (dc1.obj !== dc2.obj) {
      if (dc1.obj !== null && !dc1.contains) return false;
      if (dc2.obj !== null && !dc2.contains) return false;
    }
    const allowed = (a: Point, b: Point): boolean => {
      const d = getDistance(a, b);
      return !(d < 1.0 || d < endPtDist * 0.5 || d > endPtDist * 1.4);
    };
    if (path.size === 1 && !allowed(dc1.pt, dc2.pt)) {
      if (dc1.dist < dc2.dist && allowed(dc1.pt, p2)) {
        front.setFirstPoint(dc1.pt);
        return true;
      }
      if (dc1.dist > dc2.dist && allowed(p1, dc2.pt)) {
        back.setLastPoint(dc2.pt);
        return true;
      }
      return false;
    }
    front.setFirstPoint(dc1.pt);
    back.setLastPoint(dc2.pt);
    return true;
  }
}
