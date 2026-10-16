// lekhjs module `recognizer` (spec 01 §2.1). The only import target from outside the module.
export {
  createRecognizerContext,
  recognizeStroke,
  RECOGNIZER_CONFIG_DEFAULTS,
  recognizerConfigFrom,
  recognizerConfigWith,
  type RecognizerConfig,
  type RecognizerContext,
  type RecognizerQuirks,
  type RecognitionOutcome,
  type RecognizeStrokeOptions,
  type RecordingDelegate,
  type StageDump,
} from './core';
export {
  RecordingCanvasDelegate,
  snapshotDelegate,
  SnapshotCanvasDelegate,
  type CanvasDelegate,
  type ObjectId,
  type RecMutation,
  type RecShapeDTO,
  type SceneStore,
} from './delegate';
export { shapeToLekh, type RecognizedObjectSpec } from './client';
export {
  defaultLineAggregatorModule,
  stubLineAggregatorModule,
  type LineAggregator,
  type LineAggregatorModule,
} from './lines';
