// The object contract every page object satisfies (spec 03 §2.2), with the layout/paint split
// (§5): `layout()` computes geometry into `layoutState` and runs only when the object is dirty;
// `paint()` issues draw calls from that layout and runs only when the object is visible.
//
// Port of the part of C++ `object::LekhObject` that the store, the spatial index and the hit
// tests use. The object kinds (`TemplatedObject`, `GroupObject`, `UnrecognizedObject`,
// `ConnectionObject`) extend this class in their own files and add the transform, text-editing
// and routing members. Dropped from C++: the 13 UI event virtuals, the event subscribers,
// `isHelperObject` (spec 03 §2.2) and the always-empty `contextRect` draw argument.
//
// An object never holds a reference to the store's internals: the store sets `owner` while the
// object is a member, and a changed object calls `invalidate()`, which reports to the owner.
import type { Config } from '../base';
import { Point, Rect } from '../geometry';
import type { LineEquation, PointAndSlope, Size } from '../geometry';
import type { DecodedImage, DrawingPlatform } from '../render';
import { Style } from '../style';
import type { Length } from '../style';
import type { InterestingPoint } from '../template';

/** The object kinds (spec 01 C6): code tests `obj.kind`, never `instanceof` across modules. */
export const ObjectKind = Object.freeze({
  Templated: 'templated',
  Group: 'group',
  Freehand: 'freehand',
  Connector: 'connector',
} as const);
export type ObjectKind = (typeof ObjectKind)[keyof typeof ObjectKind];

/** What `layout()` produces for the store: the visual bounds and the conservative extent (§3.1). */
export interface LayoutGeometry {
  readonly visualBounds: Rect;
  /**
   * Covers every pixel `paint()` can touch and every point a hit predicate can accept: visual
   * bounds, laid-out path, title and embed boxes, inflated by stroke, arrowheads and shadow.
   */
  readonly extent: Rect;
}

const EMPTY_RECT: Rect = Object.freeze(new Rect());

/** The layout cache of one object (spec 03 §5.2). Written only by `LekhObject.layout()`. */
export class LayoutState {
  /** Something changed since the last `layout()`. */
  dirty = true;
  /** `layout()` ran at least once. */
  laidOut = false;
  visualBounds: Rect = EMPTY_RECT;
  extent: Rect = EMPTY_RECT;
  /** The style revision sum the object was laid out with (an ancestor restyle re-lays out). */
  styleRevision = -1;
}

/** Services an object may use while laying out. Object kinds widen this as they need. */
export interface LayoutServices {
  readonly config: Config;
}

/** The environment of one `layout()` call. */
export interface LayoutEnv extends LayoutServices {
  /** Lays `obj` out now if it needs it (a connector asks this for its ends). */
  ensureLayout(obj: LekhObject): void;
  /** Any object of the page by id, nested group members included. */
  objectById(id: string): LekhObject | undefined;
}

/** Decoded images by URL (the session's `ImageCache`); paint looks images up, never fetches. */
export interface ImageLookup {
  get(url: string): DecodedImage | undefined;
}

/** The environment of one `paint()` call. */
export interface PaintEnv {
  readonly config: Config;
  /** The view zoom (1 for export). */
  readonly zoom: number;
  /** Export, thumbnails, `board_render`: never culled, never simplified. */
  readonly forExport: boolean;
  readonly images: ImageLookup | null;
}

/** The store's side of an object: where `invalidate()` reports. */
export interface LayoutOwner {
  markDirty(obj: LekhObject): void;
}

/** What an object may ask of its page during a query (spec 01 C3): containers, alignment. */
export interface SceneQuery {
  /** Top-level objects whose visual bounds intersect `rect`, in store order (`getObjectsIn`). */
  objectsIn(rect: Rect, excludeContainer?: boolean): LekhObject[];
  /**
   * The top-level objects, in store order, for which `pred` holds, among those whose extent
   * intersects `rect`. `pred` must hold only for objects whose extent intersects `rect` (the
   * shadow mode checks this against the whole store).
   */
  objectsWhere(rect: Rect, pred: (obj: LekhObject) => boolean): LekhObject[];
  /**
   * The alignment points of every top-level object not in `excluded` (C++ `getAlignmentPoints`),
   * xs sorted by x and ys sorted by y (B7), stable.
   */
  alignmentPoints(excluded: ReadonlySet<LekhObject>): AlignmentPoints;
}

/** Alignment candidates of a drag (C++ `alignmentx` / `alignmenty`). */
export interface AlignmentPoints {
  readonly xs: readonly Point[];
  readonly ys: readonly Point[];
}

/**
 * What a transforming object may use (replaces C++ `LekhGlobal::activeObjectStore()` and
 * `document()->snapStep()`): its page, the document snap step, and the group a container builds
 * over the shapes inside it.
 */
export interface ModificationContext {
  readonly scene: SceneQuery;
  readonly snapStep: Length;
  /** C++ `new GroupObject(objs)`, for a container's drag (`initializeContainerObjects`). */
  makeGroup(members: readonly LekhObject[]): LekhObject;
}

/** C++ `MovableTextInfo`: a label that can be dragged along its connector. */
export interface MovableTextInfo {
  readonly obj: LekhObject;
  readonly index: number;
  readonly center: Point;
  readonly param: number;
}

/** What `finishTextEditing` reports: the text before the edit and the slot edited. */
export interface TextEditResult {
  readonly text: string;
  readonly index: number;
}

/** A transform's net change (`finishTranslating`, `finishScaling`, `finishExpanding`). */
export interface Delta2 {
  readonly x: number;
  readonly y: number;
}

/** The spatial-index entry of a top-level object (rbush item); kept on the object. */
export interface IndexItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  readonly obj: LekhObject;
}

const NO_OBJECTS: readonly LekhObject[] = Object.freeze([]);
const NO_STRINGS: readonly string[] = Object.freeze([]);

export abstract class LekhObject {
  /** Opaque and case-sensitive (KB document-model "Page and object identity"). */
  readonly id: string;
  abstract readonly kind: ObjectKind;
  /** Stacking order on the page (0 = not set yet). */
  order = 0;
  readonly layoutState = new LayoutState();
  /** The store this object is a member of (top level or nested); set by the store. */
  owner: LayoutOwner | null = null;
  /** The object's entry in the spatial index; managed by `SpatialIndex`. */
  indexItem: IndexItem | null = null;
  private rev_ = 0;

  constructor(id: string) {
    this.id = id;
  }

  /** Bumped on every change (the recognizer snapshot checks it, spec 07 §6.5). */
  get rev(): number {
    return this.rev_;
  }

  /**
   * Records a change that can move geometry: bumps `rev`, marks the layout dirty and tells the
   * owner, which marks dependent connectors and schedules the flush. Every setter calls this.
   */
  invalidate(): void {
    this.rev_++;
    this.layoutState.dirty = true;
    this.owner?.markDirty(this);
  }

  /** The style revision sum this object's layout depends on (`Style.revisionSum()`). */
  styleRevision(): number {
    return 0;
  }

  needsLayout(): boolean {
    const s = this.layoutState;
    return s.dirty || !s.laidOut || s.styleRevision !== this.styleRevision();
  }

  /** Computes the geometry and stores it in `layoutState`. Only the layout tracker calls this. */
  layout(env: LayoutEnv): void {
    const g = this.computeLayout(env);
    const s = this.layoutState;
    s.visualBounds = g.visualBounds;
    s.extent = g.extent;
    s.styleRevision = this.styleRevision();
    s.dirty = false;
    s.laidOut = true;
  }

  /** The kind's layout: geometry only, no draw calls. */
  protected abstract computeLayout(env: LayoutEnv): LayoutGeometry;

  /** Issues the draw calls of the current layout. */
  abstract paint(dp: DrawingPlatform, env: PaintEnv): void;

  // ---- geometry (current after the store's flush) ----

  /** C++ `getSelectionRectangle`. */
  abstract selectionRect(): Rect;

  /** C++ `getVisualBounds`: the laid-out visual bounds. */
  visualBounds(): Rect {
    return this.layoutState.visualBounds;
  }

  /** The conservative box the spatial index keys on (§3.1). */
  extent(): Rect {
    return this.layoutState.extent;
  }

  /** C++ `isPointInside`: the body, titles excluded. */
  abstract isPointInside(p: Point): boolean;

  /* eslint-disable @typescript-eslint/no-unused-vars -- default hooks take the parameters their overrides use */

  /** C++ `isPointInsideTitle`. */
  isPointInsideTitle(_p: Point): boolean {
    return false;
  }

  /** C++ `getDistanceFrom(pt, Rectangle())`. */
  abstract distanceFrom(p: Point): number;

  /** C++ `getDrawingProfile()->effectiveStrokeWidth()`. */
  effectiveStrokeWidth(): number {
    return 0;
  }

  // ---- structure ----

  /** A group's members in member order (`ContainedObject` order); empty for other kinds. */
  members(): readonly LekhObject[] {
    return NO_OBJECTS;
  }

  /** A connector's end object ids (first, second); empty for other kinds. */
  endIds(): readonly string[] {
    return NO_STRINGS;
  }

  /**
   * C++ `ObjectStore::isConnectableKind` minus the store-level checks: false for a connector, a
   * freehand stroke, and (in `TemplatedObject`) an open path or polygon or a Bézier curve.
   */
  isConnectableKind(): boolean {
    return this.kind !== ObjectKind.Connector && this.kind !== ObjectKind.Freehand;
  }

  /**
   * True when `p` falls in this object's container area (a template container, or an implicit
   * container away from its outline), so a container-aware hit test passes through it.
   */
  isInContainerArea(_p: Point, _scene: SceneQuery): boolean {
    return false;
  }

  /** C++ `ObjectStore::isImplicitContainer`: a large rectangle, or one holding another object. */
  isImplicitContainer(_scene: SceneQuery): boolean {
    return false;
  }

  /** True when all of `rect` lies in the container area (C++ `isRectInsideContainer`). */
  isRectInContainerArea(_rect: Rect, _scene: SceneQuery): boolean {
    return false;
  }

  /* eslint-enable @typescript-eslint/no-unused-vars */

  /** The image URLs (`res://`, `http(s)://`) this object references, members excluded. */
  imageUrls(): readonly string[] {
    return NO_STRINGS;
  }

  /* eslint-disable @typescript-eslint/no-unused-vars -- default hooks take the parameters their overrides use */
  // ---- the rest of the C++ `LekhObject` interface (defaults as C++) ----

  /** C++ `drawingProfile`: the style of an object without a template. */
  readonly drawingProfile: Style = new Style();
  /** C++ `text` (objects without a template; legacy forms). */
  text = '';
  protected origText_ = '';
  protected editingText_ = false;
  /** C++ `origSelRect_`, saved by `startModification`. */
  protected origSelRect_: Rect = new Rect();

  /** C++ `getName()`. */
  name(): string {
    return '';
  }

  /**
   * The keys a `ShapeInteractionRegistry` resolves this object's interaction by (spec 05 §5): the
   * template id first when there is one, then the class name.
   */
  interactionKeys(): readonly string[] {
    return [this.name()];
  }

  /** C++ `getDrawingProfile()`. */
  getDrawingProfile(): Style {
    return this.drawingProfile;
  }

  /** C++ `getCenter()`: (-1, -1) for an object without one. */
  getCenter(): Point {
    return new Point(-1, -1);
  }

  /** C++ `location()`. */
  location(): Point {
    return this.getCenter();
  }

  /** C++ `getIntersection(eq)`: where the line crosses the outline, with the outline's slope. */
  getIntersection(_eq: LineEquation): PointAndSlope[] {
    return [];
  }

  /** C++ `getInterestingPoints()`: the handles a selection shows. */
  getInterestingPoints(): InterestingPoint[] {
    return [];
  }

  /** C++ `moveVertexTo(vid, pt)`: where the vertex went. */
  moveVertexTo(_vid: number, pt: Point): Point {
    return pt;
  }

  /** The centre a connector end's angle is measured from (C++ `ConnectionEndPoint::center`). */
  connectionCentre(): Point {
    return this.getCenter();
  }

  /** The width and height of the object's box (its `DataStore`), or null without one. */
  boxSize(): Size | null {
    return null;
  }

  /** C++ `unrotatedSelectionRectangle` for templated objects, else the selection rect. */
  unrotatedRect(): Rect {
    return this.selectionRect();
  }

  /** C++ `rotation()` (templated objects), else 0. */
  rotation(): number {
    return 0;
  }

  /** C++ `clone()`: a detached copy, or null for a kind that cannot be cloned. */
  clone(): LekhObject | null {
    return null;
  }

  // ---- alignment (C++ `ObjectStore::getAlignmentPointsOf`) ----

  /** Appends this object's alignment points; nothing for connectors and freehand strokes. */
  collectAlignmentPoints(_xs: Point[], _ys: Point[]): void {
    /* none */
  }

  // ---- modification: start, apply many times, finish (KB document-model) ----

  startModification(_ctx?: ModificationContext): void {
    this.origSelRect_ = this.selectionRect();
  }
  translate(_dx: number, _dy: number): void {
    /* C++: empty */
  }
  finishTranslating(): Delta2 {
    return { x: 0, y: 0 };
  }
  rotate(_angle: number): void {
    /* C++: empty */
  }
  finishRotating(): number {
    return 0;
  }
  scale(_fx: number, _fy: number): void {
    /* C++: empty */
  }
  finishScaling(): Delta2 {
    return { x: 1, y: 1 };
  }
  expand(_dx: number, _dy: number, _anchorCorner: number): void {
    /* C++: empty */
  }
  finishExpanding(): Delta2 {
    const rect = this.selectionRect();
    return { x: rect.width - this.origSelRect_.width, y: rect.height - this.origSelRect_.height };
  }
  canFlip(_type: number): boolean {
    return false;
  }
  flip(_type: number): void {
    /* C++: empty */
  }

  // ---- text editing ----

  canEditText(): boolean {
    return false;
  }
  canEditTextAt(_p: Point): boolean {
    return false;
  }
  isEditingText(): boolean {
    return this.editingText_;
  }
  getTextEditCenter(): Point {
    return this.getCenter();
  }
  startTextEditing(_p: Point): void {
    this.origText_ = this.text;
    this.editingText_ = true;
  }
  updateText(str: string, _index: number): void {
    this.text = str;
    this.invalidate();
  }
  finishTextEditing(): TextEditResult {
    this.editingText_ = false;
    return { text: this.origText_, index: 0 };
  }
  getTextForEditing(): string {
    return this.text;
  }
  getEditTextStyle(): Style {
    return this.drawingProfile;
  }
  /** C++ `getMovableTextNear`: a label of this object near `p`, or null. */
  getMovableTextNear(_p: Point): MovableTextInfo | null {
    return null;
  }
  /** C++ `moveTextNear`: the label's new position along the route, or null when `p` is not near it. */
  moveTextNear(_index: number, _p: Point): number | null {
    return null;
  }
  moveText(_index: number, _param: number): void {
    /* C++: empty */
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
