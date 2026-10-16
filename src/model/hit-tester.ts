// The spatial queries of C++ `ObjectStore` (spec 03 §3.3, §4), on spatial-index candidates.
//
// Every query: (1) flushes the layout, so geometry is current; (2) takes the index candidates for
// the query rect grown by the predicate's own tolerance, plus the lifted objects; (3) sorts them
// into store order; (4) runs the unchanged C++ predicate and loop over them. Because step 4 is
// the same loop over a subsequence in the same order, the result equals the linear scan whenever
// extents are conservative, and the C++ tie-breaks hold: the first object in store order (the
// bottom-most) wins on equal distance (strict `<`).
//
// Shadow mode (`config.debug.verifyIndex`, on in vitest and dev builds): every query also runs
// the linear scan over the whole store and throws `LekhError('index_mismatch')` on a difference
// (AC-ENG-03).
//
// Ported from `ObjectStore.cpp` at the lines named on each method.
import type { Config } from '../base';
import { INT_MAX, LekhError } from '../base';
import type { Point } from '../geometry';
import { Rect, getDistance, rectIntersects } from '../geometry';
import type { AlignmentPoints, LekhObject, MovableTextInfo, SceneQuery } from './lekh-object';
import { ObjectKind } from './lekh-object';

/** What the hit tester needs from the store. */
export interface HitScene {
  readonly config: Config;
  /** Every top-level object in store order (the linear scan). */
  readonly objects: readonly LekhObject[];
  flushLayout(): void;
  /** Top-level objects whose extent intersects `rect`, lifted ones included, in store order. */
  candidates(rect: Rect): LekhObject[];
  positionOf(obj: LekhObject): number;
}

/** C++ `NearObject`. */
export interface NearObject {
  readonly object: LekhObject | null;
  readonly distance: number;
}

/** Options of `objectContaining` (C++ `getObjectContaining(pt, flattenGroup, checkContainer, includeTitle)`). */
export interface ContainingOptions {
  /** Descend into groups and return the member hit. */
  readonly flattenGroup: boolean;
  /** A point in a container's inner area does not hit the container. */
  readonly checkContainer: boolean;
  /** A point on a shape's title is a hit (selection, editing; not connection). Default true. */
  readonly includeTitle?: boolean;
}

/**
 * Grows every query rect by this much on each side, so a candidate a predicate accepts at the
 * exact boundary of its tolerance is never lost to rounding in `Rect.inflate`.
 */
const QUERY_SLACK = 1e-6;

function around(p: Point, half: number): Rect {
  const h = half + QUERY_SLACK;
  return new Rect(p.x - h, p.y - h, 2 * h, 2 * h);
}

function grown(r: Rect): Rect {
  return new Rect(r.x - QUERY_SLACK, r.y - QUERY_SLACK, r.width + 2 * QUERY_SLACK, r.height + 2 * QUERY_SLACK);
}

/** C++ `flattenGroup`: the leaves of a group, depth first; any other object is its own leaf. */
function flatten(obj: LekhObject, out: LekhObject[]): void {
  if (obj.kind !== ObjectKind.Group) {
    out.push(obj);
    return;
  }
  for (const m of obj.members()) flatten(m, out);
}

/** Every id in `obj`'s subtree, `obj` first. */
function subtreeIds(obj: LekhObject, out: Set<string>): void {
  out.add(obj.id);
  for (const m of obj.members()) subtreeIds(m, out);
}

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export class HitTester implements SceneQuery {
  private readonly scene_: HitScene;

  constructor(scene: HitScene) {
    this.scene_ = scene;
  }

  private get verify(): boolean {
    return this.scene_.config.debug.verifyIndex;
  }

  private mismatch(query: string): never {
    throw new LekhError('index_mismatch', `spatial index and linear scan differ in ${query}`, { query });
  }

  /** Flush, then the candidates of `rect` in store order. */
  private candidates(rect: Rect): LekhObject[] {
    this.scene_.flushLayout();
    return this.scene_.candidates(rect);
  }

  // ---- getObjectNear (ObjectStore.cpp:26-48) ----

  /**
   * The object nearest `p` among those whose selection rect grown by `tolerance` on each side
   * contains it; a point on a title counts as distance 0. Ties: the first in store order.
   */
  objectNear(p: Point, tolerance: number): NearObject {
    const near = this.nearIn(this.candidates(around(p, tolerance)), p, tolerance);
    if (this.verify) {
      const lin = this.nearIn(this.scene_.objects, p, tolerance);
      if (lin.object !== near.object || lin.distance !== near.distance) this.mismatch('objectNear');
    }
    return near;
  }

  private nearIn(objects: readonly LekhObject[], p: Point, tolerance: number): NearObject {
    let dist = INT_MAX;
    let obj: LekhObject | null = null;
    for (const o of objects) {
      const rect = o.selectionRect().inflate(tolerance * 2);
      if (o.isPointInsideTitle(p)) {
        if (0 < dist) {
          dist = 0;
          obj = o;
        }
      } else if (rect.contains(p)) {
        const d = o.distanceFrom(p);
        if (d < dist) {
          dist = d;
          obj = o;
        }
      }
    }
    return { object: obj, distance: dist };
  }

  // ---- getSelectableObjectAt (ObjectStore.cpp:611-620) ----

  /** The near object within `tolerance` plus half its stroke; else the containing object. */
  selectableAt(p: Point, tolerance: number): LekhObject | null {
    const near = this.objectNear(p, tolerance);
    if (near.object !== null && near.distance <= tolerance + near.object.effectiveStrokeWidth() / 2) {
      return near.object;
    }
    return this.objectContaining(p, { flattenGroup: false, checkContainer: true });
  }

  // ---- getObjectContaining (ObjectStore.cpp:222-242, 406-456) ----

  /** The object (or, flattened, the group member) containing `p` nearest its outline. */
  objectContaining(p: Point, opts: ContainingOptions): LekhObject | null {
    const hit = this.containingIn(this.candidates(around(p, 0)), p, opts);
    if (this.verify && this.containingIn(this.scene_.objects, p, opts) !== hit) this.mismatch('objectContaining');
    return hit;
  }

  /** C++ `isPointInside(obj, pt, checkContainer, &dist, includeTitle)`: the distance, or null. */
  private insideDistance(obj: LekhObject, p: Point, checkContainer: boolean, includeTitle: boolean): number | null {
    if (obj.isPointInside(p)) {
      if (checkContainer && obj.isInContainerArea(p, this)) return null;
      return obj.distanceFrom(p);
    }
    if (includeTitle && obj.isPointInsideTitle(p)) return obj.distanceFrom(p);
    return null;
  }

  /** C++ `getObjectContaining(obj, pt, checkContainer, &dist, includeTitle)` (recursive over groups). */
  private containingMember(
    obj: LekhObject,
    p: Point,
    checkContainer: boolean,
    includeTitle: boolean,
  ): { obj: LekhObject; dist: number } | null {
    if (obj.kind === ObjectKind.Group) {
      let best: { obj: LekhObject; dist: number } | null = null;
      for (const m of obj.members()) {
        const r = this.containingMember(m, p, checkContainer, includeTitle);
        if (r !== null && r.dist < (best?.dist ?? INT_MAX)) best = r;
      }
      return best;
    }
    const d = this.insideDistance(obj, p, checkContainer, includeTitle);
    return d === null ? null : { obj, dist: d };
  }

  private containingIn(objects: readonly LekhObject[], p: Point, opts: ContainingOptions): LekhObject | null {
    const includeTitle = opts.includeTitle ?? true;
    let dist = INT_MAX;
    let hit: LekhObject | null = null;
    for (const o of objects) {
      if (opts.flattenGroup && o.kind === ObjectKind.Group) {
        const r = this.containingMember(o, p, opts.checkContainer, includeTitle);
        if (r !== null && r.dist < dist) {
          dist = r.dist;
          hit = r.obj;
        }
      } else {
        const d = this.insideDistance(o, p, opts.checkContainer, includeTitle);
        if (d !== null && d < dist) {
          dist = d;
          hit = o;
        }
      }
    }
    return hit;
  }

  // ---- getObjectForConnection (ObjectStore.cpp:301-353) ----

  /**
   * The object a connector end dropped at `p` attaches to: an object whose body contains `p`
   * (nearest outline; the first inside replaces any nearer outside one), else the nearest within
   * `connectObjectDistThreshold / zoom`. Groups are flattened; titles never count.
   */
  objectForConnection(p: Point, excludes: ReadonlySet<LekhObject>, zoom: number): LekhObject | null {
    const gap = this.scene_.config.connectObjectDistThreshold / zoom;
    const hit = this.connectionIn(this.candidates(around(p, gap * 2)), p, excludes, gap);
    if (this.verify && this.connectionIn(this.scene_.objects, p, excludes, gap) !== hit) {
      this.mismatch('objectForConnection');
    }
    return hit;
  }

  private connectionIn(
    objects: readonly LekhObject[],
    p: Point,
    excludes: ReadonlySet<LekhObject>,
    gap: number,
  ): LekhObject | null {
    const ignore = (o: LekhObject): boolean =>
      excludes.has(o) ||
      !o.isConnectableKind() ||
      !o
        .selectionRect()
        .inflate(gap * 4)
        .contains(p);
    let result: LekhObject | null = null;
    let dist = INT_MAX;
    let insideFound = false;
    for (const obj of objects) {
      if (ignore(obj)) continue;
      const leaves: LekhObject[] = [];
      flatten(obj, leaves);
      for (const item of leaves) {
        if (ignore(item)) continue;
        const d = this.insideDistance(item, p, false, false);
        if (d !== null) {
          if (d < dist || !insideFound) {
            result = item;
            dist = d;
            insideFound = true;
          }
        } else if (!insideFound) {
          const out = item.distanceFrom(p);
          if (out < dist && out <= gap) {
            result = item;
            dist = out;
          }
        }
      }
    }
    return result;
  }

  // ---- isInsideOtherObject (ObjectStore.cpp:385-404) ----

  /** `p` inside the body of a connectable object (groups flattened) other than `except`. */
  isInsideOtherObject(p: Point, except: LekhObject | null): boolean {
    const r = this.insideOtherIn(this.candidates(around(p, 0)), p, except);
    if (this.verify && this.insideOtherIn(this.scene_.objects, p, except) !== r) this.mismatch('isInsideOtherObject');
    return r;
  }

  private insideOtherIn(objects: readonly LekhObject[], p: Point, except: LekhObject | null): boolean {
    for (const obj of objects) {
      if (!obj.isConnectableKind()) continue;
      const leaves: LekhObject[] = [];
      flatten(obj, leaves);
      for (const item of leaves) {
        if (item === except || !item.isConnectableKind()) continue;
        if (this.insideDistance(item, p, true, false) !== null) return true;
      }
    }
    return false;
  }

  // ---- getObjectsIn (ObjectStore.cpp:662-683) ----

  /**
   * Top-level objects with non-empty visual bounds that intersect `rect` (C++ `Rectangle::
   * intersects`), skipping a container whose inner area holds all of `rect` when
   * `excludeContainer`. Store order.
   */
  objectsIn(rect: Rect, excludeContainer = true): LekhObject[] {
    const r = this.objectsInList(this.candidates(grown(rect)), rect, excludeContainer);
    if (this.verify && !sameList(this.objectsInList(this.scene_.objects, rect, excludeContainer), r)) {
      this.mismatch('objectsIn');
    }
    return r;
  }

  private objectsInList(objects: readonly LekhObject[], rect: Rect, excludeContainer: boolean): LekhObject[] {
    const out: LekhObject[] = [];
    for (const o of objects) {
      const vb = o.visualBounds();
      if (!((vb.height > 0 || vb.width > 0) && rectIntersects(rect, vb))) continue;
      if (excludeContainer && o.isRectInContainerArea(rect, this)) continue;
      out.push(o);
    }
    return out;
  }

  // ---- getErasableObjects (ObjectStore.cpp:458-483) ----

  /**
   * Objects within `threshold` (default `tapToEraseDistance`) of `at`, then the connectors of each
   * of them that is not a connector. Both lists are in store order (C++: pointer order of a
   * `std::set`, unreproducible; DR-ENG-08). A connector that is both near and attached appears
   * twice, as in C++.
   */
  erasableAt(at: Point, threshold = -1): LekhObject[] {
    const t = threshold < 0 ? this.scene_.config.tapToEraseDistance : threshold;
    const r = this.erasableIn(this.candidates(around(at, t)), at, t);
    if (this.verify && !sameList(this.erasableIn(this.scene_.objects, at, t), r)) this.mismatch('erasableAt');
    return r;
  }

  private erasableIn(objects: readonly LekhObject[], at: Point, t: number): LekhObject[] {
    const near = objects.filter((o) => o.distanceFrom(at) <= t);
    const conns = new Set<LekhObject>();
    for (const o of near) {
      if (o.kind !== ObjectKind.Connector) for (const c of this.connectionsOfLinear(o)) conns.add(c);
    }
    return [...near, ...this.inStoreOrder(conns)];
  }

  // ---- getConnections (ObjectStore.cpp:531-549) ----

  /**
   * The connectors with an end on `target` or, for a group, on any member at any depth or on the
   * group itself (B18c, DR-ENG-21), in store order. Uses the dependency map.
   */
  connectionsOf(target: LekhObject, deps: { connectorsOf(id: string): ReadonlySet<LekhObject> }): LekhObject[] {
    const ids = new Set<string>();
    subtreeIds(target, ids);
    const found = new Set<LekhObject>();
    for (const id of ids) for (const c of deps.connectorsOf(id)) found.add(c);
    const r = this.inStoreOrder(found);
    if (this.verify && !sameList(this.connectionsOfLinear(target), r)) this.mismatch('connectionsOf');
    return r;
  }

  private connectionsOfLinear(target: LekhObject): LekhObject[] {
    const ids = new Set<string>();
    subtreeIds(target, ids);
    return this.scene_.objects.filter((o) => o.kind === ObjectKind.Connector && o.endIds().some((id) => ids.has(id)));
  }

  private inStoreOrder(set: ReadonlySet<LekhObject>): LekhObject[] {
    const list = [...set].filter((o) => this.scene_.positionOf(o) >= 0);
    list.sort((a, b) => this.scene_.positionOf(a) - this.scene_.positionOf(b));
    return list;
  }

  // ---- SceneQuery: objectsWhere, alignmentPoints ----

  objectsWhere(rect: Rect, pred: (obj: LekhObject) => boolean): LekhObject[] {
    const r = this.candidates(grown(rect)).filter(pred);
    if (this.verify && !sameList(this.scene_.objects.filter(pred), r)) this.mismatch('objectsWhere');
    return r;
  }

  /**
   * C++ `getAlignmentPoints(excluded)` (ObjectStore.cpp:696-707): every top-level object's points,
   * in store order, then xs sorted by x and ys sorted by y. B7 fixed: C++ sorted the ys by x too.
   * The sorts are stable, so equal coordinates keep store order (DR-ENG-09).
   */
  alignmentPoints(excluded: ReadonlySet<LekhObject>): AlignmentPoints {
    this.scene_.flushLayout();
    const xs: Point[] = [];
    const ys: Point[] = [];
    for (const o of this.scene_.objects) if (!excluded.has(o)) o.collectAlignmentPoints(xs, ys);
    xs.sort((a, b) => a.x - b.x);
    ys.sort((a, b) => a.y - b.y);
    return { xs, ys };
  }

  // ---- getEditableObjectAt (ObjectStore.cpp:551-584) ----

  /**
   * The object whose text an edit at `loc` opens: a shape with non-empty text there (containers
   * included), else a shape's text slot there that is not an implicit container, else a
   * connector label (existing, or a new one near its route).
   */
  editableAt(loc: Point): LekhObject | null {
    const shapeKind = (o: LekhObject | null): o is LekhObject =>
      o !== null && (o.kind === ObjectKind.Templated || o.kind === ObjectKind.Freehand);
    let obj = this.objectContaining(loc, { flattenGroup: true, checkContainer: false });
    if (shapeKind(obj) && obj.canEditText() && obj.canEditTextAt(loc) && obj.getTextForEditing() !== '') return obj;
    obj = this.objectContaining(loc, { flattenGroup: true, checkContainer: true });
    if (shapeKind(obj) && obj.canEditText() && obj.canEditTextAt(loc) && !obj.isImplicitContainer(this)) return obj;
    const tap = this.scene_.config.tapToSelectDistance;
    const isLabel = (o: LekhObject) => o.kind === ObjectKind.Connector && o.canEditTextAt(loc);
    const hit = this.candidates(around(loc, tap * 1.25)).find(isLabel) ?? null;
    if (this.verify && (this.scene_.objects.find(isLabel) ?? null) !== hit) this.mismatch('editableAt');
    return hit;
  }

  // ---- getMovableTextNear (ObjectStore.cpp:586-609) ----

  /** The label nearest `pt` that can be dragged (connector labels); ties: first in store order. */
  movableTextNear(pt: Point): MovableTextInfo | null {
    const tap = this.scene_.config.tapToSelectDistance;
    const r = this.movableIn(this.candidates(around(pt, tap * 1.25)), pt);
    if (this.verify) {
      const lin = this.movableIn(this.scene_.objects, pt);
      if (lin?.obj !== r?.obj || lin?.index !== r?.index) this.mismatch('movableTextNear');
    }
    return r;
  }

  private movableIn(objects: readonly LekhObject[], pt: Point): MovableTextInfo | null {
    let dist = INT_MAX;
    let found: MovableTextInfo | null = null;
    for (const o of objects) {
      const mi = o.getMovableTextNear(pt);
      if (mi === null) continue;
      const d = getDistance(pt, mi.center);
      if (d < dist) {
        dist = d;
        found = mi;
      }
    }
    return found;
  }

  // ---- getBoundsOfAll (ObjectStore.cpp:622-659) ----

  /**
   * The union of every object's visual bounds grown by `inflate(strokeWidth / 2)`, from the
   * cached layout (no re-route, B9). B8 fixed (DR-ENG-17): the first object's stroke counts too.
   */
  boundsOfAll(): Rect {
    this.scene_.flushLayout();
    const objects = this.scene_.objects;
    if (objects.length === 0) return new Rect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const o of objects) {
      const r = o.visualBounds().inflate(o.effectiveStrokeWidth() / 2);
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (maxX < r.x + r.width) maxX = r.x + r.width;
      if (maxY < r.y + r.height) maxY = r.y + r.height;
    }
    return new Rect(minX, minY, maxX - minX, maxY - minY);
  }
}
