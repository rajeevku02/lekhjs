// The shared line-width cache (spec 03 §8.2 level 2, spec 06 §5.2): a bounded LRU of
// `fontKey + "\u0000" + line → width`, one per `Runtime` and shared by every session on it. It is
// value-keyed and holds only strings and numbers, so sharing it is safe (spec 03 §12.4).
// Entries of an older font epoch are misses: the first access with a newer epoch drops them all.
import { Lru } from '../base';

/** Capacity decided by the owner (OQ-16); tuned after the perf run. */
export const LINE_WIDTH_CACHE_CAPACITY = 2000;

export class LineWidthCache {
  private readonly lru: Lru<string, number>;
  private epoch_ = 0;
  private hits_ = 0;
  private misses_ = 0;

  constructor(capacity: number = LINE_WIDTH_CACHE_CAPACITY) {
    this.lru = new Lru<string, number>(capacity);
  }

  get capacity(): number {
    return this.lru.capacity;
  }
  get size(): number {
    return this.lru.size;
  }
  /** The font epoch the held entries belong to. */
  get epoch(): number {
    return this.epoch_;
  }
  get hits(): number {
    return this.hits_;
  }
  get misses(): number {
    return this.misses_;
  }

  /** The cached width, or `undefined`. A newer `epoch` empties the cache first. */
  get(fontKey: string, line: string, epoch: number): number | undefined {
    this.sync(epoch);
    const w = this.lru.get(fontKey + '\u0000' + line);
    if (w === undefined) this.misses_++;
    else this.hits_++;
    return w;
  }

  set(fontKey: string, line: string, epoch: number, width: number): void {
    this.sync(epoch);
    if (epoch !== this.epoch_) return; // a write from an older epoch is dropped
    this.lru.set(fontKey + '\u0000' + line, width);
  }

  /** The width from the cache, else from `measure` (and stored). */
  width(fontKey: string, line: string, epoch: number, measure: () => number): number {
    const hit = this.get(fontKey, line, epoch);
    if (hit !== undefined) return hit;
    const w = measure();
    this.set(fontKey, line, epoch, w);
    return w;
  }

  clear(): void {
    this.lru.clear();
  }

  /** For tests: the held keys and values (strings and numbers only, AC-ENG-12). */
  entries(): [string, number][] {
    return this.lru.keys().map((k) => [k, this.lru.peek(k) ?? NaN]);
  }

  private sync(epoch: number): void {
    if (epoch > this.epoch_) {
      this.lru.clear();
      this.epoch_ = epoch;
    }
  }
}
