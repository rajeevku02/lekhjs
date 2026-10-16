// Wraps a query-only scene and records the recognizer's mutations as `RecMutation`s (spec 07 §6.2,
// §6.7 rows 17-23) instead of performing them. Queries pass straight through. Recording is exact
// because no query runs after a mutation in the same pass (research 08 §4.2).
import { GeoShapeType, type GeoShape, type LineSegment, type Point, type Rect, type SimplePath } from '../../geometry';
import type {
  ArrowObjectInfo,
  ArrowOperationInfo,
  CanvasDelegate,
  ConnectionDetail,
  DoubleLineArrowParam,
  ExistingShape,
  FetchShapeType,
  ObjectForConnection,
} from './CanvasDelegate';
import { RecInternalError } from '../lines/RecognizerUtil';
import type { ObjectId, Pt, RecMutation, RecPathComponent, RecShapeDTO } from './RecMutation';

/** The query half of `CanvasDelegate`. */
export type SceneQueries = Omit<
  CanvasDelegate,
  | 'convert'
  | 'addShapes'
  | 'deleteShapes'
  | 'addConnection'
  | 'addDoubleLineArrow'
  | 'changeArrow'
  | 'addUnrecognizedShape'
>;

function pt(p: Point): Pt {
  return { x: p.x, y: p.y };
}

/** A recognised `GeoShape` as plain data (view coordinates, as recognised). */
export function shapeToDTO(shape: GeoShape): RecShapeDTO {
  if (shape.type() === GeoShapeType.Ellipse) {
    const e = shape.ellipse();
    return {
      kind: 'ellipse',
      center: pt(e.center),
      width: e.width,
      height: e.height,
      rotation: e.rotation,
      snap: shape.snap(),
    };
  }
  const path = shape.path();
  const components: RecPathComponent[] = path.components.map((pc) =>
    pc.isCurve
      ? {
          curve: true,
          p1: pt(pc.curve.point1),
          c1: pt(pc.curve.point2),
          c2: pt(pc.curve.point3),
          p2: pt(pc.curve.point4),
        }
      : { curve: false, p1: pt(pc.segment.point1()), p2: pt(pc.segment.point2()) },
  );
  return { kind: 'path', closed: path.closed(), components, snap: shape.snap() };
}

/** Points as the `ink` mutation's flat `x0,y0,x1,y1,…` run. */
export function flattenPoints(points: readonly Point[]): Float64Array {
  const out = new Float64Array(points.length * 2);
  points.forEach((p, i) => {
    out[2 * i] = p.x;
    out[2 * i + 1] = p.y;
  });
  return out;
}

export class RecordingCanvasDelegate implements CanvasDelegate {
  private readonly scene: SceneQueries;
  private readonly recorded: RecMutation[] = [];

  constructor(scene: SceneQueries) {
    this.scene = scene;
  }

  /** The mutations recorded so far, in call order. */
  mutations(): readonly RecMutation[] {
    return this.recorded;
  }

  // ---- queries
  getExistingShapes(around: readonly Rect[], ft: FetchShapeType, excludes: ReadonlySet<ObjectId>): ExistingShape[] {
    return this.scene.getExistingShapes(around, ft, excludes);
  }
  getPathsNear(seg: LineSegment): ExistingShape[] {
    return this.scene.getPathsNear(seg);
  }
  getShapesForConnection(p1: Point, p2: Point, excludes: ReadonlySet<ObjectId>): ObjectForConnection[] {
    return this.scene.getShapesForConnection(p1, p2, excludes);
  }
  isAutoConnectionPresent(obj1: ObjectId, obj2: ObjectId, autoType: number): boolean {
    return this.scene.isAutoConnectionPresent(obj1, obj2, autoType);
  }
  getArrowObjects(): ArrowObjectInfo[] {
    return this.scene.getArrowObjects();
  }
  getIntersections(obj: ObjectId, seg: LineSegment): Point[] {
    return this.scene.getIntersections(obj, seg);
  }
  currentStrokeWidth(): number {
    return this.scene.currentStrokeWidth();
  }
  getZoom(): number {
    return this.scene.getZoom();
  }
  getShapeForSelfLoop(p1: Point, p2: Point): ObjectId | null {
    return this.scene.getShapeForSelfLoop(p1, p2);
  }
  distanceToOutline(obj: ObjectId, p: Point): number {
    return this.scene.distanceToOutline(obj, p);
  }
  isInsideShape(obj: ObjectId, p: Point): boolean {
    return this.scene.isInsideShape(obj, p);
  }
  projectToOutline(obj: ObjectId, p: Point): Point {
    return this.scene.projectToOutline(obj, p);
  }
  isInsideTitle(obj: ObjectId, p: Point): boolean {
    return this.scene.isInsideTitle(obj, p);
  }
  isInsideOtherObject(obj: ObjectId, p: Point): boolean {
    return this.scene.isInsideOtherObject(obj, p);
  }
  shapeCentre(obj: ObjectId): Point {
    return this.scene.shapeCentre(obj);
  }
  shapeBounds(obj: ObjectId): Rect {
    return this.scene.shapeBounds(obj);
  }
  placePath(path: SimplePath): boolean {
    return this.scene.placePath(path);
  }

  // ---- mutations, recorded
  convert(objects: readonly ObjectId[], shape: GeoShape): void {
    this.recorded.push({ op: 'convert', deleteIds: [...objects], shape: shapeToDTO(shape) });
  }
  addShapes(shapes: readonly GeoShape[]): void {
    this.recorded.push({ op: 'add', shapes: shapes.map(shapeToDTO) });
  }
  deleteShapes(objects: readonly ObjectId[]): void {
    this.recorded.push({ op: 'delete', ids: [...objects] });
  }
  addConnection(detail: ConnectionDetail, deleted: ReadonlySet<ObjectId>): void {
    // C++ dereferences both ends (`LekhCanvasDelegate.cpp:345-346`); a null end is a recognizer bug.
    if (detail.obj1 === null || detail.obj2 === null) throw new RecInternalError('addConnection with a null end');
    this.recorded.push({
      op: 'connect',
      obj1Id: detail.obj1,
      obj2Id: detail.obj2,
      type: detail.type,
      autoType: detail.autoType,
      params: detail.params.map((pm) => ({ ...pm })),
      val: detail.val,
      deletedIds: [...deleted],
    });
  }
  addDoubleLineArrow(param: DoubleLineArrowParam): void {
    this.recorded.push({
      op: 'doubleLineArrow',
      obj1Id: param.obj1,
      obj2Id: param.obj2,
      seg1: { p1: pt(param.seg1.point1()), p2: pt(param.seg1.point2()) },
      seg2: { p1: pt(param.seg2.point1()), p2: pt(param.seg2.point2()) },
      center: pt(param.center),
      lineDist: param.lineDist,
      len: param.len,
      firstSide: param.firstSide,
    });
  }
  changeArrow(info: ArrowOperationInfo): void {
    this.recorded.push({ op: 'arrow', objId: info.obj, at: pt(info.at), add: info.add, solid: info.solid });
  }
  addUnrecognizedShape(points: readonly Point[]): void {
    this.recorded.push({ op: 'ink', points: flattenPoints(points) });
  }
}
