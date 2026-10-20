// lekhjs module `text` (spec 01 §2.1). The only import target from outside the module.
// Measurement ports, wrapping, layout at the 1.18 line pitch, painting, the two measurement
// caches, the bundled font registry (owner of `fontEpoch`) and the font resolver (spec 06).
export type {
  CanvasFactory,
  CanvasLike,
  FontFaceRequest,
  FontLoader,
  LineMetrics,
  PlatformFontSource,
  TextMeasurer,
} from './ports';
export { NO_PLATFORM_FONTS } from './ports';
export type { FontHost, GenericFamily, ResolvedFont } from './font-types';
export { CanvasTextMeasurer } from './canvas-text-measurer';
export { LINE_WIDTH_CACHE_CAPACITY, LineWidthCache } from './line-width-cache';
export { WRAP_EPSILON, WordWrapper, splitHardLines, type WrappedLine } from './word-wrapper';
export { paragraphDirection, type TextDirection } from './direction';
export {
  LINE_PITCH,
  TextLayout,
  TextMeasureMemo,
  textStyleSnapshot,
  type LaidOutLine,
  type LaidOutText,
  type TextAlign,
  type TextLayoutInput,
  type TextLayoutOptions,
  type TextStyleSnapshot,
  type TextVerticalAlign,
  type WrapMode,
} from './text-layout';
export { TextPainter, type TextPaintContext, type TextPaintOptions } from './text-painter';
export {
  BUNDLED_FONTS,
  DEFAULT_FONT_FAMILY,
  FontRegistry,
  type BundledFace,
  type BundledFamily,
  type BundledWoff2,
  type FontsManifest,
} from './font-registry';
export { FontNameResolver, type FontNameResolverOptions, type StoredFont } from './font-resolver';
export {
  GENERIC_FAMILIES,
  buildCanvasFont,
  buildFontKey,
  familyToken,
  fontPx,
  isGenericFamily,
  quoteFamily,
  splitFontKey,
  withFontPx,
} from './font-string';
export { modifierToCss, type ModifierCss } from './font-modifier';
export { seedPostScriptNames, type PostScriptFace } from './legacy-font-names';
export { TEXT_SWITCHES_OFF, type TextTestSwitches } from './test-switches';
export { lineBreakClass } from './unicode';
export { LB, type LineBreakClass } from './line-break-classes';
