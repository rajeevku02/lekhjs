// Stacking-order and page-order values (spec 02 `OrderAllocator`). The C++ formulas are kept
// (B12): `prev ± 100 ± (now % 100)` milliseconds of a steady clock, which here is the injected
// `Clock` (`ObjectStore::getNextOrder` / `getPrevOrder`, `ObjectStore.cpp:931-965`;
// `LekhDocument::getPageOrderForIndex`, `LekhDocument.cpp:160-195`). Orders are integers (C++
// `long`); an order of 0 means "not set", so neither function returns it.
import type { Clock } from '../base';

/** Something with an order and an id: a page or an object. */
export interface Ordered {
  readonly id: string;
  order: number;
}

export class OrderAllocator {
  private readonly clock_: Clock;

  constructor(clock: Clock) {
    this.clock_ = clock;
  }

  /** `milli % 100` of the C++ steady clock. */
  private delta(): number {
    return Math.floor(this.clock_.now()) % 100;
  }

  /** C++ `getNextOrder`: after `last` (the store's last order; 0 for an empty store). */
  next(last = 0): number {
    const next = last + 100 + this.delta();
    return next === 0 ? 1 : next;
  }

  /** C++ `getPrevOrder`: before `first` (the store's first order; 0 for an empty store). */
  prev(first = 0): number {
    const prev = first - 100 - this.delta();
    return prev === 0 ? -1 : prev;
  }

  /**
   * C++ `LekhDocument::getPageOrderForIndex`: an order that puts a new page at `idx` of `pages`
   * (sorted by order). When the neighbours are adjacent integers, the pages from `idx` on are
   * renumbered; each new order is written to the page and recorded in `changes` (id → order).
   */
  pageOrderForIndex(pages: readonly Ordered[], idx: number, changes: Map<string, number>): number {
    const first = pages[0];
    const last = pages[pages.length - 1];
    if (first === undefined || last === undefined) return 100;
    if (idx <= 0) return first.order - 100 - this.delta();
    if (idx >= pages.length) return last.order + 100 + this.delta();

    const ord1 = (pages[idx - 1] as Ordered).order;
    const ord2 = (pages[idx] as Ordered).order;
    if (Math.abs(ord2 - ord1) > 1) return Math.trunc((ord1 + ord2) / 2);

    const order = ord1 + 100 + this.delta();
    let prev = order;
    for (let i = idx; i < pages.length; i++) {
      const cur = prev + 100 + this.delta();
      const page = pages[i] as Ordered;
      page.order = cur;
      changes.set(page.id, cur);
      prev = cur;
    }
    return order;
  }
}
