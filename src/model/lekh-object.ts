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
import { Rect } from '../geometry';
import type { Point } from '../geometry';
import type { DecodedImage, DrawingPlatform } from '../render';

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

  /** True when all of `rect` lies in the container area (C++ `isRectInsideContainer`). */
  isRectInContainerArea(_rect: Rect, _scene: SceneQuery): boolean {
    return false;
  }

  /* eslint-enable @typescript-eslint/no-unused-vars */

  /** The image URLs (`res://`, `http(s)://`) this object references, members excluded. */
  imageUrls(): readonly string[] {
    return NO_STRINGS;
  }
}
