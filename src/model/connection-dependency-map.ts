// Which connectors end on which object (spec 03 §2.1 `ConnectionDeps`, spec 02 canonical name
// `ConnectionDependencyMap`): `endId → connectors`. It tells the layout tracker which connectors
// must re-lay out when an end changes, and answers C++ `ObjectStore::getConnections` without the
// scan over every object (§4 #9). Keyed by id, so an edge attached to a group itself is found too
// (B18c: C++ looked only at the group's members).
import type { LekhObject } from './lekh-object';

export class ConnectionDependencyMap {
  private readonly byEnd_ = new Map<string, Set<LekhObject>>();
  private readonly endsOf_ = new Map<LekhObject, readonly string[]>();
  private readonly none_: ReadonlySet<LekhObject> = new Set();

  /** Registers (or re-registers) a connector under its current `endIds()`. */
  set(connector: LekhObject): void {
    const ends = [...new Set(connector.endIds())];
    const old = this.endsOf_.get(connector);
    if (old !== undefined && old.length === ends.length && old.every((id, i) => id === ends[i])) return;
    this.delete(connector);
    this.endsOf_.set(connector, ends);
    for (const id of ends) {
      let set = this.byEnd_.get(id);
      if (set === undefined) {
        set = new Set();
        this.byEnd_.set(id, set);
      }
      set.add(connector);
    }
  }

  delete(connector: LekhObject): void {
    const ends = this.endsOf_.get(connector);
    if (ends === undefined) return;
    this.endsOf_.delete(connector);
    for (const id of ends) {
      const set = this.byEnd_.get(id);
      if (set === undefined) continue;
      set.delete(connector);
      if (set.size === 0) this.byEnd_.delete(id);
    }
  }

  has(connector: LekhObject): boolean {
    return this.endsOf_.has(connector);
  }

  /** The connectors with an end on `endId`. */
  connectorsOf(endId: string): ReadonlySet<LekhObject> {
    return this.byEnd_.get(endId) ?? this.none_;
  }

  /** Registered connectors. */
  get size(): number {
    return this.endsOf_.size;
  }

  clear(): void {
    this.byEnd_.clear();
    this.endsOf_.clear();
  }
}
