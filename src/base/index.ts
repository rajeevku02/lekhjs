// lekhjs module `base` (spec 01 §2.1). The only import target from outside the module.
export { FLICKR_BASE58, SHORT_ID_LENGTH, shortIdFromUuid } from './ids';
export type {
  Canvas2DLike,
  Clock,
  GradientLike,
  Handle,
  IdSource,
  Logger,
  MessageEventLike,
  PortLike,
  ResourceLoader,
  Scheduler,
  TextMetricsLike,
  Transferable,
  WorkerLike,
} from './ports';
export {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  EngineConfig,
  PencilBehavior,
  ScreenMode,
  type Config,
  type ConfigOverrides,
  type ConfigValues,
  type DebugConfig,
  type RenderConfig,
} from './config';
export { LekhError, isLekhError } from './errors';
export { LiveConfig } from './live-config';
export {
  SHAPE_CONNECTION_DEFAULT_GAP,
  USER_SETTINGS_FILE,
  USER_SETTINGS_KEYS,
  isValidConnectionType,
  parseUserSettings,
  serializeUserSettings,
  type UserSettingKey,
} from './user-settings';
export { Lru } from './lru';
export { Span } from './span';
export {
  COS30,
  INT_MAX,
  SIN30,
  SQRT2,
  SQRT3,
  formatG6,
  roundHalfUp,
  solveCubic,
  solveQuadEquation,
  toInt,
} from './math';
