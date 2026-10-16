// The query half of `CanvasDelegate` over a `SceneStore` (spec 07 §6.7): the worker-side port of the
// query methods of C++ `lekh/LekhCanvasDelegate.cpp`. The recognizer speaks VIEW coordinates and the
// store CANVAS coordinates; points are mapped in with `toCanvas` (C++ `LekhUtil::mapPoint`) and out
// with `toView` (`mapPointR`), distances scaled by the zoom where C++ scales them. Mutations are not
// here: `snapshotDelegate` pairs this with `RecordingCanvasDelegate`, which records them.
import {
  ExistingShape,
  ExistingShapeType,
  FetchShapeType,
  type ArrowObjectInfo,
  type ObjectForConnection,
} from './CanvasDelegate';
import {
  getDistance,
  LineEquation,
  LineSegment,
  PathComponent,
  Point,
  Rect,
  rectDistanceFrom,
  rectIntersects,
  SimplePath,
} from '../../geometry';
import { INT_MAX } from '../../base';
import type { RecognizerConfig } from '../core/RecognizerConfig';
import { at } from '../lines/RecognizerUtil';
import type { ObjectId } from './RecMutation';
import { RecordingCanvasDelegate, type SceneQueries } from './RecordingCanvasDelegate';
import type { SceneStore, ViewTransform } from './SceneStore';

/** View → canvas (C++ `LekhUtil::mapPoint`: `view / zoom - scroll`). */
export function toCanvas(view: ViewTransform, p: Point): Point {
  return new Point((p.x - view.tx) / view.zoom, (p.y - view.ty) / view.zoom);
}

/** Canvas → view (C++ `LekhUtil::mapPointR`: `(canvas + scroll) × zoom`). */
export function toView(view: ViewTransform, p: Point): Point {
  return new Point(p.x * view.zoom + view.tx, p.y * view.zoom + view.ty);
}

/** Canvas → view for a rect (C++ `LekhUtil::mapRectR`). */
export function rectToView(view: ViewTransform, r: Rect): Rect {
  return new Rect(r.x * view.zoom + view.tx, r.y * view.zoom + view.ty, r.width * view.zoom, r.height * view.zoom);
}

/** Canvas → view for a path (C++ `LekhUtil::mapPathR`). */
export function pathToView(view: ViewTransform, path: SimplePath): SimplePath {
  const out = new SimplePath();
  out.setClosed(path.closed());
  for (const pc of path.components) {
    const c = pc.clone();
    if (c.isCurve) {
      c.curve.point1 = toView(view, c.curve.point1);
      c.curve.point2 = toView(view, c.curve.point2);
      c.curve.point3 = toView(view, c.curve.point3);
      c.curve.point4 = toView(view, c.curve.point4);
    } else {
      c.segment = new LineSegment(toView(view, c.segment.p1), toView(view, c.segment.p2));
    }
    out.push(c);
  }
  return out;
}

export interface SnapshotCanvasDelegateInit {
  readonly store: SceneStore;
  /** The job's view transform (`JobMsg.view`). */
  readonly view: ViewTransform;
  /** `JobMsg.strokeWidth` (C++ `currentStrokeWidth()`). */
  readonly strokeWidth: number;
  /** The job's config: `connectObjectDistThreshold` and `multiStrokePathJoinDist` are read here. */
  readonly config: RecognizerConfig;
}

export class SnapshotCanvasDelegate implements SceneQueries {
  private readonly store: SceneStore;
  private readonly view: ViewTransform;
  private readonly strokeWidth: number;
  private readonly config: RecognizerConfig;

  constructor(init: SnapshotCanvasDelegateInit) {
    this.store = init.store;
    this.view = init.view;
    this.strokeWidth = init.strokeWidth;
    this.config = init.config;
  }

  // ---- 1. getExistingShapes (`:96-101`, `getLines` `:427-464`)
  getExistingShapes(around: readonly Rect[], ft: FetchShapeType, excludes: ReadonlySet<ObjectId>): ExistingShape[] {
    const result: ExistingShape[] = [];
    if (ft !== FetchShapeType.Line) return result;
    const ids = this.store.objectIds();
    // C++ loops rects outside objects: an object near two rects is listed twice, as there.
    for (const rect of around) {
      for (const id of ids) {
        if (excludes.has(id)) continue;
        const vertices = this.store.openLineVertices(id);
        if (vertices === null) continue;
        const v0 = toView(this.view, vertices[0]);
        const v1 = toView(this.view, vertices[1]);
        if (rect.contains(v0) || rect.contains(v1)) {
          const es = new ExistingShape();
          es.object = id;
          es.path.push(PathComponent.line(v0, v1));
          es.type = ExistingShapeType.Path;
          result.push(es);
        }
      }
    }
    return result;
  }

  // ---- 2. getPathsNear (`:103-190`)
  getPathsNear(seg: LineSegment): ExistingShape[] {
    const p1 = seg.point1();
    const p2 = seg.point2();
    const segRect = Rect.fromCenter(p1, 1, 1).include(p2);
    const closedEndPointDist = 4;
    const visitedPaths: { path: SimplePath; object: ObjectId }[] = [];
    const tmpResult: ExistingShape[] = [];
    const gap = this.config.multiStrokePathJoinDist;

    for (const id of this.store.objectIds()) {
      if (this.store.isHelper(id) || this.store.isConnector(id) || this.store.isUnrecognized(id)) continue;
      const srect = rectToView(this.view, this.store.selectionRect(id)).inflate(gap * 2);
      if (!rectIntersects(srect, segRect) && !srect.contains(p1)) continue;
      const captured = this.store.capturedPath(id);
      if (captured === null) continue;
      const path = pathToView(this.view, captured);
      if (path.size === 0) continue;
      visitedPaths.push({ path, object: id });

      if (getDistance(path.front().firstPoint(), path.back().lastPoint()) < closedEndPointDist) continue; // closed

      const firstSeg = at(path.front().lines(), 0);
      const lastLines = path.back().lines();
      const lastSeg = at(lastLines, lastLines.length - 1).reversed();
      const join1 = LineSegment.tryJoin(firstSeg, seg);
      const join2 = LineSegment.tryJoin(lastSeg, seg);
      const maxDist = gap;
      const add = (join: typeof join1, side: number, endPt: Point): void => {
        const es = new ExistingShape();
        es.side = side;
        es.dist = join.dist;
        es.trimExisting = join.trim1;
        es.trimNew = join.trim2;
        es.object = id;
        es.path = path;
        es.at = join.at;
        es.endPoint = endPt;
        // Canvas units, not × zoom: as C++.
        es.strokeWidth = this.store.strokeWidth(id);
        tmpResult.push(es);
      };
      if (join1.dist < maxDist) add(join1, 0, firstSeg.point1());
      if (join2.dist < maxDist) add(join2, 1, lastSeg.point1());
    }
    return tmpResult.filter((es) => !filterOutShape(visitedPaths, es));
  }

  // ---- 3. getShapesForConnection (`:219-254`)
  getShapesForConnection(p1: Point, p2: Point, excludes: ReadonlySet<ObjectId>): ObjectForConnection[] {
    const point1 = toCanvas(this.view, p1);
    const point2 = toCanvas(this.view, p2);
    const gap = this.allowedGap();
    const obj1 = this.store.getObjectForConnection(point1, gap, excludes);
    const obj2 = this.store.getObjectForConnection(point2, gap, excludes);
    if (obj1 === null || obj2 === null || obj1 === obj2) return [];
    const rect1 = this.store.selectionRect(obj1);
    const rect2 = this.store.selectionRect(obj2);
    if (rect1.contains(point1) && rect1.contains(point2)) return [];
    if (rect2.contains(point1) && rect2.contains(point2)) return [];
    const zm = this.view.zoom;
    const ofc = (obj: ObjectId, rect: Rect): ObjectForConnection => ({
      object: obj,
      center: toView(this.view, this.store.center(obj)),
      width: rect.width * zm,
      height: rect.height * zm,
    });
    return [ofc(obj1, rect1), ofc(obj2, rect2)];
  }

  // ---- 4. isAutoConnectionPresent (`:309-341`)
  isAutoConnectionPresent(obj1: ObjectId, obj2: ObjectId, autoType: number): boolean {
    for (const con of this.store.connections()) {
      const conType = con.autoType;
      if (con.firstId === obj1 && con.secondId === obj2 && conType === autoType) return true;
      if (con.firstId === obj2 && con.secondId === obj1) {
        if (conType === 2) {
          if (autoType === 3) return true;
        } else if (conType === 3) {
          if (autoType === 2) return true;
        } else if (conType === autoType) {
          return true;
        }
      }
    }
    return false;
  }

  // ---- 5. getArrowObjects (`:517-548`)
  getArrowObjects(): ArrowObjectInfo[] {
    const zoom = this.view.zoom;
    // C++ hands out the `IArrowObject*` (a different pointer from the `LekhObject*`, the
    // ArrowRecognizer comment at `:32-38`); here both are the one object id.
    return this.store.arrowObjects().map((a) => ({
      obj: a.id,
      strokeWidth: a.strokeWidth * zoom,
      isSingleCurve: a.isSingleCurve,
      points: a.ends.map((e) => ({ p1: toView(this.view, e.p1), p2: toView(this.view, e.p2), hasArrow: e.hasArrow })),
    }));
  }

  // ---- 6. getIntersections (`:688-706`)
  getIntersections(obj: ObjectId, seg: LineSegment): Point[] {
    if (!this.store.isTemplated(obj)) return [];
    // C++ intersects the VIEW segment with the CANVAS outline (no mapPoint): right only at zoom 1
    // and scroll 0. Here the segment is mapped to canvas and the crossings back to view.
    const cseg = new LineSegment(toCanvas(this.view, seg.point1()), toCanvas(this.view, seg.point2()));
    const eq = LineEquation.through(cseg.point1(), cseg.point2());
    const pts: Point[] = [];
    for (const ps of this.store.intersection(obj, eq)) {
      if (cseg.containsEqPoint(ps.point)) pts.push(ps.point);
    }
    const from = cseg.point1();
    // C++ std::sort by distance from point1; ties (unspecified order there) broken by x, then y.
    pts.sort((a, b) => getDistance(from, a) - getDistance(from, b) || a.x - b.x || a.y - b.y);
    return pts.map((p) => toView(this.view, p));
  }

  // ---- 7, 8
  currentStrokeWidth(): number {
    return this.strokeWidth;
  }
  getZoom(): number {
    return this.view.zoom;
  }

  // ---- 9. getShapeForSelfLoop (`:606-616`)
  getShapeForSelfLoop(p1: Point, p2: Point): ObjectId | null {
    const none: ReadonlySet<ObjectId> = new Set();
    const gap = this.allowedGap();
    const obj1 = this.store.getObjectForConnection(toCanvas(this.view, p1), gap, none);
    const obj2 = this.store.getObjectForConnection(toCanvas(this.view, p2), gap, none);
    if (obj1 === null || obj1 !== obj2 || !this.store.isConnectable(obj1)) return null;
    return obj1;
  }

  // ---- 10-16 (`:618-685`)
  distanceToOutline(obj: ObjectId, p: Point): number {
    return this.store.distanceFrom(obj, toCanvas(this.view, p)) * this.view.zoom;
  }
  isInsideShape(obj: ObjectId, p: Point): boolean {
    return this.store.isPointInside(obj, toCanvas(this.view, p));
  }
  projectToOutline(obj: ObjectId, p: Point): Point {
    // The nearest of the outline's crossings with lines through p: coarse round the half turn,
    // then refined round the best direction.
    const q = toCanvas(this.view, p);
    let best = new Point();
    let bestDist = -1;
    let bestAngle = 0;
    const probe = (angle: number): void => {
      const eq = LineEquation.through(q, new Point(q.x + Math.cos(angle) * 100, q.y + Math.sin(angle) * 100));
      for (const ps of this.store.intersection(obj, eq)) {
        const d = getDistance(ps.point, q);
        if (bestDist < 0 || d < bestDist) {
          bestDist = d;
          best = ps.point;
          bestAngle = angle;
        }
      }
    };
    const coarse = 36;
    for (let i = 0; i < coarse; i++) probe((Math.PI * i) / coarse);
    if (bestDist >= 0) {
      const centre = bestAngle;
      const step = Math.PI / coarse;
      for (let i = -10; i <= 10; i++) probe(centre + (step * i) / 10);
    } else {
      // no outline crossing (an outline not yet drawn): the selection rectangle
      best = rectDistanceFrom(this.store.selectionRect(obj), q).near;
    }
    return toView(this.view, best);
  }
  isInsideTitle(obj: ObjectId, p: Point): boolean {
    return this.store.isPointInsideTitle(obj, toCanvas(this.view, p));
  }
  isInsideOtherObject(obj: ObjectId, p: Point): boolean {
    return this.store.isInsideOtherObject(toCanvas(this.view, p), obj);
  }
  shapeCentre(obj: ObjectId): Point {
    return toView(this.view, this.store.connectionCentre(obj));
  }
  shapeBounds(obj: ObjectId): Rect {
    return rectToView(this.view, this.store.selectionRect(obj));
  }

  // ---- placePath (`:590-595`)
  placePath(path: SimplePath): boolean {
    return this.store.placePath?.(path, this.view) ?? false;
  }

  /** C++ `ObjectStore::getObjectForConnection`'s `connectObjectDistThreshold / zoom`. */
  private allowedGap(): number {
    return this.config.connectObjectDistThreshold / this.view.zoom;
  }
}

/** C++ `LekhCanvasDelegate::filterOutShape` (`:192-217`): another path is nearer the end than the join. */
function filterOutShape(paths: readonly { path: SimplePath; object: ObjectId }[], es: ExistingShape): boolean {
  for (const pair of paths) {
    if (pair.object === es.object) continue;
    let dist = INT_MAX;
    for (const pc of pair.path.components) {
      if (!pc.isCurve) {
        const tdist = pc.segment.getDistanceFrom(es.endPoint).dist;
        if (tdist < dist) dist = tdist;
      }
    }
    if (dist < getDistance(es.endPoint, es.at)) return true;
  }
  return false;
}

/** The worker's delegate for one job: the snapshot queries, with the mutations recorded. */
export function snapshotDelegate(init: SnapshotCanvasDelegateInit): RecordingCanvasDelegate {
  return new RecordingCanvasDelegate(new SnapshotCanvasDelegate(init));
}
