// Grows convex polys generation by generation (port of C++ `recognizer::CxPolyAggregator`).
//
// Same polys, in the same order, as C++ (AC-REC-07, AC-REC-08), with the result-preserving
// speed-ups of spec 07 §4.1: line-id bitmasks (R1), dedupe of a candidate before anything is
// copied (R2), shared-tail nodes (R3), O(k) equality (R4) and turn tests without `acos` (R5).
// The count budget is C++'s: `produced` counts the one-line polys, every closed extension and
// every new open poly that survives dedupe; past `cxPolyMaxPolys` the search stops with
// `budgetExceeded()`. Dropped: the `dump*` debug output.
import type { LineColl } from '../lines/LineColl';
import { LinePart, type StrokeLine } from '../lines/StrokeLine';
import { CxPoly } from './CxPoly';
import type { PolyEnv } from './PolyFeatures';
import { PolyNode } from './PolyNode';

export class CxPolyAggregator {
  private readonly lineColl: LineColl;
  private readonly env: PolyEnv;
  private readonly maxPolys: number;
  private curPolys: PolyNode[] = [];
  private donePolys: PolyNode[] = [];
  private produced = 0;
  private exceeded = false;

  constructor(coll: LineColl, env: PolyEnv) {
    this.lineColl = coll;
    this.env = env;
    this.maxPolys = env.config.cxPolyMaxPolys;
  }

  process(): void {
    this.init();
    while (this.extend()) {
      // generation after generation
    }
  }

  /** The finished polys in C++ order, materialised. */
  polys(): CxPoly[] {
    return this.donePolys.map((n) => new CxPoly(this.env, n.materialize(), n.turnDir, n.closed));
  }

  /** The finished polys as nodes (tests). */
  nodes(): readonly PolyNode[] {
    return this.donePolys;
  }

  budgetExceeded(): boolean {
    return this.exceeded;
  }

  /** Polys counted against the budget. */
  producedCount(): number {
    return this.produced;
  }

  private init(): void {
    const lines: readonly StrokeLine[] = this.lineColl.lines();
    this.curPolys = lines.map((line) => PolyNode.root(new LinePart(line)));
    this.donePolys = [];
    this.produced = lines.length;
    this.exceeded = false;
  }

  private extend(): boolean {
    const next: PolyNode[] = [];
    // Dedupe of the next generation: equal polys have equal masks, so a candidate is compared
    // only with the accepted polys of its mask, and the first occurrence is kept — the order of
    // a linear scan.
    const buckets = new Map<number, PolyNode[]>();
    const delta = this.env.config.linePartEqualityDelta;

    for (const poly of this.curPolys) {
      const extended = poly.extend(this.lineColl);
      let byTrimming = true;
      for (const item of extended) {
        const cand = item.poly;
        if (cand.closed) {
          this.donePolys.push(cand);
          this.produced++;
        } else {
          let bucket = buckets.get(cand.mask);
          if (bucket === undefined) {
            bucket = [];
            buckets.set(cand.mask, bucket);
          }
          if (!bucket.some((p) => p.equals(cand, delta))) {
            bucket.push(cand);
            next.push(cand);
            this.produced++;
          }
        }
        byTrimming = byTrimming && item.byTrimming;
      }
      // Not a new poly: it was counted when it was produced.
      if (extended.length === 0 || byTrimming) this.donePolys.push(poly);
      if (this.produced > this.maxPolys) {
        // The search is exponential in the line count; give up rather than run on.
        this.exceeded = true;
        break;
      }
    }
    this.curPolys = [];
    if (this.exceeded) return false;
    this.curPolys = next;
    return this.curPolys.length > 0;
  }
}
