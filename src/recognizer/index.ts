// lekhjs module `recognizer` (spec 01 §2.1). The only import target from outside the module.
export {
  createRecognizerContext,
  RECOGNIZER_CONFIG_DEFAULTS,
  recognizerConfigFrom,
  recognizerConfigWith,
  type RecognizerConfig,
  type RecognizerContext,
  type RecognizerQuirks,
} from './core';
export {
  defaultLineAggregatorModule,
  stubLineAggregatorModule,
  type LineAggregator,
  type LineAggregatorModule,
} from './lines';
