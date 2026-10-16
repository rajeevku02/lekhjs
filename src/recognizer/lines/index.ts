// recognizer/lines: stroke lines, their collection and relations, and the LineAggregator seam.
import type { LineAggregatorModule } from './LineAggregatorModule';
import { stubLineAggregatorModule } from './StubLineAggregator';

export type { LineAggregator, LineAggregatorModule } from './LineAggregatorModule';
export { StubLineAggregator, stubLineAggregatorModule } from './StubLineAggregator';
export { Probability, ProbabilityType, RangeNumber } from './RangeNumber';
export {
  copyPoints,
  LinePart,
  LinePoint,
  Parts,
  SegmentDir,
  StrokeLine,
  type ExtensionPoint,
  type PartRange,
  type Points,
} from './StrokeLine';

/**
 * The aggregator the recognizer uses when the job does not inject one. Bound to the stub until
 * the owner's `LineAggregatorImpl` lands (H-REC-1); then this line changes to that module.
 */
export const defaultLineAggregatorModule: LineAggregatorModule = stubLineAggregatorModule;
