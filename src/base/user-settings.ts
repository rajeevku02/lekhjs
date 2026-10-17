// The user's settings file (port of C++ `app::Settings`, `L/app/Settings.cpp`): the JSON a host
// keeps at `settings/lekhsettings` (web: `localStorage['files:settings/lekhsettings']`; native:
// the documents directory, through `LekhPlugin.readFile`/`writeFile`). `parseUserSettings` is
// `Settings::apply`, `serializeUserSettings` is `Settings::serialize`; the keys, their types and
// their validity rules are the C++ ones, so a file either build wrote reads in the other.
import type { ConfigOverrides, ConfigValues } from './config';

/** C++ `Settings.cpp` `shapeConnectionDefaultGap`: the gap when "Gap between shape and connection line" is on. */
export const SHAPE_CONNECTION_DEFAULT_GAP = 2;

/** The settings file's path under the documents root (C++ `settingsFile`). */
export const USER_SETTINGS_FILE = 'settings/lekhsettings';

/** The JSON keys (C++ `Settings.cpp:23-37`). */
export const USER_SETTINGS_KEYS = Object.freeze({
  snapObjects: 'snap_objects',
  recognizeConnections: 'recognize_connections',
  resizeInsertedImage: 'resize_inserted_image',
  defaultArrowType: 'default_arrow_type',
  defaultConnectionType: 'default_connection_type',
  showConnectionHandles: 'show_connection_handles',
  pencilBehavior: 'pencil_behavior',
  onlyDrawWithPencil: 'only_draw_with_pencil',
  resizeShapeByZoomGesture: 'resize_shape_by_zoom_gesture',
  shapeConnectionGap: 'shape_connection_gap',
  screenMode: 'screen_display_mode',
  infoButton: 'info_button',
  airGesture: 'air_gesture',
  preventScreenToTurnOff: 'prevent_screen_turning_off',
  defaultFontSize: 'default_font_size',
} as const);

/** The config fields the settings file carries. */
export type UserSettingKey =
  | 'snapToGrid'
  | 'recognizeConnection'
  | 'resizeInsertedImage'
  | 'defaultArrowType'
  | 'defaultConnectionType'
  | 'showConnectionHandles'
  | 'pencilBehavior'
  | 'onlyDrawWithPencil'
  | 'resizeShapeByZoomGesture'
  | 'connectionLineSeparationFromObject'
  | 'screenMode'
  | 'shouldShowInfoButton'
  | 'enableAirGesture'
  | 'preventScreenToTurnOff'
  | 'defaultFontSize';

/** C++ `Settings::isValidConnectionType`: Curve 0, GenericLine 1, MultiLine 2. */
export function isValidConnectionType(t: number): boolean {
  return Number.isInteger(t) && t >= 0 && t <= 2;
}

function obj(content: string): Record<string, unknown> | null {
  if (content.trim() === '') return null;
  try {
    const v: unknown = JSON.parse(content);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * C++ `Settings::apply(content, isDesktop)`: the platform defaults (connection handles shown on
 * desktop hosts only), then every valid stored value. Unknown keys and values of the wrong type
 * are ignored, as `JsonNode::getField` did.
 */
export function parseUserSettings(content: string, isDesktop: boolean): ConfigOverrides {
  const out: ConfigOverrides = { showConnectionHandles: isDesktop };
  const node = obj(content);
  if (node === null) return out;
  const K = USER_SETTINGS_KEYS;
  const bool = (k: string): boolean | undefined => (typeof node[k] === 'boolean' ? node[k] : undefined);
  const int = (k: string): number | undefined => {
    const v = node[k];
    return typeof v === 'number' && Number.isInteger(v) ? v : undefined;
  };
  const num = (k: string): number | undefined => {
    const v = node[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const set = <F extends UserSettingKey>(f: F, v: ConfigValues[F] | undefined): void => {
    if (v !== undefined) (out as Record<string, unknown>)[f] = v;
  };
  set('snapToGrid', bool(K.snapObjects));
  set('recognizeConnection', bool(K.recognizeConnections));
  set('resizeInsertedImage', bool(K.resizeInsertedImage));
  set('resizeShapeByZoomGesture', bool(K.resizeShapeByZoomGesture));
  const gap = bool(K.shapeConnectionGap);
  if (gap !== undefined) out.connectionLineSeparationFromObject = gap ? SHAPE_CONNECTION_DEFAULT_GAP : 0;
  set('onlyDrawWithPencil', bool(K.onlyDrawWithPencil));
  set('shouldShowInfoButton', bool(K.infoButton));
  set('enableAirGesture', bool(K.airGesture));
  set('preventScreenToTurnOff', bool(K.preventScreenToTurnOff));
  set('showConnectionHandles', bool(K.showConnectionHandles));
  set('defaultArrowType', int(K.defaultArrowType));
  const ct = int(K.defaultConnectionType);
  if (ct !== undefined && isValidConnectionType(ct)) out.defaultConnectionType = ct;
  set('pencilBehavior', int(K.pencilBehavior));
  const sm = int(K.screenMode);
  if (sm !== undefined && sm >= 0 && sm <= 2) out.screenMode = sm;
  const fs = num(K.defaultFontSize);
  if (fs !== undefined && fs > 0 && fs < 1000) out.defaultFontSize = fs;
  return out;
}

/** C++ `Settings::serialize`: the file's text for `config`, keys in the C++ order. */
export function serializeUserSettings(config: Readonly<Pick<ConfigValues, UserSettingKey>>): string {
  const K = USER_SETTINGS_KEYS;
  return JSON.stringify({
    [K.snapObjects]: config.snapToGrid,
    [K.recognizeConnections]: config.recognizeConnection,
    [K.resizeInsertedImage]: config.resizeInsertedImage,
    [K.defaultArrowType]: config.defaultArrowType,
    [K.defaultConnectionType]: config.defaultConnectionType,
    [K.showConnectionHandles]: config.showConnectionHandles,
    [K.pencilBehavior]: config.pencilBehavior,
    [K.onlyDrawWithPencil]: config.onlyDrawWithPencil,
    [K.resizeShapeByZoomGesture]: config.resizeShapeByZoomGesture,
    [K.shapeConnectionGap]: config.connectionLineSeparationFromObject > 0,
    [K.screenMode]: config.screenMode,
    [K.infoButton]: config.shouldShowInfoButton,
    [K.airGesture]: config.enableAirGesture,
    [K.preventScreenToTurnOff]: config.preventScreenToTurnOff,
    [K.defaultFontSize]: config.defaultFontSize,
  });
}
