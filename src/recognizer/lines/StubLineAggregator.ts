// The stub line aggregator (spec 07 §5.2), shipped until the owner's handoff (H-REC-1). It mirrors
// the C++ stub (`LineAggreagtor.cpp:44-68`) minus its crash: no lines for any stroke, so the
// recognizer's empty-lines guard (B2) turns every stroke into plain ink.
import type { RecognizerConfig } from '../core/RecognizerConfig';
import type { LineAggregator, LineAggregatorModule } from './LineAggregatorModule';
import { RangeNumber } from './RangeNumber';
import type { Points, StrokeLine } from './StrokeLine';
import { LineMerger } from "./LineMerger";

/** C++ stub `LineAggregator`: `process`/`reset` do nothing, `lines()` is empty (never null). */
export class StubLineAggregator implements LineAggregator {
  // @ts-ignore
  private lineMerger: LineMerger | null = null;

  constructor(config: RecognizerConfig) {
    this.lineMerger = new LineMerger(null, config.lineAggregatorMaxJoinCost, StrokeLine);
  }

  setPoints(points: Points): void {
    this.lineMerger.setPoints(points);
  }

  points(): Points | null {
    return this.lineMerger.points();
  }

  process(): void {
    this.lineMerger.process();
  }

  lines(): readonly StrokeLine[] {
    return this.lineMerger.lines();
  }

  reset(): void {
    this.lineMerger.reset();
  }

  minCost(): number {
    return this.lineMerger.minCost();
  }

  setMinCost(cost: number): void {
    this.lineMerger.setMinCost(cost);
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
