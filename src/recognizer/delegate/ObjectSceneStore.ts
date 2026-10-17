// The worker's `SceneStore` over a real lekhjs `ObjectStore` (spec 07 §6.7): the objects of one
// job's `SceneSnapshot`, read back by the io reader into a throw-away store, answered by the same
// model, template and hit-test code as the main thread. Everything here is CANVAS coordinates.
//
// Connectors are not in the store (the snapshot sends them as `arrowEnds` and `connections`), and
// titles come from the snapshot's precomputed `titleRect`s: the worker never measures text.
//
// Each method names the C++ function behind it (`LekhCanvasDelegate.cpp`, `ObjectStore.cpp`).
import type { Config } from '../../base';
import { Point, Rect, type LineEquation, type PointAndSlope, type SimplePath } from '../../geometry';
import {
  ObjectKind,
  PathPlacement,
  TemplatedObject,
  isFreehand,
  isTemplated,
  type LekhObject,
  type ObjectStore,
  type PaintEnv,
} from '../../model';
import { PathCaptureDrawingPlatform } from '../../render';
import { PolygonTemplate } from '../../template';
import type { ObjectId } from './RecMutation';
import type { RecViewTransform, SceneArrowObject, SceneConnection, SceneStore } from './SceneStore';
import { toCanvas, toView } from './SnapshotCanvasDelegate';

/** A title's box: a rect rotated by `angle` about its centre. */
export interface TitleBox {
  readonly rect: Rect;
  readonly angle: number;
}

/** C++ `ShapeTextElement::isPointInside`: inside the box, rotated about its centre. */
export function titleContains(t: TitleBox, p: Point): boolean {
  if (t.angle === 0) return t.rect.contains(p);
  const c = t.rect.center();
  const cos = Math.cos(-t.angle);
  const sin = Math.sin(-t.angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return t.rect.contains(new Point(c.x + dx * cos - dy * sin, c.y + dx * sin + dy * cos));
}

export interface ObjectSceneStoreInit {
  /** The store holding the snapshot's objects, in snapshot (store) order. */
  readonly store: ObjectStore;
  readonly config: Config;
  /** Canvas-coordinate title boxes by object id (`SnapshotObject.titleRect` / `titleAngle`). */
  readonly titles: ReadonlyMap<ObjectId, TitleBox>;
  readonly arrows: readonly SceneArrowObject[];
  readonly connections: readonly SceneConnection[];
  /** The job's zoom: the capture paint's `PaintEnv.zoom`. */
  readonly zoom: number;
}

/** An id the snapshot does not hold: a recognizer bug (C++ dereferences the `void*`). */
export class UnknownSceneObjectError extends Error {
  constructor() {
    super('scene object not in the snapshot');
    this.name = 'UnknownSceneObjectError';
  }
}

export class ObjectSceneStore implements SceneStore {
  private readonly store_: ObjectStore;
  private readonly config_: Config;
  private readonly titles_: ReadonlyMap<ObjectId, TitleBox>;
  private readonly arrows_: readonly SceneArrowObject[];
  private readonly connections_: readonly SceneConnection[];
  private readonly paintEnv_: PaintEnv;
  private readonly captured_ = new Map<ObjectId, SimplePath | null>();

  constructor(init: ObjectSceneStoreInit) {
    this.store_ = init.store;
    this.config_ = init.config;
    this.titles_ = init.titles;
    this.arrows_ = init.arrows;
    this.connections_ = init.connections;
    // C++ draws into the capture platform with an empty clip rect: no culling, no simplification.
    this.paintEnv_ = { config: init.config, zoom: init.zoom, forExport: true, images: null };
  }

  /** The object store (tests). */
  get store(): ObjectStore {
    return this.store_;
  }

  private obj(id: ObjectId): LekhObject {
    const o = this.store_.getObject(id, true);
    if (o === null) throw new UnknownSceneObjectError();
    return o;
  }

  objectIds(): readonly ObjectId[] {
    return this.store_.objects.map((o) => o.id);
  }

  // ---- kind flags
  /** lekhjs has no helper objects (`addHelperObject` had no caller). */
  isHelper(): boolean {
    return false;
  }
  isConnector(id: ObjectId): boolean {
    return this.obj(id).kind === ObjectKind.Connector;
  }
  isUnrecognized(id: ObjectId): boolean {
    return isFreehand(this.obj(id));
  }
  isTemplated(id: ObjectId): boolean {
    const o = this.obj(id);
    return isTemplated(o) && o.kind !== ObjectKind.Group;
  }
  /** C++ `ObjectStore::isConnectable`: a connectable kind that is not a group. */
  isConnectable(id: ObjectId): boolean {
    const o = this.obj(id);
    return o.isConnectableKind() && o.kind !== ObjectKind.Group;
  }

  // ---- the ObjectStore searches
  getObjectForConnection(pt: Point, allowedGap: number, excludes: ReadonlySet<ObjectId>): ObjectId | null {
    const ex = new Set<LekhObject>();
    for (const id of excludes) {
      const o = this.store_.getObject(id, true);
      if (o !== null) ex.add(o);
    }
    return this.store_.hit.objectForConnectionWithin(pt, ex, allowedGap)?.id ?? null;
  }
  isInsideOtherObject(pt: Point, except: ObjectId): boolean {
    return this.store_.hit.isInsideOtherObject(pt, this.store_.getObject(except, true));
  }

  // ---- per-object geometry
  selectionRect(id: ObjectId): Rect {
    return this.obj(id).selectionRect();
  }
  center(id: ObjectId): Point {
    return this.obj(id).getCenter();
  }
  connectionCentre(id: ObjectId): Point {
    return this.obj(id).connectionCentre();
  }
  distanceFrom(id: ObjectId, pt: Point): number {
    return this.obj(id).distanceFrom(pt);
  }
  isPointInside(id: ObjectId, pt: Point): boolean {
    return this.obj(id).isPointInside(pt);
  }
  isPointInsideTitle(id: ObjectId, pt: Point): boolean {
    this.obj(id);
    const t = this.titles_.get(id);
    return t !== undefined && titleContains(t, pt);
  }
  intersection(id: ObjectId, eq: LineEquation): PointAndSlope[] {
    return this.obj(id).getIntersection(eq);
  }
  strokeWidth(id: ObjectId): number {
    return this.obj(id).effectiveStrokeWidth();
  }
  openLineVertices(id: ObjectId): readonly [Point, Point] | null {
    const o = this.obj(id);
    if (!(o instanceof TemplatedObject) || o.kind === ObjectKind.Group) return null;
    const t = o.shapeTemplate();
    if (!(t instanceof PolygonTemplate) || t.isClosed()) return null;
    const v = t.vertices(o.ds);
    if (v.length !== 2) return null;
    return [v[0] as Point, v[1] as Point];
  }
  /** `PathCaptureDrawingPlatform` over `draw()`: the one plain path, or null (memoised per job). */
  capturedPath(id: ObjectId): SimplePath | null {
    if (this.captured_.has(id)) return this.captured_.get(id) ?? null;
    const o = this.obj(id);
    this.store_.ensureLayout(o);
    const pcdp = new PathCaptureDrawingPlatform();
    o.paint(pcdp, this.paintEnv_);
    const paths = pcdp.paths();
    const r = pcdp.isComplex() || paths.length !== 1 ? null : (paths[0] as SimplePath);
    this.captured_.set(id, r);
    return r;
  }

  // ---- scene-level lists
  arrowObjects(): readonly SceneArrowObject[] {
    return this.arrows_;
  }
  connections(): readonly SceneConnection[] {
    return this.connections_;
  }

  /** `PathPlacement::place` over the snapshot's polygons and ellipses (view path, edited in place). */
  placePath(path: SimplePath, view: RecViewTransform): boolean {
    return new PathPlacement(this.store_, {
      toDoc: (p: Point) => toCanvas(view, p),
      toScreen: (p: Point) => toView(view, p),
    }).place(path);
  }

  /** The engine config the store was built with (tests). */
  get config(): Config {
    return this.config_;
  }
}

/** A snapshot rect as a geometry `Rect`. */
export function rectOfSnap(r: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}): Rect {
  return new Rect(r.x, r.y, r.w, r.h);
}

/** A protocol point as a geometry `Point`. */
export function pointOfPt(p: { readonly x: number; readonly y: number }): Point {
  return new Point(p.x, p.y);
}
