// A delegate that answers queries from `base` and holds its mutations back until `flush()`.
// `Recognizer` runs the specialists over an EXTENDED path through it, so the deletion of the
// paths the stroke extended can be emitted first (AC-REC-15: a result is at most `delete` then
// one other mutation). C++ emitted the specialist's mutation first and the deletion after; the
// final board is the same either way (the specialist excludes the extended objects).
import type { GeoShape, LineSegment, Point, Rect, SimplePath } from '../../geometry';
import type {
  ArrowObjectInfo,
  ArrowOperationInfo,
  CanvasDelegate,
  ConnectionDetail,
  DoubleLineArrowParam,
  ExistingShape,
  FetchShapeType,
  ObjectForConnection,
} from '../delegate/CanvasDelegate';
import type { ObjectId } from '../delegate/RecMutation';

export class DeferringCanvasDelegate implements CanvasDelegate {
  private readonly base: CanvasDelegate;
  private readonly held: ((d: CanvasDelegate) => void)[] = [];

  constructor(base: CanvasDelegate) {
    this.base = base;
  }

  /** Mutations held back. */
  get pending(): number {
    return this.held.length;
  }

  /** Replays the held mutations on the base delegate, in call order. */
  flush(): void {
    for (const m of this.held.splice(0)) m(this.base);
  }

  getExistingShapes(around: readonly Rect[], ft: FetchShapeType, excludes: ReadonlySet<ObjectId>): ExistingShape[] {
    return this.base.getExistingShapes(around, ft, excludes);
  }
  getPathsNear(seg: LineSegment): ExistingShape[] {
    return this.base.getPathsNear(seg);
  }
  getShapesForConnection(p1: Point, p2: Point, excludes: ReadonlySet<ObjectId>): ObjectForConnection[] {
    return this.base.getShapesForConnection(p1, p2, excludes);
  }
  isAutoConnectionPresent(obj1: ObjectId, obj2: ObjectId, autoType: number): boolean {
    return this.base.isAutoConnectionPresent(obj1, obj2, autoType);
  }
  getArrowObjects(): ArrowObjectInfo[] {
    return this.base.getArrowObjects();
  }
  getIntersections(obj: ObjectId, seg: LineSegment): Point[] {
    return this.base.getIntersections(obj, seg);
  }
  currentStrokeWidth(): number {
    return this.base.currentStrokeWidth();
  }
  getZoom(): number {
    return this.base.getZoom();
  }
  getShapeForSelfLoop(p1: Point, p2: Point): ObjectId | null {
    return this.base.getShapeForSelfLoop(p1, p2);
  }
  distanceToOutline(obj: ObjectId, p: Point): number {
    return this.base.distanceToOutline(obj, p);
  }
  isInsideShape(obj: ObjectId, p: Point): boolean {
    return this.base.isInsideShape(obj, p);
  }
  projectToOutline(obj: ObjectId, p: Point): Point {
    return this.base.projectToOutline(obj, p);
  }
  isInsideTitle(obj: ObjectId, p: Point): boolean {
    return this.base.isInsideTitle(obj, p);
  }
  isInsideOtherObject(obj: ObjectId, p: Point): boolean {
    return this.base.isInsideOtherObject(obj, p);
  }
  shapeCentre(obj: ObjectId): Point {
    return this.base.shapeCentre(obj);
  }
  shapeBounds(obj: ObjectId): Rect {
    return this.base.shapeBounds(obj);
  }
  placePath(path: SimplePath): boolean {
    return this.base.placePath(path);
  }

  convert(objects: readonly ObjectId[], shape: GeoShape): void {
    this.held.push((d) => {
      d.convert(objects, shape);
    });
  }
  addShapes(shapes: readonly GeoShape[]): void {
    this.held.push((d) => {
      d.addShapes(shapes);
    });
  }
  deleteShapes(objects: readonly ObjectId[]): void {
    this.held.push((d) => {
      d.deleteShapes(objects);
    });
  }
  addConnection(detail: ConnectionDetail, deleted: ReadonlySet<ObjectId>): void {
    this.held.push((d) => {
      d.addConnection(detail, deleted);
    });
  }
  addDoubleLineArrow(param: DoubleLineArrowParam): void {
    this.held.push((d) => {
      d.addDoubleLineArrow(param);
    });
  }
  changeArrow(info: ArrowOperationInfo): void {
    this.held.push((d) => {
      d.changeArrow(info);
    });
  }
  addUnrecognizedShape(points: readonly Point[]): void {
    this.held.push((d) => {
      d.addUnrecognizedShape(points);
    });
  }
}
