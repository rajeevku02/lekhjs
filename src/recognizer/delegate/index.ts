// recognizer/delegate: the scene contract the recognizer talks to, the recording wrapper that turns
// its mutations into data, and the worker's snapshot-backed query half.
export {
  ExistingShape,
  ExistingShapeType,
  FetchShapeType,
  type ArrowObjectInfo,
  type ArrowOperationInfo,
  type ArrowPoint,
  type CanvasDelegate,
  type ConnectionDetail,
  type DoubleLineArrowParam,
  type ObjectForConnection,
  type ParamMap,
  type Params,
} from './CanvasDelegate';
export type { ObjectId, Pt, RecMutation, RecPathComponent, RecShapeDTO, Seg } from './RecMutation';
export { flattenPoints, RecordingCanvasDelegate, shapeToDTO, type SceneQueries } from './RecordingCanvasDelegate';
export type { SceneArrowEnd, SceneArrowObject, SceneConnection, SceneStore, ViewTransform } from './SceneStore';
export {
  pathToView,
  rectToView,
  snapshotDelegate,
  SnapshotCanvasDelegate,
  toCanvas,
  toView,
  type SnapshotCanvasDelegateInit,
} from './SnapshotCanvasDelegate';
