// recognizer/lines: stroke lines, their collection and relations, and the LineAggregator seam.
import { lineAggregatorImplModule } from './LineAggregatorImpl';
import type { LineAggregatorModule } from './LineAggregatorModule';

export type { LineAggregator, LineAggregatorModule } from './LineAggregatorModule';
export { LineAggregatorImpl, lineAggregatorImplModule } from './LineAggregatorImpl';
export { StubLineAggregator, stubLineAggregatorModule } from './StubLineAggregator';
export { ConnectionInfo, Line2Line } from './Line2Line';
export { LineColl, lineBit, MAX_LINES } from './LineColl';
export { LineRelation } from './LineRelation';
export { Probability, ProbabilityType, RangeNumber } from './RangeNumber';
export {
  areAlmostEqual,
  areComparableLength,
  at,
  canClose,
  getConnectDistance,
  getErrSize,
  getErrSize2,
  getErrSizeForLine,
  isNegligible,
  RecInternalError,
  RecognizerUtil,
} from './RecognizerUtil';
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
 * The aggregator the recognizer uses when the job does not inject one: the owner's
 * `LineAggregatorImpl` (H-REC-1, M1). The stub stays exported for tests that need no lines.
 */
export const defaultLineAggregatorModule: LineAggregatorModule = lineAggregatorImplModule;
