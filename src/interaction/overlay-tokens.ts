// The colours and sizes the overlay paints with (the C++ `Colors` / `Values` entries the Middle
// widgets read, `L/object/widget/WidgetStyle.cpp`), light and dark. One table, so the overlay and
// the React board tokens (`--lk-*`, spec 05 §7.4) are generated from the same values.
import { Color, Style } from '../style';

export type OverlayTheme = 'light' | 'dark';

export interface OverlayTokens {
  /** `selection_rectangle_corner_color` (= `system_label_color`, light). */
  readonly cornerColor: Color;
  /** `system_background_color`. */
  readonly backgroundColor: Color;
  /**
   * The fill of a connect handle's ring: `system_background_color` of the LIGHT theme in both,
   * as `selection_rectangle_corner_color` takes `system_label_color`'s light value in both
   * (WidgetStyle.cpp:374), so the dot always sits on a white ring. C++ `ConnectHandleWidget::draw`
   * fills the ring with the theme's own `system_background_color` (ConnectHandleWidget.cpp:73),
   * black in dark mode: ring, stroke and dot all black, one solid disc (owner round UF2).
   */
  readonly connectRingFill: Color;
  /** `connect_target_highlight_color`. */
  readonly connectTargetColor: Color;
  /** `scroll_indicator_color`. */
  readonly scrollIndicatorColor: Color;
  /** `Config::resizeIndicatorColor` (0xfff0f0f0). */
  readonly resizeIndicatorColor: Color;
  /** The selection rectangle and vertex handle stroke (a widget's default drawing profile). */
  readonly selectionStroke: Color;
  /** `SelectDragObject`: the rubber band. */
  readonly rubberBandStroke: Color;
  readonly rubberBandFill: Color;
  /** `LaserCircleWidget`. */
  readonly laserFill: Color;
  /** `lekhapp.ui.zoom_info`: fill -436207616, white text. */
  readonly zoomInfoFill: Color;
  readonly zoomInfoText: Color;
  /** `system_gray_color` / `system_gray2_color` of the pointer trackers. */
  readonly remotePointerStroke: Color;
  readonly remotePointerFill: Color;
}

const LIGHT: OverlayTokens = Object.freeze({
  cornerColor: new Color(0, 0, 0),
  backgroundColor: new Color(255, 255, 255),
  connectRingFill: new Color(255, 255, 255),
  connectTargetColor: new Color(0, 113, 227),
  scrollIndicatorColor: new Color(100, 100, 100, 180),
  resizeIndicatorColor: Color.fromInt(0xfff0f0f0),
  selectionStroke: new Color(0, 0, 0),
  rubberBandStroke: new Color(0, 100, 255),
  rubberBandFill: new Color(0, 100, 255, 50),
  laserFill: new Color(200, 0, 0, 200),
  zoomInfoFill: Color.fromInt(-436207616),
  zoomInfoText: new Color(255, 255, 255),
  remotePointerStroke: new Color(142, 142, 147),
  remotePointerFill: new Color(174, 174, 178),
});

const DARK: OverlayTokens = Object.freeze({
  ...LIGHT,
  backgroundColor: new Color(0, 0, 0),
  connectTargetColor: new Color(64, 156, 255),
  scrollIndicatorColor: new Color(160, 160, 160, 180),
  remotePointerStroke: new Color(142, 142, 147),
  remotePointerFill: new Color(99, 99, 102),
});

export function overlayTokens(theme: OverlayTheme): OverlayTokens {
  return theme === 'dark' ? DARK : LIGHT;
}

/** The `Values` the overlay reads, by screen size (C++ index 0 small, 1-2 big). */
export const OVERLAY_VALUES = Object.freeze({
  scrollIndicatorShowMs: 500,
  scrollIndicatorGap: Object.freeze({ small: 4, big: 5 }),
  scrollIndicatorWidth: Object.freeze({ small: 3, big: 4 }),
  /** `ConnectHandleWidget` drawn sizes (view px). */
  connectRingRadius: 6,
  connectDotRadius: 3.5,
  /** `ConnectPreview::kTargetRadius`, `kTargetOpacity`. */
  connectTargetRadius: 20,
  connectTargetOpacity: 0.4,
  laserRadius: 45,
  eraseCircleSize: 80,
  zoomInfoWidth: 140,
  zoomInfoHeight: 30,
  zoomInfoFontSize: 20,
  remotePointerRadius: 20,
});

/**
 * The selection rectangle's line: C++ `SelectionRectangleWidget` strokes it with its own
 * `drawingProfile`, which sets only the dash {2, 2} (SelectionRectangleWidget.cpp:29-37), so the
 * width is `Style::effectiveStrokeWidth`'s default 2 (Style.cpp:70-84); the port drew 1 (owner
 * round UI6). The vertex handle's frame and circle (`VertexHandleWidget`) are drawn the same way.
 */
export const SELECTION_STROKE_WIDTH = 2;

export function dashedStyle(color: Color): Style {
  const s = new Style();
  s.setNoFill();
  s.setStrokeColor(color);
  s.setStrokeWidth(SELECTION_STROKE_WIDTH);
  s.setDashArray([2, 2]);
  return s;
}
