// lekhjs module `interaction` (spec 01 §2.1, rank 13; spec 05 §1.1, spec 02 §16). The only import
// target from outside the module. The board's interaction logic with no DOM: the input model,
// the gesture recogniser, the router, the canvas mode table, the Middle overlay (handles,
// previews, rubber band), the draggers, the key map, `ShapeInteraction`, the canvas glyphs, the
// engine ↔ React contract types and `BoardView`. Never imported by the backend (spec 05 R6).
export {
  MapShapeInteractionRegistry,
  shapeHandles,
  type HitAnswer,
  type InputInfo,
  type InteractionCtx,
  type InteractionEventName,
  type InteractionSessionView,
  type KeyInput,
  type ShapeDragHandler,
  type ShapeInteraction,
  type ShapeInteractionFactory,
  type ShapeInteractionRegistry,
} from './shape-interaction';
export {
  EventName,
  GESTURE_CONSTANTS,
  Movement,
  check,
  mergeCheck,
  type EventCheck,
  type GestureListener,
  type GestureTimers,
} from './gesture-listener';
export {
  MouseButton,
  NO_MODIFIERS,
  PointState,
  PointerEvent,
  PointerType,
  eventPoint,
  isEraserTip,
  midOf,
  mouseButtonOf,
  pointOf,
  pointerTypeOf,
  type EventPoint,
  type InputEvent,
  type Modifiers,
  type PointerInput,
  type PointerKind,
  type PointerSample,
} from './input-event';
export { GestureRecognizer, type GestureRecognizerOptions } from './gesture-recognizer';
export {
  MultiTouchRecognizer,
  PointerPositions,
  RecognizerState,
  RotateRecognizer,
  ScaleRecognizer,
  ScrollRecognizer,
} from './multi-touch';
export { BaseDragger, NoOpDragger, type DragHandler } from './drag-handler';
export { DESKTOP_WEB, autoReconnectFor, isSmallScreen, type HostEnvironment } from './env';
export { InputMode, InputModeState, defaultInputMode } from './input-mode';
export { CursorState, cursorForMode, type CursorKind } from './cursor';
export {
  INTERACTION_EDIT_COMMAND,
  SessionBoard,
  dragContext,
  objectsOf,
  type InteractionBoard,
  type SessionBoardOptions,
  type ViewChange,
} from './board';
export { CanvasView } from './canvas-view';
export type { ClickTarget, RouterLayer, WheelInput } from './router-layer';
export { InputRouter, type InputRouterOptions } from './input-router';
export { InputTrace, type InputTraceSink } from './input-trace';
export { CanvasController, ON_PAN_BRANCHES, type CanvasControllerOptions, type OnPanBranch } from './canvas-controller';
export { ContextMenuModel, type ContextActionId } from './context-menu';
export { OverlayLayer, scrollPos, type OverlayOptions, type StrokeSink } from './overlay-layer';
export { OVERLAY_VALUES, overlayTokens, type OverlayTheme, type OverlayTokens } from './overlay-tokens';
export {
  CANVAS_GLYPHS,
  drawGlyph,
  glyphSvgPath,
  type Glyph,
  type GlyphId,
  type GlyphPath,
  type GlyphPaint,
} from './glyphs';
export { SelectionRectangle, rectPoints, type CornerHandle } from './selection/selection-rectangle';
export { VertexHandles } from './selection/vertex-handles';
export {
  ConnectHandle,
  canStartDrag,
  cornerHitRadius,
  handleCentres,
  hitRadius,
  overlapsCorner,
  shouldShow,
  type HandleSide,
  type Visibility,
} from './selection/connect-handles';
export {
  ShapePointType,
  type OverlayHost,
  type OverlayPaint,
  type OverlayTextPainter,
  type SelectionRectHost,
  type ShapePoint,
  type Transient,
  type VertexHandleHost,
} from './selection/types';
export {
  CanvasScaleScrollDragger,
  DrawingDragger,
  EraseCircle,
  EraseDragger,
  LaserDragger,
  LaserTrail,
  TransientStroke,
  ZoomInfo,
} from './draggers/canvas-draggers';
export {
  MultiSelectDragger,
  ResizeDragger,
  RotateDragger,
  SelectDragObject,
  SelectionDragger,
  ShapeScaleDragger,
  TextDragger,
  VertexDragger,
} from './draggers/selection-draggers';
export {
  ConnectDragger,
  ConnectMode,
  ConnectPreview,
  buildDraggedConnection,
  canvasPreviewRoute,
  draggedConnectionType,
  draggedPairNested,
  draggedTargetAt,
  fullyContains,
  isConnectable,
} from './draggers/connect-dragger';
export { KeyMap, type KeyChord, type KeyCommandId, type ShortcutRow } from './key-map';
export { CommandDispatcher, type CommandDispatcherOptions } from './commands';
export { ShapeInteractionLayer, type ShapeLayerOptions } from './shape-layer';
export { TextEditSession, type TextEditHost } from './text-edit-session';
export {
  BoardEditors,
  ColorPickerApi,
  ConnectionApi,
  PAGE_SIZES,
  PageApi,
  PropertyApi,
  SetSizeApi,
  SettingsApi,
  StyleApi,
  convertUnitSize,
  parseCssColor,
  type ColorKind,
  type ColorPickerState,
  type ConnectionState,
  type EditorHost,
  type PageRow,
  type PropertyRow,
  type SetSizeValues,
  type SettingName,
  type StyleTarget,
  type TextStyleChange,
  type UnitSize,
} from './editor-api';
export { LibraryDropHandler } from './library-drop';
export {
  RecognitionController,
  type RecognitionControllerOptions,
  type StrokeRecognizer,
} from './recognition-controller';
export { LayerScheduler, ManualFrameScheduler, type FrameScheduler } from './layer-scheduler';
export { BoardView, type BoardViewOptions } from './board-view';
export type {
  BoardCommands,
  BoardUiState,
  ConfigSnapshot,
  SelectionAction,
  SelectionActionId,
  SelectionState,
  Store,
  StyleEditorApi,
  TextEditView,
} from './ui-types';
