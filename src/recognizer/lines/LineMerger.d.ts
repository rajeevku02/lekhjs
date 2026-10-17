// Types for `LineMerger.js`, the owner's line aggregator (Work 01M4X7TCHFB862XGT68GPY071C, M1;
// spec 07 §5.4 H-REC-1). The JS file is the owner's proprietary module, shipped obfuscated: it is
// never edited, formatted or linted (see `.prettierignore` and `eslint.config.js`). This file
// declares only the API `LineAggregatorImpl` uses.
//
// The `cost` of the lines it returns is its own range class, with `RangeNumber`'s public surface
// (`start`, `end`, `add`, `divide`, `greaterThan`, `lessThan`, `equalsTo`, `isZero`); `RangeNumber`
// compares through `start`/`end` only, so the two mix.
import type { RangeNumber } from './RangeNumber';
import type { Points, StrokeLine } from './StrokeLine';

/** Segments a stroke's pre-processed points into `StrokeLine`s (C++ `LineAggregator`). */
export declare class LineMerger {
  /**
   * @param points the stroke, or null until `setPoints`
   * @param minCost the join-cost threshold (`config.lineAggregatorMaxJoinCost`)
   * @param lineClass the `StrokeLine` constructor the lines are made with
   */
  constructor(points: Points | null, minCost: number, lineClass: typeof StrokeLine);
  setPoints(points: Points): void;
  points(): Points | null;
  process(): void;
  lines(): readonly StrokeLine[];
  reset(): void;
  minCost(): number;
  setMinCost(cost: number): void;
  /**
   * The cost of fitting one straight line through `points` (C++ `LineAggregator::getCost`), as
   * the merger's own range object, which has `RangeNumber`'s public `start`/`end`.
   */
  getCost(points: Points): Pick<RangeNumber, 'start' | 'end'>;
}
