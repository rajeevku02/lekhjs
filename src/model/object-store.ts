// One page's objects (port of C++ `document::ObjectStore`, spec 03 §2-§6): the z-ordered
// top-level objects plus what makes queries cheap — an id map (nested group members included),
// the connector dependency map, the spatial index and the layout tracker. It is the only mutator
// of membership and order.
//
// - Only top-level objects are in `objects` and in the index; group members are reachable
//   through the id map with their parent group (§2.3).
// - A change reaches the store through `obj.invalidate()` → `markDirty`; the next flush lays out
//   exactly the dirty objects (connectors after their ends) and re-keys changed extents (§3.2).
// - A newly added object enters the index after its first layout; a load bulk-loads the index.
// - An interactive drag *lifts* the moving set and its connectors out of the index; queries test
//   them linearly until they land (§3.2). Nothing is done to the index per pointer move.
// - Z-order changes do not touch the index (it is order-free); they bump `storeVersion`, which
//   invalidates the cached `positionOf` map.
//
// Dropped from C++: helper objects (`addHelperObject` has no caller), `clearWithUndoManager`
// (an `edit/` command), the Translated/Scaled drawing platforms (the canvas transform, §9).
import type { Clock, Config } from '../base';
import type { Rect } from '../geometry';
import type { DrawingPlatform } from '../render';
import { ConnectionDependencyMap } from './connection-dependency-map';
import { HitTester, type HitScene } from './hit-tester';
import { LayoutTracker, type LayoutHost } from './layout-tracker';
import type {
  AlignmentPoints,
  LayoutEnv,
  LayoutOwner,
  LayoutServices,
  LekhObject,
  PaintEnv,
  SceneQuery,
} from './lekh-object';
import { ObjectKind } from './lekh-object';
import { OrderAllocator } from './order-allocator';
import { SpatialIndex } from './spatial-index';

export interface ObjectStoreOptions {
  readonly config: Config;
  /** The order "randomness" of C++ `getNextOrder` (B12, kept). */
  readonly clock: Clock;
  /** Layout services for the object kinds; default `{ config }`. */
  readonly services?: LayoutServices;
}

/** Where an id lives: the object, its parent group (null at top level) and its top-level owner. */
export interface IdEntry {
  readonly obj: LekhObject;
  readonly parentGroup: LekhObject | null;
  readonly root: LekhObject;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export class ObjectStore implements LayoutOwner, LayoutHost, HitScene, SceneQuery {
  readonly config: Config;
  readonly orders: OrderAllocator;
  readonly index = new SpatialIndex();
  readonly deps = new ConnectionDependencyMap();
  readonly tracker = new LayoutTracker();
  readonly hit: HitTester;
  readonly layoutEnv: LayoutEnv;

  private objects_: LekhObject[] = [];
  /** id → entries (several only for a malformed board with duplicate ids). */
  private readonly ids_ = new Map<string, IdEntry[]>();
  private readonly entryOf_ = new Map<LekhObject, IdEntry>();
  private readonly lifted_ = new Set<LekhObject>();
  private version_ = 0;
  private positions_: Map<LekhObject, number> | null = null;
  private positionsVersion_ = -1;

  constructor(opts: ObjectStoreOptions) {
    this.config = opts.config;
    this.orders = new OrderAllocator(opts.clock);
    const services = opts.services ?? { config: opts.config };
    this.layoutEnv = {
      ...services,
      ensureLayout: (obj) => {
        this.ensureLayout(obj);
      },
      objectById: (id) => this.getObject(id, true) ?? undefined,
    };
    this.hit = new HitTester(this);
  }

  // ---- membership and order ----

  /** Top-level objects in store (z) order, bottom first. */
  get objects(): readonly LekhObject[] {
    return this.objects_;
  }

  get size(): number {
    return this.objects_.length;
  }

  /** Bumped on every membership or order change. */
  get storeVersion(): number {
    return this.version_;
  }

  /**
   * C++ `add`: an object without an order gets the next one and goes last; otherwise it goes
   * before the first object with a greater order (appended at once when none can be: a load
   * arrives sorted).
   */
  add(obj: LekhObject): void {
    const objs = this.objects_;
    const last = objs[objs.length - 1];
    if (obj.order === 0) {
      obj.order = this.nextOrder();
      objs.push(obj);
    } else if (last === undefined || last.order <= obj.order) {
      objs.push(obj);
    } else {
      const i = objs.findIndex((o) => o.order > obj.order);
      if (i < 0) objs.push(obj);
      else objs.splice(i, 0, obj);
    }
    this.adopt(obj);
  }

  /** C++ `initWith`: replaces every object with `objs`, in the order given. */
  load(objs: readonly LekhObject[]): void {
    this.clear();
    this.objects_ = [...objs];
    for (const obj of this.objects_) this.adopt(obj);
  }

  contains(obj: LekhObject): boolean {
    return this.entryOf_.get(obj)?.parentGroup === null;
  }

  /** C++ `remove(obj)`. */
  remove(obj: LekhObject): void {
    const i = this.positionOf(obj);
    if (i < 0) return;
    this.objects_.splice(i, 1);
    this.release(obj);
  }

  /** C++ `remove(id)`: the first top-level object with `id`. */
  removeById(id: string): LekhObject | null {
    const obj = this.getObject(id);
    if (obj !== null) this.remove(obj);
    return obj;
  }

  /**
   * C++ `removeObjects(ids, removed)`: all or nothing. When every id names a top-level object,
   * removes them (pushed to `removed` from the highest store position down) and returns true.
   */
  removeObjects(ids: readonly string[], removed: LekhObject[]): boolean {
    const idSet = new Set(ids);
    const indices: number[] = [];
    for (let i = this.objects_.length - 1; i >= 0 && indices.length < idSet.size; i--) {
      if (idSet.has((this.objects_[i] as LekhObject).id)) indices.push(i);
    }
    if (indices.length !== idSet.size) return false;
    this.removeAt(indices, removed);
    return true;
  }

  /** C++ `removeObjects(idxs, removed)`: by store position, highest first. */
  removeAt(indices: readonly number[], removed: LekhObject[]): void {
    const sorted = [...indices].sort((a, b) => a - b);
    for (let k = sorted.length - 1; k >= 0; k--) {
      const idx = sorted[k] as number;
      const obj = this.objects_[idx];
      if (obj === undefined) continue;
      removed.push(obj);
      this.objects_.splice(idx, 1);
      this.release(obj);
    }
  }

  clear(): void {
    for (const obj of this.entryOf_.keys()) this.detach(obj);
    this.objects_ = [];
    this.ids_.clear();
    this.entryOf_.clear();
    this.lifted_.clear();
    this.index.clear();
    this.deps.clear();
    this.tracker.clear();
    this.bump();
  }

  isAtFront(obj: LekhObject): boolean {
    return this.objects_.length > 0 && this.objects_[this.objects_.length - 1] === obj;
  }

  isAtBack(obj: LekhObject): boolean {
    return this.objects_.length > 0 && this.objects_[0] === obj;
  }

  /** C++ `moveToOrder`: re-inserts before the first object with a greater order. */
  moveToOrder(obj: LekhObject, order: number): void {
    const found = this.getObject(obj.id);
    if (found === null) return;
    const i = this.positionOf(found);
    this.objects_.splice(i, 1);
    found.order = order;
    const at = this.objects_.findIndex((o) => order < o.order);
    if (at < 0) this.objects_.push(found);
    else this.objects_.splice(at, 0, found);
    this.bump();
  }

  nextOrder(): number {
    return this.orders.next(this.objects_[this.objects_.length - 1]?.order ?? 0);
  }

  prevOrder(): number {
    return this.orders.prev(this.objects_[0]?.order ?? 0);
  }

  // ---- lookup ----

  /**
   * C++ `getObject(id)` (top level only) and `getObject(id, nested)`: the first match in store
   * order, a top-level object before the members of a later group.
   */
  getObject(id: string, nested = false): LekhObject | null {
    const list = this.ids_.get(id);
    if (list === undefined) return null;
    let best: IdEntry | null = null;
    let bestPos = Infinity;
    for (const e of list) {
      if (!nested && e.parentGroup !== null) continue;
      const pos = this.positionOf(e.root);
      if (pos < bestPos) {
        best = e;
        bestPos = pos;
      }
    }
    return best?.obj ?? null;
  }

  /** The id-map entry of a member object. */
  entry(obj: LekhObject): IdEntry | undefined {
    return this.entryOf_.get(obj);
  }

  /** C++ `getObjects(ids, …)`: the top-level objects with these ids, highest position first. */
  getObjects(ids: ReadonlySet<string>): LekhObject[] {
    const out: LekhObject[] = [];
    for (let i = this.objects_.length - 1; i >= 0 && out.length < ids.size; i--) {
      const o = this.objects_[i] as LekhObject;
      if (ids.has(o.id)) out.push(o);
    }
    return out;
  }

  /** The store position of a top-level object, or -1. O(1) between order changes. */
  positionOf(obj: LekhObject): number {
    if (this.positions_ === null || this.positionsVersion_ !== this.version_) {
      const map = new Map<LekhObject, number>();
      this.objects_.forEach((o, i) => map.set(o, i));
      this.positions_ = map;
      this.positionsVersion_ = this.version_;
    }
    return this.positions_.get(obj) ?? -1;
  }

  /** C++ `getIndexOf`: the position, or `size` when absent. */
  indexOf(obj: LekhObject): number {
    const i = this.positionOf(obj);
    return i < 0 ? this.objects_.length : i;
  }

  /** C++ `Page::objectBefore` / `objectAfter` / `lastObject`. */
  objectBefore(obj: LekhObject): LekhObject | null {
    const i = this.positionOf(obj);
    return i > 0 ? (this.objects_[i - 1] as LekhObject) : null;
  }

  objectAfter(obj: LekhObject): LekhObject | null {
    const i = this.positionOf(obj);
    return i >= 0 ? (this.objects_[i + 1] ?? null) : null;
  }

  lastObject(): LekhObject | null {
    return this.objects_[this.objects_.length - 1] ?? null;
  }

  /** The connectors of `target` (or of a group's subtree), in store order (C++ `getConnections`). */
  connectionsOf(target: LekhObject): LekhObject[] {
    return this.hit.connectionsOf(target, this.deps);
  }

  /** SceneQuery: `getObjectsIn`. */
  objectsIn(rect: Rect, excludeContainer = true): LekhObject[] {
    return this.hit.objectsIn(rect, excludeContainer);
  }

  /** SceneQuery. */
  objectsWhere(rect: Rect, pred: (obj: LekhObject) => boolean): LekhObject[] {
    return this.hit.objectsWhere(rect, pred);
  }

  /** SceneQuery: C++ `getAlignmentPoints`. */
  alignmentPoints(excluded: ReadonlySet<LekhObject>): AlignmentPoints {
    return this.hit.alignmentPoints(excluded);
  }

  /**
   * Re-reads a group's members into the id map (after group / ungroup / a member added or
   * removed) and marks the group for layout.
   */
  refreshMembers(group: LekhObject): void {
    const root = this.entryOf_.get(group)?.root;
    if (root === undefined) return;
    for (const [obj, entry] of [...this.entryOf_]) {
      if (entry.root === root && obj !== root) this.unregisterOne(obj);
    }
    this.registerMembers(root, root);
    this.markDirty(group);
  }

  // ---- layout ----

  /** LayoutOwner: `obj` (top level or nested) changed. */
  markDirty(obj: LekhObject): void {
    const e = this.entryOf_.get(obj);
    if (e === undefined) return;
    obj.layoutState.dirty = true;
    if (obj.kind === ObjectKind.Connector) this.deps.set(obj);
    // Every group up the chain changes its bounds with its member.
    for (let g = e.parentGroup; g !== null; g = this.entryOf_.get(g)?.parentGroup ?? null) g.layoutState.dirty = true;
    this.tracker.mark(e.root);
    // Connectors on the changed object, on its ancestors and on its members (one level: a
    // connector has no connectors).
    const ids = new Set<string>();
    for (let g: LekhObject | null = obj; g !== null; g = this.entryOf_.get(g)?.parentGroup ?? null) ids.add(g.id);
    this.collectIds(obj, ids);
    for (const id of ids) {
      for (const c of this.deps.connectorsOf(id)) {
        if (c === obj) continue;
        c.layoutState.dirty = true;
        const ce = this.entryOf_.get(c);
        if (ce !== undefined) this.tracker.mark(ce.root);
      }
    }
  }

  /** Marks every object for layout (load, reload, font epoch with text, a document restyle). */
  markAllDirty(): void {
    for (const obj of this.objects_) {
      obj.layoutState.dirty = true;
      this.tracker.mark(obj);
    }
  }

  /** Lays out what is dirty and re-keys the index; returns the number of `layout()` calls. */
  flushLayout(): number {
    return this.tracker.flush(this);
  }

  /** Lays `obj` out now if it needs it. */
  ensureLayout(obj: LekhObject): void {
    this.tracker.ensure(obj, this.layoutEnv);
  }

  /** LayoutHost: re-keys the batch's extents (bulk load into an empty index). */
  commitLayout(objs: readonly LekhObject[]): void {
    const fresh: LekhObject[] = [];
    for (const obj of objs) {
      if (this.lifted_.has(obj) || this.positionOf(obj) < 0) continue;
      if (this.index.has(obj)) this.index.update(obj);
      else fresh.push(obj);
    }
    if (fresh.length > 1 && this.index.size === 0) this.index.load(fresh);
    else for (const obj of fresh) this.index.insert(obj);
  }

  // ---- lifting (interactive drag, resize, rotate, vertex edit) ----

  /** Lifts the top-level owners of `objs` and their connectors out of the index. */
  lift(objs: Iterable<LekhObject>): void {
    for (const obj of objs) {
      const root = this.entryOf_.get(obj)?.root;
      if (root === undefined) continue;
      this.liftOne(root);
      for (const c of this.connectionsOf(root)) this.liftOne(c);
    }
  }

  /** Lands every lifted object: laid out and reinserted at the next flush. */
  land(): void {
    const list = [...this.lifted_];
    this.lifted_.clear();
    for (const obj of list) this.tracker.mark(obj);
  }

  get lifted(): ReadonlySet<LekhObject> {
    return this.lifted_;
  }

  private liftOne(obj: LekhObject): void {
    if (this.lifted_.has(obj)) return;
    this.index.remove(obj);
    this.lifted_.add(obj);
  }

  // ---- queries and paint ----

  /** HitScene: index candidates of `rect` plus intersecting lifted objects, in store order. */
  candidates(rect: Rect): LekhObject[] {
    const found = this.index.search(rect);
    for (const obj of this.lifted_) if (intersects(obj.extent(), rect)) found.push(obj);
    const withPos: { obj: LekhObject; pos: number }[] = [];
    const seen = new Set<LekhObject>();
    for (const obj of found) {
      if (seen.has(obj)) continue;
      seen.add(obj);
      const pos = this.positionOf(obj);
      if (pos >= 0) withPos.push({ obj, pos });
    }
    withPos.sort((a, b) => a.pos - b.pos);
    return withPos.map((x) => x.obj);
  }

  /**
   * Paints the page's objects in store order: with a `cull` rect only those whose extent
   * intersects it (spec 03 §6), without one every object (export, thumbnails, `board_render`).
   * Returns the objects painted.
   */
  paint(dp: DrawingPlatform, env: PaintEnv, cull: Rect | null): readonly LekhObject[] {
    this.flushLayout();
    const list = cull === null ? this.objects_ : this.candidates(cull);
    for (const obj of list) obj.paint(dp, env);
    return list;
  }

  // ---- internals ----

  private bump(): void {
    this.version_++;
  }

  /** A new top-level member: id map, deps, owner, dirty. */
  private adopt(obj: LekhObject): void {
    this.register(obj, null, obj);
    this.registerMembers(obj, obj);
    this.bump();
    obj.layoutState.dirty = obj.layoutState.dirty || !obj.layoutState.laidOut;
    this.tracker.mark(obj);
    // Connectors already waiting on this id (a remote add of an end after its connector).
    for (const c of this.deps.connectorsOf(obj.id)) this.markDirty(c);
  }

  private release(obj: LekhObject): void {
    const ids = new Set<string>();
    this.collectIds(obj, ids);
    ids.add(obj.id);
    this.unregisterTree(obj);
    this.index.remove(obj);
    this.tracker.forget(obj);
    this.lifted_.delete(obj);
    this.bump();
    // A connector left with a dangling end routes again.
    for (const id of ids) for (const c of this.deps.connectorsOf(id)) this.markDirty(c);
  }

  private register(obj: LekhObject, parentGroup: LekhObject | null, root: LekhObject): void {
    const e: IdEntry = { obj, parentGroup, root };
    this.entryOf_.set(obj, e);
    const list = this.ids_.get(obj.id);
    if (list === undefined) this.ids_.set(obj.id, [e]);
    else list.push(e);
    obj.owner = this;
    if (obj.kind === ObjectKind.Connector) this.deps.set(obj);
  }

  private registerMembers(group: LekhObject, root: LekhObject): void {
    for (const m of group.members()) {
      this.register(m, group, root);
      this.registerMembers(m, root);
    }
  }

  private unregisterOne(obj: LekhObject): void {
    this.entryOf_.delete(obj);
    const list = this.ids_.get(obj.id);
    if (list !== undefined) {
      const rest = list.filter((e) => e.obj !== obj);
      if (rest.length === 0) this.ids_.delete(obj.id);
      else this.ids_.set(obj.id, rest);
    }
    this.deps.delete(obj);
    this.detach(obj);
  }

  private unregisterTree(obj: LekhObject): void {
    for (const m of obj.members()) this.unregisterTree(m);
    this.unregisterOne(obj);
  }

  private detach(obj: LekhObject): void {
    if (obj.owner === this) obj.owner = null;
  }

  private collectIds(obj: LekhObject, out: Set<string>): void {
    for (const m of obj.members()) {
      out.add(m.id);
      this.collectIds(m, out);
    }
  }
}
