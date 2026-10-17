// recognizer/client: the main-thread half of recognition (spec 07 §6.4-§6.6): the worker client,
// the snapshot builder, the mutation applier, the session port and the board's stroke recogniser.
export { ELLIPSE_TEMPLATE_ID, shapeToLekh, type RecognizedObjectSpec } from './ShapeToLekh';
export {
  RecognitionClient,
  type CapturedStroke,
  type RecognitionClientEvent,
  type RecognitionClientOptions,
  type RecognitionSessionPort,
} from './RecognitionClient';
export {
  SNAPSHOT_MIN_INFLATE,
  SceneSnapshotBuilder,
  snapshotRegion,
  strokeBounds,
  type BuiltSnapshot,
  type SnapshotSource,
} from './SceneSnapshotBuilder';
export {
  MutationApplier,
  NO_STATS,
  referencedIds,
  shapeToCanvas,
  type AppliedJob,
  type ApplyOutcome,
  type MutationApplierOptions,
  type RecognitionStats,
} from './MutationApplier';
export {
  SessionRecognitionPort,
  type SessionRecognitionPortOptions,
  type SessionStroke,
} from './SessionRecognitionPort';
export { SessionStrokeRecognizer } from './SessionStrokeRecognizer';
