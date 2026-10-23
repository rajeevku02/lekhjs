// An index-range view over an array (port of C++ `base::Coll<T>`; `geometry::Points` is
// `Span<Point>`). The range is inclusive: `new Span(a, 0, a.length - 1)` covers all of `a`.

export class Span<T> {
  readonly items: readonly T[];
  private start: number;
  private end: number;

  /** The empty span is `new Span(items)` (start 1, end 0, as C++ `Coll()`). */
  constructor(items: readonly T[], start = 1, end = 0) {
    this.items = items;
    this.start = start;
    this.end = end;
  }

  /** A span over the whole array. */
  static of<T>(items: readonly T[]): Span<T> {
    return new Span(items, 0, items.length - 1);
  }

  get size(): number {
    return this.end >= this.start ? this.end - this.start + 1 : 0;
  }
  get startIndex(): number {
    return this.start;
  }
  get endIndex(): number {
    return this.end;
  }
  get empty(): boolean {
    return this.start > this.end;
  }

  at(index: number): T {
    return this.items[this.start + index] as T;
  }

  first(): T {
    return this.items[this.start] as T;
  }

  last(): T {
    return this.items[this.end] as T;
  }

  /** A sub-span `[from, to]` relative to this one, clamped to its end (C++ `Coll::slice`). */
  slice(from: number, to: number): Span<T> {
    let s = this.start + from;
    if (s > this.end) s = this.end;
    let e = this.start + to;
    if (e > this.end) e = this.end;
    return new Span(this.items, s, e);
  }

  setStartIndex(idx: number): void {
    this.start = idx;
  }
  setEndIndex(idx: number): void {
    this.end = idx;
  }

  /** The covered elements as a new array. */
  toArray(): T[] {
    return this.empty ? [] : this.items.slice(this.start, this.end + 1);
  }

  private absolute(i: number): T {
    if (i < 0 || i >= this.items.length || !Number.isInteger(i)) {
      throw new RangeError(`Span index ${String(i)} out of range`);
    }
    return this.items[i] as T;
  }
}
