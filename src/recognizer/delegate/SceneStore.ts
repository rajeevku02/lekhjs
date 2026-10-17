// The worker's throw-away scene store, as a PORT (spec 07 §6.7): what `SnapshotCanvasDelegate` needs
// from the objects of a `SceneSnapshot`. Everything here is in CANVAS coordinates; the delegate maps
// the recognizer's view coordinates in and out with the job's `RecViewTransform`.
//
// Task R3 implements it over the real lekhjs `ObjectStore` built from a `SceneSnapshot` (the same
// model, template and hit-test code as the main thread); tests implement it over plain geometry
// (`test/recognizer/support/geoScene.ts`). Each method names the C++ function it stands for. An
// unknown id is the implementation's error to raise (the C++ casts the `void*` and dereferences it).
import type { LineEquation, Point, PointAndSlope, Rect, SimplePath } from '../../geometry';
import type { ObjectId } from './RecMutation';

/**
 * The view transform of a job (spec 07 §6.2 `JobMsg.view`, named `ViewTransform` there): view =
 * canvas × zoom + (tx, ty), so tx/ty are VIEW px. Renamed from the spec's name because
 * `render/ViewTransform` (the engine's zoom + scroll class) is a different type: its scroll is in
 * canvas units, `view = (canvas + scroll) × zoom`, so `tx = scrollX × zoom`, `ty = scrollY × zoom`
 * (C++ `LekhGlobal` zoom and scroll, likewise). `recViewOf` converts.
 */
export interface RecViewTransform {
  readonly zoom: number;
  readonly tx: number;
  readonly ty: number;
}

/** One end of an arrow-capable object (C++ `IArrowObject::getArrowPoints` pair + `hasArrowAt`). */
export interface SceneArrowEnd {
  /** The end itself. */
  readonly p1: Point;
  /** The neighbouring point the end is reached from. */
  readonly p2: Point;
  readonly hasArrow: boolean;
}

/** An arrow-capable object (C++ `IArrowObject`; spec 07 §6.2 `SnapshotArrow`). */
export interface SceneArrowObject {
  readonly id: ObjectId;
  /** `getDrawingProfile()->effectiveStrokeWidth()`, canvas units. */
  readonly strokeWidth: number;
  /** A `TemplatedObject` whose template is a `BezierCurveTemplate`. */
  readonly isSingleCurve: boolean;
  readonly ends: readonly SceneArrowEnd[];
}

/** A connection between two objects (spec 07 §6.2 `SnapshotConnection`). */
export interface SceneConnection {
  readonly firstId: ObjectId;
  readonly secondId: ObjectId;
  /** C++ `ConnectionObject::getType()` as an int. */
  readonly type: number;
  /** C++ `ConnectionObject::getAutoType()` as an int. */
  readonly autoType: number;
}

export interface SceneStore {
  /** C++ `ObjectStore::getObjects()`: every top-level object's id (connections too), in store order. */
  objectIds(): readonly ObjectId[];

  // ---- kind flags (C++ casts and `isHelperObject`)
  /** `LekhObject::isHelperObject()`. */
  isHelper(id: ObjectId): boolean;
  /** `dynamic_cast<ConnectionObject*>`. Connections are also listed by `connections()`. */
  isConnector(id: ObjectId): boolean;
  /** `is_instance_of<UnrecognizedObject>` (ink). */
  isUnrecognized(id: ObjectId): boolean;
  /** `dynamic_cast<TemplatedObject*>` (`LekhCanvasDelegate::getIntersections` answers only those). */
  isTemplated(id: ObjectId): boolean;
  /** `ObjectStore::isConnectable`: a connectable kind and not a group or multi-selection. */
  isConnectable(id: ObjectId): boolean;

  // ---- the ObjectStore searches
  /**
   * `ObjectStore::getObjectForConnection(pt, excludes)`: groups flattened; skipping excluded,
   * non-connectable-kind objects and those whose selection rect inflated by `4 × allowedGap` does
   * not contain `pt`; the object containing `pt` nearest its outline (store order breaks ties),
   * else the nearest outline within `allowedGap`. C++ computes `allowedGap` as
   * `connectObjectDistThreshold / zoom`; the delegate passes it in.
   */
  getObjectForConnection(pt: Point, allowedGap: number, excludes: ReadonlySet<ObjectId>): ObjectId | null;
  /**
   * `ObjectStore::isInsideOtherObject(pt, except)`: `pt` inside the body of a connectable-kind
   * object (groups flattened) other than `except`, a container's inner area excepted.
   */
  isInsideOtherObject(pt: Point, except: ObjectId): boolean;

  // ---- per-object geometry (LekhObject virtuals)
  /** `getSelectionRectangle()`. */
  selectionRect(id: ObjectId): Rect;
  /** `getCenter()`. */
  center(id: ObjectId): Point;
  /** `ConnectionObject::connectionCentre(obj)`: the centre connection-end angles are measured from. */
  connectionCentre(id: ObjectId): Point;
  /** `getDistanceFrom(pt, Rectangle())`: distance to the outline (inside points too). */
  distanceFrom(id: ObjectId, pt: Point): number;
  /** `isPointInside(pt) != 0`. */
  isPointInside(id: ObjectId, pt: Point): boolean;
  /** `isPointInsideTitle(pt)` (from the snapshot's precomputed `titleRect`; never measures text). */
  isPointInsideTitle(id: ObjectId, pt: Point): boolean;
  /** `getIntersection(LineEquation)`: where the infinite line crosses the outline. */
  intersection(id: ObjectId, eq: LineEquation): PointAndSlope[];
  /** `getDrawingProfile()->effectiveStrokeWidth()`, canvas units. */
  strokeWidth(id: ObjectId): number;
  /**
   * `LekhCanvasDelegate::getLines`' filter: for a `TemplatedObject` whose template is an OPEN
   * `PolygonTemplate` with exactly two vertices, `PolygonTemplate::vertices(ds)`; else null.
   */
  openLineVertices(id: ObjectId): readonly [Point, Point] | null;
  /**
   * The outline as `PathCaptureDrawingPlatform` captures it from `draw()`: the single captured
   * path, or null when the capture is complex or holds other than one shape.
   */
  capturedPath(id: ObjectId): SimplePath | null;

  // ---- scene-level lists
  /** Every `IArrowObject` in store order (spec 07 §6.2 `scene.arrowEnds`). */
  arrowObjects(): readonly SceneArrowObject[];
  /** Every connection in store order (spec 07 §6.2 `scene.connections`). */
  connections(): readonly SceneConnection[];

  /**
   * `PathPlacement::place(path)` (C++ `LekhCanvasDelegate::placePath`): snaps the VIEW path's ends
   * onto nearby outlines, rewriting `path` in place; true when it moved an end. PathPlacement maps
   * view to canvas itself, hence `view`. Absent until PathPlacement is ported: the delegate then
   * answers false.
   */
  placePath?(path: SimplePath, view: RecViewTransform): boolean;
}
