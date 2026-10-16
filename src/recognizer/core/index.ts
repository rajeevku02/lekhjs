// recognizer/core: the per-job context and config, and the pipeline stages built on lines/polys.
export {
  BUDGET_LOG_LINE,
  detectClosedShape,
  type ClosedShapeCandidate,
  type ClosedShapeResult,
  type ClosedShapeStage,
} from './detectClosedShape';
export {
  RECOGNIZER_CONFIG_DEFAULTS,
  RECOGNIZER_CONFIG_KEYS,
  recognizerConfigFrom,
  recognizerConfigWith,
  type RecognizerConfig,
} from './RecognizerConfig';
export {
  createRecognizerContext,
  type CollectingRecognizerContext,
  type RecognizerContext,
  type RecognizerContextInit,
  type RecognizerCounters,
  type RecognizerQuirks,
} from './RecognizerContext';
