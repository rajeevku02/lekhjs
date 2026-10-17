// The stub line aggregator (spec 07 §5.2), shipped until the owner's handoff (H-REC-1). It mirrors
// the C++ stub (`LineAggreagtor.cpp:44-68`) minus its crash: no lines for any stroke, so the
// recognizer's empty-lines guard (B2) turns every stroke into plain ink.
import type { RecognizerConfig } from '../core/RecognizerConfig';
import type { LineAggregator, LineAggregatorModule } from './LineAggregatorModule';
import { RangeNumber } from './RangeNumber';
import type { Points, StrokeLine } from './StrokeLine';

/** C++ stub `LineAggregator`: `process`/`reset` do nothing, `lines()` is empty (never null). */
export class StubLineAggregator implements LineAggregator {
  private cost: number;
  private pts: Points | null = null;

  constructor(config: RecognizerConfig) {
    this.cost = config.lineAggregatorMaxJoinCost;
  }

  setPoints(points: Points): void {
    this.reset();
    this.pts = points;
  }

  /** The points last given to `setPoints` (null before), for tests. */
  points(): Points | null {
    return this.pts;
  }

  process(): void {
    // The stub finds no lines.
  }

  lines(): readonly StrokeLine[] {
    return [];
  }

  reset(): void {
    // Nothing to reset (C++ `reset()` is empty too; `setPoints` replaces the points).
  }

  minCost(): number {
    return this.cost;
  }

  setMinCost(cost: number): void {
    this.cost = cost;
  }
}

/** The stub as a module: `getCost` is `RangeNumber(0, 0)`, `isSingleLine` is false. */
export const stubLineAggregatorModule: LineAggregatorModule = Object.freeze({
  id: 'stub',
  create(config: RecognizerConfig): LineAggregator {
    return new StubLineAggregator(config);
  },
  getCost(): RangeNumber {
    return new RangeNumber(0, 0);
  },
  isSingleLine(): boolean {
    return false;
  },
});
