// lekhjs module `style` (spec 01 §2.1). The only import target from outside the module.
// Pure data: styles, paints, units and the effective font; no measuring (that is text/).
export { BLACK, Color, type Hsv } from './color';
export {
  DEFAULT_PAINT,
  EMPTY_LINEAR_GRADIENT,
  EMPTY_RADIAL_GRADIENT,
  FillRule,
  Gradient,
  GradientSpread,
  GradientType,
  NO_PAINT,
  NO_SHADOW,
  Paint,
  PaintType,
  Shadow,
  type GradientStop,
  type LinearGradientSpec,
  type PaintInit,
  type RadialGradientSpec,
} from './paint';
export {
  CapStyle,
  FontStyle,
  FontWeight,
  GroupStyle,
  GroupStyleMode,
  JoinStyle,
  LineBreakMode,
  STYLE_DEFAULTS,
  Style,
  TextAlignHorizontal,
  TextAlignVertical,
  TextDecoration,
  type StyleAttr,
} from './style';
export { Length, POINTS_PER_INCH, Scaling, Unit } from './units';
export { FontSpec, effectiveFontPx } from './font-spec';
export { BACKGROUND_COLORS, LEKH_COLORS } from './palette';
