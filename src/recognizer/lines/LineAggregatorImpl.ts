// The owner's line aggregator (spec 07 §5.4, H-REC-1; Work 01M4X7TCHFB862XGT68GPY071C, M1): the
// production `LineAggregatorModule`, bound as `defaultLineAggregatorModule` in `lines/index.ts`.
// The algorithm is `LineMerger.js`, the owner's proprietary module (obfuscated; typed by
// `LineMerger.d.ts`, never edited). This class only delegates to it.
import type { RecognizerConfig } from '../core/RecognizerConfig';
import type { LineAggregator, LineAggregatorModule } from './LineAggregatorModule';
import { RangeNumber } from './RangeNumber';
import { StrokeLine, type Points } from './StrokeLine';
import { LineMerger } from './LineMerger';

/** The owner's `LineAggregator`: a per-job `LineMerger`. */
export class LineAggregatorImpl implements LineAggregator {
  private readonly lineMerger: LineMerger;

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

/**
 * The owner's module, recorded as `ready.lineAggregator` and as the parity MANIFEST
 * `lineAggregatorId` (AC-REC-33). `getCost` is `LineMerger`'s own (C++ `LineAggregator::getCost`),
 * on a fresh merger per call so it depends on no `create()`d state; `LineMerger` has no
 * `isSingleLine`, so that keeps the stub's answer (false).
 */
export const lineAggregatorImplModule: LineAggregatorModule = Object.freeze({
  id: 'lekh-line-merger-1',
  create(config: RecognizerConfig): LineAggregator {
    return new LineAggregatorImpl(config);
  },
  getCost(points: Points): RangeNumber {
    const cost = new LineMerger(null, 0, StrokeLine).getCost(points);
    return new RangeNumber(cost.start, cost.end);
  },
  isSingleLine(): boolean {
    return false;
  },
});
