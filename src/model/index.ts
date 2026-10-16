// lekhjs module `model` (spec 01 §2.1). The only import target from outside the module.
// The document, its pages and their object stores: the spatial index, the id and dependency maps,
// the hit tests, the layout tracker and the culled paint (spec 03 §2-§7, §13). The object kinds
// extend `LekhObject`.
export {
  LayoutState,
  LekhObject,
  ObjectKind,
  type ImageLookup,
  type IndexItem,
  type LayoutEnv,
  type LayoutGeometry,
  type LayoutOwner,
  type LayoutServices,
  type PaintEnv,
  type SceneQuery,
  type AlignmentPoints,
  type Delta2,
  type ModificationContext,
  type MovableTextInfo,
  type TextEditResult,
} from './lekh-object';
export { isConnector, isFreehand, isGroup, isTemplated } from './kinds';
export { INDEX_MAX_ENTRIES, SpatialIndex } from './spatial-index';
export { ConnectionDependencyMap } from './connection-dependency-map';
export { LayoutTracker, type LayoutHost } from './layout-tracker';
export { OrderAllocator, type Ordered } from './order-allocator';
export { HitTester, type ContainingOptions, type HitScene, type NearObject } from './hit-tester';
export { ObjectStore, type IdEntry, type ObjectStoreOptions } from './object-store';
export { BackgroundType, OLD_GRID_BACKGROUND, OLD_GRID_BACKGROUND_2, PageBackground } from './page-background';
export {
  CanvasSizeType,
  DEFAULT_PIXELS_PER_INCH,
  Orientation,
  Page,
  PageSize,
  type CanvasSize,
  type MarginDrawInfo,
  type PageMargin,
  type PagePaintOptions,
} from './page';
export { DocumentInfo } from './document-info';
export { LekhDocument, type DocumentContext, type GridSettings } from './lekh-document';
export { ImageRefs, ImageRequests, type ImageRequestPort, type ImageRequestsOptions } from './image-refs';
export { skipTextAtLowZoom } from './low-zoom';
export { OPEN_ARROW_ID, SOLID_ARROW_ID, type ObjectEnv } from './object-env';
export { snapNumber, snapRectToGrid } from './snap';
export { ArrowHeads, ArrowLocation, type ArrowAt } from './arrow-heads';
export { TemplatedObject, type FlipResult } from './templated-object';
export { UnrecognizedObject } from './unrecognized-object';
export { GroupObject, type ContainedObject } from './group-object';
export { MultiObjects, type MultiObjectInfo } from './multi-objects';
export { modificationContext } from './modification';
export { PathPlacement, type ViewMapping } from './path-placement';
export { lowZoomTextFilter } from './low-zoom';
export {
  AutoType,
  ConnectionParam,
  ConnectionType,
  ConnectorTextInfo,
  cloneParams,
  type ParamMap,
  type Params,
  type RouteHost,
  type VertexEdit,
} from './connection/types';
export { ConnectionObject, type DrawCounters } from './connection/connection-object';
export { Connection } from './connection/connection';
export { LineConnection } from './connection/line-connection';
export { GenericLineConnection } from './connection/generic-line-connection';
export { CurveConnection } from './connection/curve-connection';
export { PathConnection } from './connection/path-connection';
export { ConnectionEndPoint, CurveConnectionEndPoint, LineConnectionEndPoint } from './connection/end-point';
export { ConnectionPoint, LineAlign, RouteLine } from './connection/route-line';
export { LineGenerator } from './connection/line-generator';
export {
  Bend,
  SelfLoopError,
  Side,
  SideRelation,
  allowsSelfLoop,
  attachPoint,
  relationOf,
  selfLoopDefaults,
  selfLoopParams,
  sideAngle,
  sideOfAngle,
  worldSideOf,
  type SelfLoopOptions,
} from './connection/self-loop';
