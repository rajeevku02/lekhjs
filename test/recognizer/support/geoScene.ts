// A test-only `SceneStore` over plain geometry, standing in for the worker's snapshot store until the
// model exists (task R3). Each object answers the queries the way its C++ counterpart does:
//
//  - `rect`: C++ `TemplatedObject` with the `avabodh.basic.rectangle` template, unrotated. Outline =
//    the rect polygon (`getIntersection` = `GeoUtil::intersectionWithPolygon` of the corners),
//    inside = `Rectangle::contains`, distance = `Rectangle::getDistanceFrom` (nearest edge, inside
//    points too), connectable, centre = connection centre = rect centre, selection rect = the rect,
//    captured outline = one closed four-line path. An optional title rect (canvas coords) stands
//    for the snapshot's `titleRect`.
//  - `line`: an open two-vertex `PolygonTemplate` line (what `getLines` returns), an `IArrowObject`
//    with an end at each vertex; not connectable; never contains a point.
//
// Not modelled: groups, containers (no inner area), rotation, helper/ink objects, path placement.
// The ObjectStore searches (`getObjectForConnection`, `isInsideOtherObject`) are the C++ algorithms
// over these answers, not per-test answers.
import { INT_MAX } from '../../../src/base';
import {
  intersectionWithPolygon,
  LineSegment,
  Point,
  rectDistanceFrom,
  Rect,
  SimplePath,
  type LineEquation,
  type PointAndSlope,
} from '../../../src/geometry';
import type { ObjectId, SceneArrowObject, SceneConnection, SceneStore } from '../../../src/recognizer/delegate';

export interface GeoRect {
  readonly kind: 'rect';
  readonly id: ObjectId;
  readonly rect: Rect;
  readonly title?: Rect;
  readonly strokeWidth?: number;
}

export interface GeoLine {
  readonly kind: 'line';
  readonly id: ObjectId;
  readonly p1: Point;
  readonly p2: Point;
  /** Whether each end (p1, p2) already has an arrowhead. */
  readonly arrows?: readonly [boolean, boolean];
  readonly strokeWidth?: number;
}

export type GeoObject = GeoRect | GeoLine;

/** `avabodh.basic.rectangle` centred at (cx, cy). */
export function geoRect(id: ObjectId, cx: number, cy: number, w: number, h: number, title?: Rect): GeoRect {
  return { kind: 'rect', id, rect: Rect.fromCenter(new Point(cx, cy), w, h), ...(title ? { title } : {}) };
}

export function geoLine(
  id: ObjectId,
  p1: Point,
  p2: Point,
  arrows: readonly [boolean, boolean] = [false, false],
): GeoLine {
  return { kind: 'line', id, p1, p2, arrows };
}

export class GeoScene implements SceneStore {
  private readonly objects: GeoObject[] = [];
  private readonly cons: SceneConnection[] = [];

  constructor(objects: readonly GeoObject[] = []) {
    for (const o of objects) this.add(o);
  }

  add(obj: GeoObject): void {
    this.objects.push(obj);
  }

  remove(id: ObjectId): void {
    const i = this.objects.findIndex((o) => o.id === id);
    if (i >= 0) this.objects.splice(i, 1);
  }

  addConnection(con: SceneConnection): void {
    this.cons.push(con);
  }

  private get(id: ObjectId): GeoObject {
    const o = this.objects.find((x) => x.id === id);
    if (o === undefined) throw new Error(`GeoScene: no object ${id}`);
    return o;
  }

  objectIds(): readonly ObjectId[] {
    return this.objects.map((o) => o.id);
  }

  isHelper(): boolean {
    return false;
  }
  isConnector(): boolean {
    return false;
  }
  isUnrecognized(): boolean {
    return false;
  }
  isTemplated(id: ObjectId): boolean {
    this.get(id);
    return true;
  }
  /** `ObjectStore::isConnectableKind`: an open polygon template is not. */
  private isConnectableKind(id: ObjectId): boolean {
    return this.get(id).kind === 'rect';
  }
  isConnectable(id: ObjectId): boolean {
    return this.isConnectableKind(id);
  }

  getObjectForConnection(pt: Point, allowedGap: number, excludes: ReadonlySet<ObjectId>): ObjectId | null {
    // `ObjectStore::getObjectForConnection` (no groups to flatten here).
    let result: ObjectId | null = null;
    let dist = INT_MAX;
    let insideFound = false;
    for (const o of this.objects) {
      if (excludes.has(o.id) || !this.isConnectableKind(o.id)) continue;
      if (
        !this.selectionRect(o.id)
          .inflate(allowedGap * 4)
          .contains(pt)
      )
        continue;
      if (this.isPointInside(o.id, pt)) {
        const tmpDist = this.distanceFrom(o.id, pt);
        if (tmpDist < dist || !insideFound) {
          result = o.id;
          dist = tmpDist;
          insideFound = true;
        }
      } else if (!insideFound) {
        const tmpDist = this.distanceFrom(o.id, pt);
        if (tmpDist < dist && tmpDist <= allowedGap) {
          result = o.id;
          dist = tmpDist;
        }
      }
    }
    return result;
  }

  isInsideOtherObject(pt: Point, except: ObjectId): boolean {
    // `ObjectStore::isInsideOtherObject`: no containers, so no inner area to except.
    return this.objects.some((o) => o.id !== except && this.isConnectableKind(o.id) && this.isPointInside(o.id, pt));
  }

  selectionRect(id: ObjectId): Rect {
    const o = this.get(id);
    if (o.kind === 'rect') return o.rect;
    return new Rect(o.p1.x, o.p1.y, 0, 0).include(o.p2);
  }
  center(id: ObjectId): Point {
    return this.selectionRect(id).center();
  }
  connectionCentre(id: ObjectId): Point {
    return this.center(id);
  }
  distanceFrom(id: ObjectId, pt: Point): number {
    const o = this.get(id);
    if (o.kind === 'rect') return rectDistanceFrom(o.rect, pt).dist;
    return new LineSegment(o.p1, o.p2).getDistanceFrom(pt).dist;
  }
  isPointInside(id: ObjectId, pt: Point): boolean {
    const o = this.get(id);
    return o.kind === 'rect' && o.rect.contains(pt);
  }
  isPointInsideTitle(id: ObjectId, pt: Point): boolean {
    const o = this.get(id);
    return o.kind === 'rect' && o.title !== undefined && o.title.contains(pt);
  }
  intersection(id: ObjectId, eq: LineEquation): PointAndSlope[] {
    const o = this.get(id);
    if (o.kind === 'rect') return intersectionWithPolygon(o.rect.getPoints(), eq);
    return intersectionWithPolygon([o.p1, o.p2], eq, false);
  }
  strokeWidth(id: ObjectId): number {
    return this.get(id).strokeWidth ?? 2;
  }
  openLineVertices(id: ObjectId): readonly [Point, Point] | null {
    const o = this.get(id);
    return o.kind === 'line' ? [o.p1, o.p2] : null;
  }
  capturedPath(id: ObjectId): SimplePath | null {
    const o = this.get(id);
    const path = new SimplePath();
    if (o.kind === 'line') {
      path.addLine(o.p1, o.p2);
      return path;
    }
    const r = o.rect;
    const pts = [r.topLeft(), r.topRight(), r.bottomRight(), r.bottomLeft(), r.topLeft()];
    for (let i = 1; i < pts.length; i++) path.addLine(pts[i - 1] as Point, pts[i] as Point);
    path.setClosed(true);
    return path;
  }

  arrowObjects(): readonly SceneArrowObject[] {
    const out: SceneArrowObject[] = [];
    for (const o of this.objects) {
      if (o.kind !== 'line') continue;
      const [a1, a2] = o.arrows ?? [false, false];
      out.push({
        id: o.id,
        strokeWidth: o.strokeWidth ?? 2,
        isSingleCurve: false,
        ends: [
          { p1: o.p1, p2: o.p2, hasArrow: a1 },
          { p1: o.p2, p2: o.p1, hasArrow: a2 },
        ],
      });
    }
    return out;
  }

  connections(): readonly SceneConnection[] {
    return this.cons;
  }
}
