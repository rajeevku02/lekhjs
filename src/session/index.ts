// lekhjs module `session` (spec 01 §2.1, rank 11). The only import target from outside the module.
// The runtime (one per realm), the board session (one per board) with its serial event queue, the
// session contract (`ports.ts`, spec 01 §4.2), the UI requests (spec 05 §6.3), repaint
// coalescing and the cooperative budget (spec 03 §12).
export { createRuntime, RANDOM_IDS, SILENT_LOGGER, SYSTEM_CLOCK, type Runtime, type RuntimeOptions } from './runtime';
export { BoardSession, type RecognitionApplier } from './board-session';
export type { CommandContext, CommandHandler, EditCommand } from './commands';
export { DeadlineBudget } from './budget';
export { PaintRequests } from './paint-requests';
export { styleSnapshotOf } from './style-snapshot';
export { SessionDiagnostics, type DiagnosticEvents } from './diagnostics';
export type {
  AbortSignalLike,
  BoardMeta,
  BoardPermission,
  Budget,
  Canvas2DLike,
  CanvasFactory,
  Clock,
  DecodedImage,
  FontDataProvider,
  FontLoader,
  GradientLike,
  Handle,
  IdSource,
  ImagePort,
  LoadFailure,
  LoadFailureDetails,
  LoadResult,
  Logger,
  PaintLayer,
  ReadonlyDoc,
  ResourceLoader,
  Scheduler,
  SessionEvent,
  SessionEvents,
  SessionOptions,
  SettingsStore,
  TemplateJson,
  TextMeasurer,
  TextMetricsLike,
  Transport,
  TransportState,
  TransportStateName,
  ViewState,
} from './ports';
export type {
  ContextAction,
  DialogRequest,
  DialogResponse,
  OpenViewKind,
  OrMixed,
  OrNone,
  PickedImage,
  ShapePickerRequest,
  StyleSnapshot,
  ToastRequest,
  UiRequests,
} from './ui';
