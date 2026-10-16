// A bounded least-recently-used map. New code (spec 02 Appendix A code R: the C++ `Lru` is
// unused). It backs `LineWidthCache` and the image cache; it never holds more than `capacity`
// entries.

export class Lru<K, V> {
  private readonly map = new Map<K, V>();
  private cap: number;

  constructor(capacity: number) {
    if (!(capacity >= 1) || !Number.isInteger(capacity)) {
      throw new RangeError(`Lru capacity must be a positive integer, got ${String(capacity)}`);
    }
    this.cap = capacity;
  }

  get capacity(): number {
    return this.cap;
  }
  get size(): number {
    return this.map.size;
  }

  /** True when `key` is held. Does not refresh its recency. */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /** The value for `key`, which becomes the most recently used; `undefined` when absent. */
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  /** The value for `key` without refreshing its recency. */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  /** Stores `value` as the most recently used entry, evicting the least recently used ones. */
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    this.evict();
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /** Changes the capacity, evicting down to it. */
  setCapacity(capacity: number): void {
    if (!(capacity >= 1) || !Number.isInteger(capacity)) {
      throw new RangeError(`Lru capacity must be a positive integer, got ${String(capacity)}`);
    }
    this.cap = capacity;
    this.evict();
  }

  /** Keys from least to most recently used. */
  keys(): K[] {
    return [...this.map.keys()];
  }

  private evict(): void {
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next();
      if (oldest.done === true) break;
      this.map.delete(oldest.value);
    }
  }
}
