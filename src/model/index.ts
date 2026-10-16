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
