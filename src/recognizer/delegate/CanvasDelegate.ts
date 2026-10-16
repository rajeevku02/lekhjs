// The recognizer's only view of the scene (port of C++ `recognizer::CanvasDelegate`, spec 07 §6.7):
// 16 queries, `placePath`, and 7 mutations. Everything is in VIEW coordinates, as the recognizer's
// points are. C++ `void*` handles are `ObjectId`s; the C++ out-parameters are return values.
//
// Dropped: the dead `getExistingShapes(GetExistingShapesArg, …)` overload and `ExistingShape2`, and
// the `newObj`/`newObjs` outputs of `convert`/`addShapes` (only the commented-out `ShapeMatcher`
// read them, `Recognizer.cpp:106-110`).
//
// The algorithm folders import this file with `import type` only: it declares types and the
// small value types the queries return, no behaviour.
import { Point, SimplePath, type GeoShape, type LineSegment, type Rect } from '../../geometry';
import type { ObjectId } from './RecMutation';

export type { ObjectId } from './RecMutation';

/** C++ `ExistingShapeType`. */
export const ExistingShapeType = Object.freeze({ Path: 0, Ellipse: 1, Rectangle: 2, Shape: 3 } as const);
export type ExistingShapeType = (typeof ExistingShapeType)[keyof typeof ExistingShapeType];

/** C++ `FetchShapeType`. */
export const FetchShapeType = Object.freeze({ Line: 0, Curve: 1, Path: 2, Ellipse: 3, Rectangle: 4, All: 5 } as const);
export type FetchShapeType = (typeof FetchShapeType)[keyof typeof FetchShapeType];

/** C++ `ExistingShape`: an existing object near the stroke, with the working fields its users set. */
export class ExistingShape {
  type: ExistingShapeType = ExistingShapeType.Path;
  path: SimplePath = new SimplePath();
  object: ObjectId | null = null;
  /** C++ `INT_MAX` until a user measures it. */
  dist = 2147483647;
  strokeWidth = 0;
  at: Point = new Point();
  endPoint: Point = new Point();
  side = 0;
  trimExisting = 0;
  trimNew = 0;

  trim(): number {
    return this.trimExisting + this.trimNew;
  }
}

/** C++ `ParamMap`: one connection parameter set (C++ `std::map<std::string, number_t>`). */
export type ParamMap = Record<string, number>;
export type Params = ParamMap[];

/** C++ `ConnectionDetail`. Params are in canvas units (the recognizer divides by the zoom). */
export interface ConnectionDetail {
  obj1: ObjectId | null;
  obj2: ObjectId | null;
  params: Params;
  type: number;
  autoType: number;
  val: number;
}

/** C++ `ObjectForConnection`. */
export interface ObjectForConnection {
  readonly object: ObjectId;
  readonly center: Point;
  readonly width: number;
  readonly height: number;
}

/** C++ `DoubleLineArrowParam`. */
export interface DoubleLineArrowParam {
  readonly obj1: ObjectId;
  readonly obj2: ObjectId;
  readonly seg1: LineSegment;
  readonly seg2: LineSegment;
  readonly center: Point;
  readonly lineDist: number;
  readonly len: number;
  readonly firstSide: boolean;
}

/** C++ `ArrowObjectInfo::ArrowPoint`. */
export interface ArrowPoint {
  readonly p1: Point;
  readonly p2: Point;
  readonly hasArrow: boolean;
}

/** C++ `ArrowObjectInfo`. */
export interface ArrowObjectInfo {
  readonly obj: ObjectId;
  readonly strokeWidth: number;
  readonly isSingleCurve: boolean;
  readonly points: readonly ArrowPoint[];
}

/** C++ `ArrowOperationInfo`. */
export interface ArrowOperationInfo {
  readonly obj: ObjectId;
  readonly at: Point;
  readonly add: boolean;
  readonly solid: boolean;
}

/**
 * The scene as the recognizer sees it. Queries never run after a mutation in the same pass
 * (research 08 §4.2), so a recording implementation is exact.
 */
export interface CanvasDelegate {
  // ---- queries (1-16)
  /** 1. Open two-vertex polygon objects with an endpoint in one of `around` (C++ `getLines`). */
  getExistingShapes(around: readonly Rect[], ft: FetchShapeType, excludes: ReadonlySet<ObjectId>): ExistingShape[];
  /** 2. Paths whose selection rect, inflated by 36, meets `seg`. */
  getPathsNear(seg: LineSegment): ExistingShape[];
  /** 3. The objects at both ends of a connector stroke (empty unless two distinct objects). */
  getShapesForConnection(p1: Point, p2: Point, excludes: ReadonlySet<ObjectId>): ObjectForConnection[];
  /** 4. Whether an auto connection of `autoType` already joins the two objects. */
  isAutoConnectionPresent(obj1: ObjectId, obj2: ObjectId, autoType: number): boolean;
  /** 5. Every arrow-capable object's ends. */
  getArrowObjects(): ArrowObjectInfo[];
  /** 6. Where `seg` crosses the object's outline. */
  getIntersections(obj: ObjectId, seg: LineSegment): Point[];
  /** 7. */
  currentStrokeWidth(): number;
  /** 8. The view zoom (1 = 100 %). */
  getZoom(): number;
  /** 9. The one connectable object both points resolve to (body only), else null. */
  getShapeForSelfLoop(p1: Point, p2: Point): ObjectId | null;
  /** 10. Distance from `p` to the object's outline (body). */
  distanceToOutline(obj: ObjectId, p: Point): number;
  /** 11. */
  isInsideShape(obj: ObjectId, p: Point): boolean;
  /** 12. The nearest point of the object's outline. */
  projectToOutline(obj: ObjectId, p: Point): Point;
  /** 13. */
  isInsideTitle(obj: ObjectId, p: Point): boolean;
  /** 14. `p` inside the body of any object other than `obj`, a container's inner area excepted. */
  isInsideOtherObject(obj: ObjectId, p: Point): boolean;
  /** 15. The centre connection-end angles are measured from. */
  shapeCentre(obj: ObjectId): Point;
  /** 16. The selection rectangle. */
  shapeBounds(obj: ObjectId): Rect;
  /** Snaps the path's ends onto nearby outlines (rewrites `path`); true when it moved an end. */
  placePath(path: SimplePath): boolean;

  // ---- mutations (17-23)
  convert(objects: readonly ObjectId[], shape: GeoShape): void;
  addShapes(shapes: readonly GeoShape[]): void;
  deleteShapes(objects: readonly ObjectId[]): void;
  addConnection(detail: ConnectionDetail, deleted: ReadonlySet<ObjectId>): void;
  addDoubleLineArrow(param: DoubleLineArrowParam): void;
  changeArrow(info: ArrowOperationInfo): void;
  addUnrecognizedShape(points: readonly Point[]): void;
}
