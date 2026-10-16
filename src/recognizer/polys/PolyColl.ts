// The polys of a line collection (port of C++ `recognizer::PolyColl`): the search (in-order or
// all-nearby, as the `LineColl` is set), the split of polys that double back, and the removal of
// the line ranges a taken poly used. Dropped as dead in the live pipeline (spec 07 §2.1):
// `takeOut`, `takeOutClosed`, `takeOutCurve`, `takeOutNear`, `setPolyExtensionSplitting`,
// `recognizeShapes`, `dump`.
import type { LineColl } from '../lines/LineColl';
import { Parts } from '../lines/StrokeLine';
import { CxPoly } from './CxPoly';
import { CxPolyAggregator } from './CxPolyAggregator';
import type { PolyEnv } from './PolyFeatures';
import { PolySplitter } from './PolySplitter';

export class PolyColl {
  readonly env: PolyEnv;
  private items: CxPoly[] = [];
  private coll: LineColl | null = null;
  private idSeq = 0;
  private exceeded = false;

  constructor(env: PolyEnv) {
    this.env = env;
  }

  setLines(lc: LineColl): void {
    this.reset();
    this.coll = lc;
  }

  lineColl(): LineColl | null {
    return this.coll;
  }

  polys(): readonly CxPoly[] {
    return this.items;
  }

  budgetExceeded(): boolean {
    return this.exceeded;
  }

  reset(): void {
    this.items = [];
    this.exceeded = false;
  }

  /** C++ `process()`: run `CxPolyAggregator` over the lines and number the polys 1, 2, …. */
  process(): void {
    if (this.coll === null) throw new Error('PolyColl.process() before setLines()');
    const aggr = new CxPolyAggregator(this.coll, this.env);
    aggr.process();
    this.items = aggr.polys();
    this.exceeded = aggr.budgetExceeded();
    this.assignIds();
  }

  /** C++ `splitExtensions()`: every poly split by `PolySplitter`, renumbered in order. */
  splitExtensions(): void {
    this.idSeq = 1;
    const polys = this.items;
    this.items = [];
    for (const item of polys) {
      item.id = this.idSeq;
      this.idSeq++;
      const splits = new PolySplitter(item).split();
      if (splits.length === 0) {
        this.items.push(item);
      } else {
        for (const pl of splits) {
          pl.id = this.idSeq;
          this.idSeq++;
          this.items.push(pl);
        }
      }
    }
  }

  /** C++ `remove(poly)`: cut the ranges `poly` uses out of every poly in the collection. */
  remove(poly: CxPoly): void {
    const used = new Map<number, Parts>();
    for (const line of poly.lines) {
      const id = line.line.id;
      let parts = used.get(id);
      if (parts === undefined) {
        parts = new Parts();
        used.set(id, parts);
      }
      parts.parts.push([line.start, line.end]);
    }
    this.items = this.getPolysRemovingUsed(used);
  }

  /** C++ `getPolysRemovingUsed`: the lines are visited in id order (C++ `std::map`). */
  private getPolysRemovingUsed(used: ReadonlyMap<number, Parts>): CxPoly[] {
    let input = this.items;
    const ids = [...used.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const parts = used.get(id) as Parts;
      const output: CxPoly[] = [];
      for (const pl of input) {
        for (const piece of CxPoly.split(pl, id, parts)) {
          if (piece.id === 0) {
            piece.id = this.idSeq;
            this.idSeq++;
          }
          output.push(piece);
        }
      }
      input = output;
    }
    return input.slice();
  }

  /** C++ `hasOverlap`: some part of a poly in `polys1` overlaps a part in `polys2` by `threshold`. */
  hasOverlap(polys1: readonly CxPoly[], polys2: readonly CxPoly[], threshold: number): boolean {
    for (const poly1 of polys1) {
      for (const poly2 of polys2) {
        for (const lp1 of poly1.lines) {
          for (const lp2 of poly2.lines) {
            if (lp1.overlapSize(lp2) >= threshold) return true;
          }
        }
      }
    }
    return false;
  }

  /** C++ `assignIds()`: 1, 2, … in order. */
  assignIds(): void {
    this.idSeq = 1;
    for (const poly of this.items) {
      poly.id = this.idSeq;
      this.idSeq++;
    }
  }
}
