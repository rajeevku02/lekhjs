// The dirty set of one page and its flush (spec 03 §5.2; working name `LayoutScheduler`,
// canonical `LayoutTracker`). `layout()` runs only for objects marked dirty, never for the page:
// layout cost is proportional to what changed. Off-screen objects are laid out when dirty, not
// when visible, so a connector to an off-screen shape always routes to its current outline.
//
// A flush lays out the dirty top-level objects that are not connectors first, then the dirty
// connectors, each in store order, then hands the batch to the host, which re-keys changed
// extents in the spatial index. It runs before every hit test, paint, serialization, projection
// and export. `ensure()` lays out one object on demand (a connector's ends, a lifted object).
import type { LayoutEnv, LekhObject } from './lekh-object';
import { ObjectKind } from './lekh-object';

/** What the flush needs from the store. */
export interface LayoutHost {
  readonly layoutEnv: LayoutEnv;
  /** The store position of a top-level object, or -1 when it is no longer a member. */
  positionOf(obj: LekhObject): number;
  /** Every top-level object of the batch, in store order, after layout (index updates). */
  commitLayout(objs: readonly LekhObject[]): void;
}

/** A flush that keeps re-dirtying itself is a bug; stop after this many rounds. */
const MAX_ROUNDS = 8;

export class LayoutTracker {
  private dirty_ = new Set<LekhObject>();
  private flushing_ = false;
  private layoutCalls_ = 0;

  /** `layout()` calls made by this tracker since it was created. */
  get layoutCalls(): number {
    return this.layoutCalls_;
  }

  /** Top-level objects waiting for the flush. */
  get pending(): number {
    return this.dirty_.size;
  }

  isPending(obj: LekhObject): boolean {
    return this.dirty_.has(obj);
  }

  /** Queues a top-level object for the next flush. */
  mark(obj: LekhObject): void {
    this.dirty_.add(obj);
  }

  /** Drops a removed object from the queue. */
  forget(obj: LekhObject): void {
    this.dirty_.delete(obj);
  }

  clear(): void {
    this.dirty_.clear();
  }

  /** Lays `obj` out now if it needs it; true when it did. */
  ensure(obj: LekhObject, env: LayoutEnv): boolean {
    if (!obj.needsLayout()) return false;
    this.layoutCalls_++;
    obj.layout(env);
    return true;
  }

  /** Lays out every dirty object; returns the number of `layout()` calls. */
  flush(host: LayoutHost): number {
    if (this.flushing_ || this.dirty_.size === 0) return 0;
    this.flushing_ = true;
    const before = this.layoutCalls_;
    let batch: { obj: LekhObject; pos: number }[] = [];
    try {
      for (let round = 0; round < MAX_ROUNDS && this.dirty_.size > 0; round++) {
        batch = [];
        for (const obj of this.dirty_) {
          const pos = host.positionOf(obj);
          if (pos >= 0) batch.push({ obj, pos });
        }
        this.dirty_ = new Set();
        batch.sort((a, b) => a.pos - b.pos);
        const env = host.layoutEnv;
        for (const { obj } of batch) if (obj.kind !== ObjectKind.Connector) this.ensure(obj, env);
        for (const { obj } of batch) if (obj.kind === ObjectKind.Connector) this.ensure(obj, env);
        host.commitLayout(batch.map((b) => b.obj));
        batch = [];
      }
    } catch (err) {
      // A layout that throws (spec 03 §14, E-50) loses nothing: the batch goes back into the queue
      // so the next flush lays out what is still dirty and re-keys what was laid out.
      for (const { obj } of batch) this.dirty_.add(obj);
      throw err;
    } finally {
      this.flushing_ = false;
    }
    return this.layoutCalls_ - before;
  }
}
