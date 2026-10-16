// The spatial index of one page (spec 03 §3): an rbush R-tree of the extents of its top-level
// objects. It is a candidate pre-filter only: callers sort what it returns back into store order
// and run the unchanged C++ predicate over it, so results equal the linear scan whenever the
// extent is conservative (§3.3).
//
// The item is kept on the object (`obj.indexItem`), so removal needs no search by value. An
// object whose extent is not finite (corrupt geometry) is never put in the tree; it is held in
// `unindexed` and returned by every search, so it stays hit-testable exactly as in the scan.
import RBush from 'rbush';
import type { Rect } from '../geometry';
import type { IndexItem, LekhObject } from './lekh-object';

/** rbush's default node size (spec 03 §3.1). */
export const INDEX_MAX_ENTRIES = 9;

function finite(r: Rect): boolean {
  return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height);
}

function itemFor(obj: LekhObject, r: Rect): IndexItem {
  return { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height, obj };
}

export class SpatialIndex {
  private readonly tree_ = new RBush<IndexItem>(INDEX_MAX_ENTRIES);
  private readonly unindexed_ = new Set<LekhObject>();
  private size_ = 0;

  /** Objects in the index (tree and unindexed). */
  get size(): number {
    return this.size_;
  }

  has(obj: LekhObject): boolean {
    return obj.indexItem !== null || this.unindexed_.has(obj);
  }

  /** Adds `obj` keyed by `extent` (its current `extent()` by default). */
  insert(obj: LekhObject, extent: Rect = obj.extent()): void {
    if (this.has(obj)) this.remove(obj);
    this.size_++;
    if (!finite(extent)) {
      this.unindexed_.add(obj);
      return;
    }
    const item = itemFor(obj, extent);
    obj.indexItem = item;
    this.tree_.insert(item);
  }

  /** Bulk-loads `objs` (load, reload, page build): one rbush `load`. */
  load(objs: readonly LekhObject[]): void {
    const items: IndexItem[] = [];
    for (const obj of objs) {
      if (this.has(obj)) this.remove(obj);
      this.size_++;
      const extent = obj.extent();
      if (!finite(extent)) {
        this.unindexed_.add(obj);
        continue;
      }
      const item = itemFor(obj, extent);
      obj.indexItem = item;
      items.push(item);
    }
    this.tree_.load(items);
  }

  remove(obj: LekhObject): void {
    const item = obj.indexItem;
    if (item !== null) {
      this.tree_.remove(item);
      obj.indexItem = null;
      this.size_--;
    } else if (this.unindexed_.delete(obj)) {
      this.size_--;
    }
  }

  /** Re-keys `obj` when its extent changed; true when it did. */
  update(obj: LekhObject, extent: Rect = obj.extent()): boolean {
    const item = obj.indexItem;
    if (
      item !== null &&
      item.minX === extent.x &&
      item.minY === extent.y &&
      item.maxX === extent.x + extent.width &&
      item.maxY === extent.y + extent.height
    ) {
      return false;
    }
    this.insert(obj, extent);
    return true;
  }

  /** Objects whose extent intersects `rect` (edges inclusive), in no particular order. */
  search(rect: Rect): LekhObject[] {
    const found = this.tree_.search({
      minX: rect.x,
      minY: rect.y,
      maxX: rect.x + rect.width,
      maxY: rect.y + rect.height,
    });
    const out = found.map((it) => it.obj);
    for (const obj of this.unindexed_) out.push(obj);
    return out;
  }

  clear(): void {
    for (const it of this.tree_.all()) it.obj.indexItem = null;
    this.tree_.clear();
    this.unindexed_.clear();
    this.size_ = 0;
  }
}
