// Visual attributes with parent-chain inheritance (port of C++ `Style` and `GroupStyle`,
// `L/Style.{h,cpp}`). Pure data: unlike C++, no setter calls `Platform::processFont`; fonts are
// resolved at layout time by text/FontNameResolver (spec 02 §4, spec 06 §8).
//
// Each attribute keeps the C++ quartet: `effectiveX()` (inherited through `parent`, then the
// root default), `isXDefined()`, `isXOverridable()` (the attribute is not in the
// non-overridables), `removeX()` and `setX()` (a no-op when not overridable). The C++ quirks are
// kept: `lineBreakMode` starts defined (word wrap), `removeShadow`/`removeLineBreakMode` ignore
// the non-overridables, `textPadding` and `dashPatternPhase` are truncated to integers.
//
// New: `revision` counts every mutation of this style, and `revisionSum()` adds the ancestors',
// so an object can tell its effective style has not changed without rebuilding its text key
// (spec 03 §5.2, §8.2 fast path).
import { BLACK, Color } from './color';
import { DEFAULT_PAINT, NO_PAINT, NO_SHADOW, Paint, PaintType, Shadow } from './paint';

/** C++ `Style::LineBreakMode`. */
export const LineBreakMode = Object.freeze({ Default: 0, WordWrapping: 1, CharWrapping: 2, Clipping: 3 } as const);
export type LineBreakMode = (typeof LineBreakMode)[keyof typeof LineBreakMode];

/** C++ `Style::TextAlignHorizontal`. */
export const TextAlignHorizontal = Object.freeze({ Default: 0, Center: 1, Left: 2, Right: 3 } as const);
export type TextAlignHorizontal = (typeof TextAlignHorizontal)[keyof typeof TextAlignHorizontal];

/** C++ `Style::TextAlignVertical`. */
export const TextAlignVertical = Object.freeze({ Default: 0, Center: 1, Top: 2, Bottom: 3 } as const);
export type TextAlignVertical = (typeof TextAlignVertical)[keyof typeof TextAlignVertical];

/** C++ `Style::TextDecoration` (bit flags). */
export const TextDecoration = Object.freeze({
  Default: 0,
  Normal: 1,
  UnderLine: 2,
  OverLine: 4,
  StrikeThrough: 8,
} as const);
export type TextDecoration = number;

/** C++ `Style::FontStyle`. */
export const FontStyle = Object.freeze({ Default: 0, Normal: 1, Italic: 2, Oblique: 3 } as const);
export type FontStyle = (typeof FontStyle)[keyof typeof FontStyle];

/** C++ `Style::FontWeight`. */
export const FontWeight = Object.freeze({ Default: 0, Normal: 1, Bold: 2 } as const);
export type FontWeight = (typeof FontWeight)[keyof typeof FontWeight];

/** C++ `Style::JoinStyle`. */
export const JoinStyle = Object.freeze({ Default: 0, Miter: 1, Round: 2, Bevel: 3 } as const);
export type JoinStyle = (typeof JoinStyle)[keyof typeof JoinStyle];

/** C++ `Style::CapStyle`. */
export const CapStyle = Object.freeze({ Default: 0, Butt: 1, Round: 2, Square: 3 } as const);
export type CapStyle = (typeof CapStyle)[keyof typeof CapStyle];

/** The names the non-overridables set uses (the C++ strings). */
export type StyleAttr =
  | 'strokeWidth'
  | 'capStyle'
  | 'joinStyle'
  | 'strokePaint'
  | 'fillPaint'
  | 'dashArray'
  | 'dashPatternPhase'
  | 'textAlignVertical'
  | 'textAlignHorizontal'
  | 'textDecoration'
  | 'fontWeight'
  | 'fontStyle'
  | 'fontSize'
  | 'fontFamily'
  | 'platformFontFamily'
  | 'fontModifier'
  | 'disabled'
  | 'fontMultiplier'
  | 'textPadding'
  | 'textStroke'
  | 'textFill'
  | 'shadow'
  | 'lineBreakMode';

/** The root defaults (C++ `Style::reset` and the `effective*` fallbacks). */
export const STYLE_DEFAULTS = Object.freeze({
  strokeWidth: 2,
  capStyle: CapStyle.Round,
  joinStyle: JoinStyle.Round,
  dashPatternPhase: 0,
  textAlignVertical: TextAlignVertical.Center,
  textAlignHorizontal: TextAlignHorizontal.Center,
  textDecoration: TextDecoration.Normal,
  fontWeight: FontWeight.Normal,
  fontStyle: FontStyle.Normal,
  fontSize: 15,
  fontMultiplier: 1.0,
  textPadding: -1,
  lineBreakMode: LineBreakMode.WordWrapping,
} as const);

const DEFAULT_STROKE: Paint = Object.freeze(Paint.solid(BLACK));
const DEFAULT_FILL: Paint = NO_PAINT;
const DEFAULT_TEXT_STROKE: Paint = NO_PAINT;
const DEFAULT_TEXT_FILL: Paint = Object.freeze(Paint.solid(BLACK));
const DEFAULT_SELECTION_COLOR: Color = Object.freeze(new Color(0, 100, 255, 50));

/** The C++ `Style`. `DrawingProfile` in C++ is the same class. */
export class Style {
  private nonOverridables_ = new Set<string>();
  private strokeWidth_ = -1;
  private capStyle_: CapStyle = CapStyle.Default;
  private joinStyle_: JoinStyle = JoinStyle.Default;
  private dashArray_: readonly number[] = [];
  private dashPatternPhase_ = 0;
  private disabled_ = -1;
  private strokePaint_: Paint = DEFAULT_PAINT;
  private fillPaint_: Paint = DEFAULT_PAINT;
  private textStroke_: Paint = DEFAULT_PAINT;
  private textFill_: Paint = DEFAULT_PAINT;
  private lineBreakMode_: LineBreakMode = LineBreakMode.WordWrapping;
  private textAlignVertical_: TextAlignVertical = TextAlignVertical.Default;
  private textAlignHorizontal_: TextAlignHorizontal = TextAlignHorizontal.Default;
  private textDecoration_: TextDecoration = TextDecoration.Default;
  private fontWeight_: FontWeight = FontWeight.Default;
  private fontStyle_: FontStyle = FontStyle.Default;
  private fontSize_ = -1;
  private fontFamily_ = '';
  private platformFontFamily_ = '';
  private fontModifier_ = '';
  private fontMultiplier_ = -1;
  private textPadding_ = -1;
  private shadow_: Shadow = NO_SHADOW;
  private parent_: Style | null = null;
  // Not serialized; set while drawing.
  private selectionColor_: Color = DEFAULT_SELECTION_COLOR;
  private isSelected_ = false;
  private drawHighlightRect_ = false;
  private revision_ = 0;

  constructor() {
    this.reset();
  }

  /** C++ `reset()`: every attribute undefined except `lineBreakMode` (word wrap) and phase 0. */
  reset(): void {
    this.strokeWidth_ = -1;
    this.dashPatternPhase_ = -1;
    this.disabled_ = -1;
    this.fontMultiplier_ = -1;
    this.capStyle_ = CapStyle.Default;
    this.joinStyle_ = JoinStyle.Default;
    this.strokePaint_ = DEFAULT_PAINT;
    this.fillPaint_ = DEFAULT_PAINT;
    this.textPadding_ = -1;
    this.textStroke_ = DEFAULT_PAINT;
    this.textFill_ = DEFAULT_PAINT;
    this.lineBreakMode_ = LineBreakMode.WordWrapping;
    this.textAlignVertical_ = TextAlignVertical.Default;
    this.textAlignHorizontal_ = TextAlignHorizontal.Default;
    this.textDecoration_ = TextDecoration.Default;
    this.fontWeight_ = FontWeight.Default;
    this.fontStyle_ = FontStyle.Default;
    this.fontSize_ = -1;
    this.parent_ = null;
    this.removeDashArray();
    this.dashPatternPhase_ = 0;
    this.isSelected_ = false;
    this.selectionColor_ = DEFAULT_SELECTION_COLOR;
    this.drawHighlightRect_ = false;
    this.touch();
  }

  // ---- revision ----

  /** Mutation count of this style alone. */
  get revision(): number {
    return this.revision_;
  }

  /**
   * This style's revision plus every ancestor's. It only ever grows, and every change that can
   * alter an effective value grows it: unchanged ⇒ the effective values are unchanged.
   */
  revisionSum(): number {
    let sum = this.revision_;
    for (let s = this.parent_; s !== null; s = s.parent_) sum += s.revision_;
    return sum;
  }

  protected touch(): void {
    this.revision_++;
  }

  // ---- parent ----

  parent(): Style | null {
    return this.parent_;
  }

  /**
   * The revision jumps by the old chain's sum + 1, so `revisionSum()` strictly increases even
   * when the new parent chain has a smaller sum than the old one.
   */
  setParent(style: Style | null): void {
    const old = this.parent_?.revisionSum() ?? 0;
    this.parent_ = style;
    this.revision_ += old + 1;
  }

  // ---- non-overridables ----

  nonOverridables(): ReadonlySet<string> {
    return this.nonOverridables_;
  }

  addNonOverridables(attr: string): void {
    this.nonOverridables_.add(attr);
    this.touch();
  }

  protected overridable(attr: StyleAttr): boolean {
    return !this.nonOverridables_.has(attr);
  }

  // ---- strokeWidth ----

  effectiveStrokeWidth(): number {
    if (!this.isStrokeWidthDefined()) {
      if (this.parent_ !== null) {
        const w = this.parent_.effectiveStrokeWidth();
        return w < 0 ? 0 : w;
      }
      return STYLE_DEFAULTS.strokeWidth;
    }
    return this.strokeWidth_;
  }
  isStrokeWidthDefined(): boolean {
    return this.strokeWidth_ >= 0;
  }
  isStrokeWidthOverridable(): boolean {
    return this.overridable('strokeWidth');
  }
  removeStrokeWidth(): void {
    this.setStrokeWidth(-1);
  }
  setStrokeWidth(width: number): void {
    if (this.isStrokeWidthOverridable()) {
      this.strokeWidth_ = width;
      this.touch();
    }
  }

  // ---- capStyle ----

  effectiveCapStyle(): CapStyle {
    if (!this.isCapStyleDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveCapStyle() : STYLE_DEFAULTS.capStyle;
    }
    return this.capStyle_;
  }
  isCapStyleDefined(): boolean {
    return this.capStyle_ !== CapStyle.Default;
  }
  isCapStyleOverridable(): boolean {
    return this.overridable('capStyle');
  }
  removeCapStyle(): void {
    this.setCapStyle(CapStyle.Default);
  }
  setCapStyle(style: CapStyle): void {
    if (this.isCapStyleOverridable()) {
      this.capStyle_ = style;
      this.touch();
    }
  }

  // ---- joinStyle ----

  effectiveJoinStyle(): JoinStyle {
    if (!this.isJoinStyleDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveJoinStyle() : STYLE_DEFAULTS.joinStyle;
    }
    return this.joinStyle_;
  }
  isJoinStyleDefined(): boolean {
    return this.joinStyle_ !== JoinStyle.Default;
  }
  isJoinStyleOverridable(): boolean {
    return this.overridable('joinStyle');
  }
  removeJoinStyle(): void {
    this.setJoinStyle(JoinStyle.Default);
  }
  setJoinStyle(style: JoinStyle): void {
    if (this.isJoinStyleOverridable()) {
      this.joinStyle_ = style;
      this.touch();
    }
  }

  // ---- strokePaint ----

  effectiveStrokePaint(): Paint {
    if (!this.isStrokePaintDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveStrokePaint() : DEFAULT_STROKE;
    }
    return this.strokePaint_;
  }
  isStrokePaintDefined(): boolean {
    return this.strokePaint_.type !== PaintType.Default;
  }
  isStrokePaintOverridable(): boolean {
    return this.overridable('strokePaint');
  }
  removeStrokePaint(): void {
    this.setStrokePaint(DEFAULT_PAINT);
  }
  setStrokePaint(paint: Paint): void {
    if (this.isStrokePaintOverridable()) {
      this.strokePaint_ = paint;
      this.touch();
    }
  }

  // ---- fillPaint ----

  effectiveFillPaint(): Paint {
    if (!this.isFillPaintDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveFillPaint() : DEFAULT_FILL;
    }
    return this.fillPaint_;
  }
  isFillPaintDefined(): boolean {
    return this.fillPaint_.type !== PaintType.Default;
  }
  isFillPaintOverridable(): boolean {
    return this.overridable('fillPaint');
  }
  removeFillPaint(): void {
    this.setFillPaint(DEFAULT_PAINT);
  }
  setFillPaint(paint: Paint): void {
    if (this.isFillPaintOverridable()) {
      this.fillPaint_ = paint;
      this.touch();
    }
  }

  // ---- dashArray ----

  /** The own dash array, or the parent's when the own one is empty. */
  effectiveDashArray(): readonly number[] {
    if (this.dashArray_.length === 0 && this.parent_ !== null) return this.parent_.effectiveDashArray();
    return this.dashArray_;
  }
  isDashArrayDefined(): boolean {
    return this.dashArray_.length > 0;
  }
  isDashArrayOverridable(): boolean {
    return this.overridable('dashArray');
  }
  removeDashArray(): void {
    this.setDashArray([]);
  }
  /** An array of only zeros clears the dash (C++). */
  setDashArray(arr: readonly number[]): void {
    if (this.isDashArrayOverridable()) {
      const shouldAdd = arr.some((v) => v !== 0);
      this.dashArray_ = shouldAdd ? Object.freeze([...arr]) : [];
      this.touch();
    }
  }

  // ---- dashPatternPhase ----

  effectiveDashPatternPhase(): number {
    if (!this.isDashPatternPhaseDefined()) {
      if (this.parent_ !== null) {
        const phase = this.parent_.effectiveDashPatternPhase();
        return phase < 0 ? 0 : phase;
      }
      return STYLE_DEFAULTS.dashPatternPhase;
    }
    return this.dashPatternPhase_;
  }
  isDashPatternPhaseDefined(): boolean {
    return this.dashPatternPhase_ >= 0;
  }
  isDashPatternPhaseOverridable(): boolean {
    return this.overridable('dashPatternPhase');
  }
  removeDashPatternPhase(): void {
    this.setDashPatternPhase(-1);
  }
  setDashPatternPhase(num: number): void {
    if (this.isDashPatternPhaseOverridable()) {
      this.dashPatternPhase_ = Math.trunc(num);
      this.touch();
    }
  }

  // ---- textAlignVertical ----

  effectiveTextAlignVertical(): TextAlignVertical {
    if (!this.isTextAlignVerticalDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveTextAlignVertical() : STYLE_DEFAULTS.textAlignVertical;
    }
    return this.textAlignVertical_;
  }
  isTextAlignVerticalDefined(): boolean {
    return this.textAlignVertical_ !== TextAlignVertical.Default;
  }
  isTextAlignVerticalOverridable(): boolean {
    return this.overridable('textAlignVertical');
  }
  removeTextAlignVertical(): void {
    this.setTextAlignVertical(TextAlignVertical.Default);
  }
  setTextAlignVertical(align: TextAlignVertical): void {
    if (this.isTextAlignVerticalOverridable()) {
      this.textAlignVertical_ = align;
      this.touch();
    }
  }

  // ---- textAlignHorizontal ----

  effectiveTextAlignHorizontal(): TextAlignHorizontal {
    if (!this.isTextAlignHorizontalDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveTextAlignHorizontal() : STYLE_DEFAULTS.textAlignHorizontal;
    }
    return this.textAlignHorizontal_;
  }
  isTextAlignHorizontalDefined(): boolean {
    return this.textAlignHorizontal_ !== TextAlignHorizontal.Default;
  }
  isTextAlignHorizontalOverridable(): boolean {
    return this.overridable('textAlignHorizontal');
  }
  removeTextAlignHorizontal(): void {
    this.setTextAlignHorizontal(TextAlignHorizontal.Default);
  }
  setTextAlignHorizontal(align: TextAlignHorizontal): void {
    if (this.isTextAlignHorizontalOverridable()) {
      this.textAlignHorizontal_ = align;
      this.touch();
    }
  }

  // ---- textDecoration ----

  effectiveTextDecoration(): TextDecoration {
    if (!this.isTextDecorationDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveTextDecoration() : STYLE_DEFAULTS.textDecoration;
    }
    return this.textDecoration_;
  }
  isTextDecorationDefined(): boolean {
    return this.textDecoration_ !== TextDecoration.Default;
  }
  isTextDecorationOverridable(): boolean {
    return this.overridable('textDecoration');
  }
  removeTextDecoration(): void {
    this.setTextDecoration(TextDecoration.Default);
  }
  setTextDecoration(decor: TextDecoration): void {
    if (this.isTextDecorationOverridable()) {
      this.textDecoration_ = decor;
      this.touch();
    }
  }

  // ---- fontWeight ----

  effectiveFontWeight(): FontWeight {
    if (!this.isFontWeightDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveFontWeight() : STYLE_DEFAULTS.fontWeight;
    }
    return this.fontWeight_;
  }
  isFontWeightDefined(): boolean {
    return this.fontWeight_ !== FontWeight.Default;
  }
  isFontWeightOverridable(): boolean {
    return this.overridable('fontWeight');
  }
  removeFontWeight(): void {
    this.setFontWeight(FontWeight.Default);
  }
  setFontWeight(weight: FontWeight): void {
    if (this.isFontWeightOverridable()) {
      this.fontWeight_ = weight;
      this.touch();
    }
  }

  // ---- fontStyle ----

  effectiveFontStyle(): FontStyle {
    if (!this.isFontStyleDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveFontStyle() : STYLE_DEFAULTS.fontStyle;
    }
    return this.fontStyle_;
  }
  isFontStyleDefined(): boolean {
    return this.fontStyle_ !== FontStyle.Default;
  }
  isFontStyleOverridable(): boolean {
    return this.overridable('fontStyle');
  }
  removeFontStyle(): void {
    this.setFontStyle(FontStyle.Default);
  }
  setFontStyle(fstyle: FontStyle): void {
    if (this.isFontStyleOverridable()) {
      this.fontStyle_ = fstyle;
      this.touch();
    }
  }

  // ---- fontSize ----

  /** Defaults to 15 at the root (`Style.cpp:511-518`). */
  effectiveFontSize(): number {
    if (!this.isFontSizeDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveFontSize() : STYLE_DEFAULTS.fontSize;
    }
    return this.fontSize_;
  }
  isFontSizeDefined(): boolean {
    return this.fontSize_ >= 0;
  }
  isFontSizeOverridable(): boolean {
    return this.overridable('fontSize');
  }
  removeFontSize(): void {
    this.setFontSize(-1);
  }
  setFontSize(size: number): void {
    if (this.isFontSizeOverridable()) {
      this.fontSize_ = size;
      this.touch();
    }
  }

  // ---- fontFamily ----

  /** `""` at the root: the platform default. */
  effectiveFontFamily(): string {
    if (!this.isFontFamilyDefined() && this.parent_ !== null) return this.parent_.effectiveFontFamily();
    return this.fontFamily_;
  }
  isFontFamilyDefined(): boolean {
    return this.fontFamily_ !== '';
  }
  isFontFamilyOverridable(): boolean {
    return this.overridable('fontFamily');
  }
  removeFontFamily(): void {
    this.setFontFamily('');
  }
  setFontFamily(family: string): void {
    if (this.isFontFamilyOverridable()) {
      this.fontFamily_ = family;
      this.touch();
    }
  }

  // ---- platformFontFamily ----

  effectivePlatformFontFamily(): string {
    if (!this.isPlatformFontFamilyDefined() && this.parent_ !== null) return this.parent_.effectivePlatformFontFamily();
    return this.platformFontFamily_;
  }
  isPlatformFontFamilyDefined(): boolean {
    return this.platformFontFamily_ !== '';
  }
  isPlatformFontFamilyOverridable(): boolean {
    return this.overridable('platformFontFamily');
  }
  removePlatformFontFamily(): void {
    this.setPlatformFontFamily('');
  }
  setPlatformFontFamily(family: string): void {
    if (this.isPlatformFontFamilyOverridable()) {
      this.platformFontFamily_ = family;
      this.touch();
    }
  }

  // ---- fontModifier ----

  effectiveFontModifier(): string {
    if (!this.isFontModifierDefined() && this.parent_ !== null) return this.parent_.effectiveFontModifier();
    return this.fontModifier_;
  }
  isFontModifierDefined(): boolean {
    return this.fontModifier_ !== '';
  }
  isFontModifierOverridable(): boolean {
    return this.overridable('fontModifier');
  }
  removeFontModifier(): void {
    this.setFontModifier('');
  }
  setFontModifier(modifier: string): void {
    if (this.isFontModifierOverridable()) {
      this.fontModifier_ = modifier;
      this.touch();
    }
  }

  // ---- disabled ----

  effectiveDisabled(): boolean {
    if (!this.isDisabledDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveDisabled() : false;
    }
    return this.disabled_ > 0;
  }
  isDisabledDefined(): boolean {
    return this.disabled_ >= 0;
  }
  isDisabledOverridable(): boolean {
    return this.overridable('disabled');
  }
  /** C++ `removeDisbaled`. */
  removeDisabled(): void {
    this.setDisabled(-1);
  }
  setDisabled(val: number): void {
    if (this.isDisabledOverridable()) {
      this.disabled_ = Math.trunc(val);
      this.touch();
    }
  }

  // ---- fontMultiplier ----

  /** Defaults to 1.0 at the root (`Style.cpp:670-678`). */
  effectiveFontMultiplier(): number {
    if (!this.isFontMultiplierDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveFontMultiplier() : STYLE_DEFAULTS.fontMultiplier;
    }
    return this.fontMultiplier_;
  }
  isFontMultiplierDefined(): boolean {
    return this.fontMultiplier_ >= 0;
  }
  isFontMultiplierOverridable(): boolean {
    return this.overridable('fontMultiplier');
  }
  removeFontMultiplier(): void {
    this.setFontMultiplier(-1);
  }
  setFontMultiplier(val: number): void {
    if (this.isFontMultiplierOverridable()) {
      this.fontMultiplier_ = val;
      this.touch();
    }
  }

  // ---- textPadding ----

  effectiveTextPadding(): number {
    if (!this.isTextPaddingDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveTextPadding() : STYLE_DEFAULTS.textPadding;
    }
    return this.textPadding_;
  }
  isTextPaddingDefined(): boolean {
    return this.textPadding_ >= 0;
  }
  isTextPaddingOverridable(): boolean {
    return this.overridable('textPadding');
  }
  removeTextPadding(): void {
    this.setTextPadding(-1);
  }
  /** The C++ field is an `int`: the value is truncated. */
  setTextPadding(val: number): void {
    if (this.isTextPaddingOverridable()) {
      this.textPadding_ = Math.trunc(val);
      this.touch();
    }
  }

  // ---- textStroke ----

  effectiveTextStroke(): Paint {
    if (!this.isTextStrokeDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveTextStroke() : DEFAULT_TEXT_STROKE;
    }
    return this.textStroke_;
  }
  isTextStrokeDefined(): boolean {
    return this.textStroke_.type !== PaintType.Default;
  }
  isTextStrokeOverridable(): boolean {
    return this.overridable('textStroke');
  }
  removeTextStroke(): void {
    this.setTextStroke(DEFAULT_PAINT);
  }
  setTextStroke(paint: Paint): void {
    if (this.isTextStrokeOverridable()) {
      this.textStroke_ = paint;
      this.touch();
    }
  }

  // ---- textFill ----

  effectiveTextFill(): Paint {
    if (!this.isTextFillDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveTextFill() : DEFAULT_TEXT_FILL;
    }
    return this.textFill_;
  }
  isTextFillDefined(): boolean {
    return this.textFill_.type !== PaintType.Default;
  }
  isTextFillOverridable(): boolean {
    return this.overridable('textFill');
  }
  removeTextFill(): void {
    this.setTextFill(DEFAULT_PAINT);
  }
  setTextFill(paint: Paint): void {
    if (this.isTextFillOverridable()) {
      this.textFill_ = paint;
      this.touch();
    }
  }

  // ---- shadow ----

  effectiveShadow(): Shadow {
    if (!this.isShadowDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveShadow() : NO_SHADOW;
    }
    return this.shadow_;
  }
  isShadowDefined(): boolean {
    return this.shadow_.radius >= 0;
  }
  isShadowOverridable(): boolean {
    return this.overridable('shadow');
  }
  /** Ignores the non-overridables, as C++. */
  removeShadow(): void {
    this.shadow_ = new Shadow(this.shadow_.dx, this.shadow_.dy, -1, this.shadow_.color);
    this.touch();
  }
  setShadow(shadow: Shadow): void {
    if (this.isShadowOverridable()) {
      this.shadow_ = shadow;
      this.touch();
    }
  }

  // ---- lineBreakMode ----

  effectiveLineBreakMode(): LineBreakMode {
    if (!this.isLineBreakModeDefined()) {
      return this.parent_ !== null ? this.parent_.effectiveLineBreakMode() : STYLE_DEFAULTS.lineBreakMode;
    }
    return this.lineBreakMode_;
  }
  isLineBreakModeDefined(): boolean {
    return this.lineBreakMode_ !== LineBreakMode.Default;
  }
  isLineBreakModeOverridable(): boolean {
    return this.overridable('lineBreakMode');
  }
  /** Ignores the non-overridables, as C++. */
  removeLineBreakMode(): void {
    this.lineBreakMode_ = LineBreakMode.Default;
    this.touch();
  }
  setLineBreakMode(mode: LineBreakMode): void {
    if (this.isLineBreakModeOverridable()) {
      this.lineBreakMode_ = mode;
      this.touch();
    }
  }

  // ---- colour shortcuts (C++ `setStrokeColor`, …) ----

  setStrokeColor(color: Color): void {
    this.setStrokePaint(this.effectiveStrokePaint().with({ type: PaintType.Solid, solidColor: color }));
  }
  setNoFill(): void {
    this.setFillPaint(this.effectiveFillPaint().with({ type: PaintType.NoPaint }));
  }
  setFillColor(color: Color): void {
    this.setFillPaint(this.effectiveFillPaint().with({ type: PaintType.Solid, solidColor: color }));
  }
  setFontColor(color: Color): void {
    this.setTextFill(this.effectiveTextFill().with({ type: PaintType.Solid, solidColor: color }));
  }

  // ---- drawing-time helpers (C++ "copied from DrawingProfile") ----

  fill(): boolean {
    return this.effectiveFillPaint().type !== PaintType.NoPaint;
  }
  dashPatternCount(): number {
    return this.effectiveDashArray().length;
  }
  selectionColor(): Color {
    return this.selectionColor_;
  }
  setSelectionColor(color: Color): void {
    this.selectionColor_ = color;
  }
  isSelected(): boolean {
    return this.isSelected_;
  }
  setIsSelected(selected: boolean): void {
    this.isSelected_ = selected;
  }
  drawHighlightRect(): boolean {
    return this.drawHighlightRect_;
  }
  setDrawHighlightRect(highlight: boolean): void {
    this.drawHighlightRect_ = highlight;
  }

  // ---- comparison and copies ----

  /**
   * C++ `equals`: compares the effective fill, stroke, stroke width, cap, join, dash (length,
   * then values), text stroke and fill, both aligns, decoration, weight, style, size, family and
   * platform family. Not compared (as C++): modifier, multiplier, padding, shadow, line break,
   * disabled, dash phase.
   */
  equals(other: Style): boolean {
    if (!other.effectiveFillPaint().equals(this.effectiveFillPaint())) return false;
    if (!other.effectiveStrokePaint().equals(this.effectiveStrokePaint())) return false;
    if (other.effectiveStrokeWidth() !== this.effectiveStrokeWidth()) return false;
    if (other.effectiveCapStyle() !== this.effectiveCapStyle()) return false;
    if (other.effectiveJoinStyle() !== this.effectiveJoinStyle()) return false;
    const da = this.effectiveDashArray();
    const oda = other.effectiveDashArray();
    if (oda.length !== da.length) return false;
    if (!other.effectiveTextStroke().equals(this.effectiveTextStroke())) return false;
    if (!other.effectiveTextFill().equals(this.effectiveTextFill())) return false;
    if (other.effectiveTextAlignVertical() !== this.effectiveTextAlignVertical()) return false;
    if (other.effectiveTextAlignHorizontal() !== this.effectiveTextAlignHorizontal()) return false;
    if (other.effectiveTextDecoration() !== this.effectiveTextDecoration()) return false;
    if (other.effectiveFontWeight() !== this.effectiveFontWeight()) return false;
    if (other.effectiveFontStyle() !== this.effectiveFontStyle()) return false;
    if (other.effectiveFontSize() !== this.effectiveFontSize()) return false;
    if (other.effectiveFontFamily() !== this.effectiveFontFamily()) return false;
    if (other.effectivePlatformFontFamily() !== this.effectivePlatformFontFamily()) return false;
    for (let i = 0; i < da.length; i++) {
      if (da[i] !== oda[i]) return false;
    }
    return true;
  }

  /** C++ `clone()`: a new `Style` with every own value copied; no parent. */
  clone(): Style {
    const s = new Style();
    s.copyFrom(this);
    return s;
  }

  deepClone(): Style {
    return this.clone();
  }

  /**
   * C++ `copyFrom`: every own value (non-overridables and drawing-time state included) is copied;
   * the parent is kept. On a `GroupStyle` only the `Style` part is copied (C++ slicing).
   */
  copyFrom(other: Style): void {
    this.nonOverridables_ = new Set(other.nonOverridables_);
    this.strokeWidth_ = other.strokeWidth_;
    this.capStyle_ = other.capStyle_;
    this.joinStyle_ = other.joinStyle_;
    this.dashArray_ = other.dashArray_;
    this.dashPatternPhase_ = other.dashPatternPhase_;
    this.disabled_ = other.disabled_;
    this.strokePaint_ = other.strokePaint_;
    this.fillPaint_ = other.fillPaint_;
    this.textStroke_ = other.textStroke_;
    this.textFill_ = other.textFill_;
    this.lineBreakMode_ = other.lineBreakMode_;
    this.textAlignVertical_ = other.textAlignVertical_;
    this.textAlignHorizontal_ = other.textAlignHorizontal_;
    this.textDecoration_ = other.textDecoration_;
    this.fontWeight_ = other.fontWeight_;
    this.fontStyle_ = other.fontStyle_;
    this.fontSize_ = other.fontSize_;
    this.fontFamily_ = other.fontFamily_;
    this.platformFontFamily_ = other.platformFontFamily_;
    this.fontModifier_ = other.fontModifier_;
    this.fontMultiplier_ = other.fontMultiplier_;
    this.textPadding_ = other.textPadding_;
    this.shadow_ = other.shadow_;
    this.selectionColor_ = other.selectionColor_;
    this.isSelected_ = other.isSelected_;
    this.drawHighlightRect_ = other.drawHighlightRect_;
    this.touch();
  }

  deepCopyFrom(other: Style): void {
    this.copyFrom(other);
  }
}

/** C++ `GroupStyle::Mode`. */
export const GroupStyleMode = Object.freeze({ Group: 0, Master: 1 } as const);
export type GroupStyleMode = (typeof GroupStyleMode)[keyof typeof GroupStyleMode];

/**
 * C++ `GroupStyle`: the live style of a group. In `Group` mode it copies member 0 and every set
 * is applied to each member; in `Master` mode a set clears the attribute on each member, so the
 * members inherit it. A set equal to the current effective value does nothing.
 */
export class GroupStyle extends Style {
  private mode_: GroupStyleMode;
  private groupProfiles_: Style[] = [];

  constructor(mode: GroupStyleMode = GroupStyleMode.Group) {
    super();
    this.mode_ = mode;
  }

  mode(): GroupStyleMode {
    return this.mode_;
  }
  setMode(mode: GroupStyleMode): void {
    this.mode_ = mode;
  }

  /** Non-overridables are not kept on a group (C++ no-op). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the C++ override ignores its argument
  override addNonOverridables(attr: string): void {
    /* no-op, as C++ */
  }

  /** In `Group` mode the group first copies member 0. An empty list is ignored. */
  setProfiles(profiles: readonly Style[]): void {
    if (profiles.length === 0) return;
    const first = profiles[0];
    if (this.mode_ === GroupStyleMode.Group && first !== undefined) this.copyFrom(first);
    this.groupProfiles_ = [...profiles];
  }
  getProfiles(): readonly Style[] {
    return this.groupProfiles_;
  }

  private each(group: (s: Style) => void, master: (s: Style) => void): void {
    for (const p of this.groupProfiles_) {
      if (this.mode_ === GroupStyleMode.Group) group(p);
      else master(p);
    }
  }

  override setStrokeWidth(sw: number): void {
    if (this.effectiveStrokeWidth() === sw) return;
    super.setStrokeWidth(sw);
    this.each(
      (p) => {
        p.setStrokeWidth(sw);
      },
      (p) => {
        p.removeStrokeWidth();
      },
    );
  }
  override setJoinStyle(style: JoinStyle): void {
    if (style === this.effectiveJoinStyle()) return;
    super.setJoinStyle(style);
    this.each(
      (p) => {
        p.setJoinStyle(style);
      },
      (p) => {
        p.removeJoinStyle();
      },
    );
  }
  override setCapStyle(style: CapStyle): void {
    if (style === this.effectiveCapStyle()) return;
    super.setCapStyle(style);
    this.each(
      (p) => {
        p.setCapStyle(style);
      },
      (p) => {
        p.removeCapStyle();
      },
    );
  }
  override setStrokePaint(pt: Paint): void {
    if (this.effectiveStrokePaint().equals(pt)) return;
    super.setStrokePaint(pt);
    this.each(
      (p) => {
        p.setStrokePaint(pt);
      },
      (p) => {
        p.removeStrokePaint();
      },
    );
  }
  override setFillPaint(pt: Paint): void {
    if (this.effectiveFillPaint().equals(pt)) return;
    super.setFillPaint(pt);
    this.each(
      (p) => {
        p.setFillPaint(pt);
      },
      (p) => {
        p.removeFillPaint();
      },
    );
  }
  override setTextStroke(pt: Paint): void {
    if (this.effectiveTextStroke().equals(pt)) return;
    super.setTextStroke(pt);
    this.each(
      (p) => {
        p.setTextStroke(pt);
      },
      (p) => {
        p.removeTextStroke();
      },
    );
  }
  override setTextFill(pt: Paint): void {
    if (this.effectiveTextFill().equals(pt)) return;
    super.setTextFill(pt);
    this.each(
      (p) => {
        p.setTextFill(pt);
      },
      (p) => {
        p.removeTextFill();
      },
    );
  }
  override setDashArray(arr: readonly number[]): void {
    const da = this.effectiveDashArray();
    if (da.length === arr.length && da.every((v, i) => v === arr[i])) return;
    super.setDashArray(arr);
    this.each(
      (p) => {
        p.setDashArray(arr);
      },
      (p) => {
        p.removeDashArray();
      },
    );
  }
  /** C++: the phase is set on every member in both modes. */
  override setDashPatternPhase(ph: number): void {
    if (this.effectiveDashPatternPhase() === ph) return;
    super.setDashPatternPhase(ph);
    for (const p of this.groupProfiles_) p.setDashPatternPhase(ph);
  }
  override setTextAlignVertical(tav: TextAlignVertical): void {
    if (this.effectiveTextAlignVertical() === tav) return;
    super.setTextAlignVertical(tav);
    this.each(
      (p) => {
        p.setTextAlignVertical(tav);
      },
      (p) => {
        p.removeTextAlignVertical();
      },
    );
  }
  override setTextAlignHorizontal(tah: TextAlignHorizontal): void {
    if (this.effectiveTextAlignHorizontal() === tah) return;
    super.setTextAlignHorizontal(tah);
    this.each(
      (p) => {
        p.setTextAlignHorizontal(tah);
      },
      (p) => {
        p.removeTextAlignHorizontal();
      },
    );
  }
  override setTextDecoration(td: TextDecoration): void {
    if (this.effectiveTextDecoration() === td) return;
    super.setTextDecoration(td);
    this.each(
      (p) => {
        p.setTextDecoration(td);
      },
      (p) => {
        p.removeTextDecoration();
      },
    );
  }
  override setFontWeight(fw: FontWeight): void {
    if (this.effectiveFontWeight() === fw) return;
    super.setFontWeight(fw);
    this.each(
      (p) => {
        p.setFontWeight(fw);
      },
      (p) => {
        p.removeFontWeight();
      },
    );
  }
  override setFontStyle(fs: FontStyle): void {
    if (this.effectiveFontStyle() === fs) return;
    super.setFontStyle(fs);
    this.each(
      (p) => {
        p.setFontStyle(fs);
      },
      (p) => {
        p.removeFontStyle();
      },
    );
  }
  override setFontSize(fz: number): void {
    if (this.effectiveFontSize() === fz) return;
    super.setFontSize(fz);
    this.each(
      (p) => {
        p.setFontSize(fz);
      },
      (p) => {
        p.removeFontSize();
      },
    );
  }
  override setFontFamily(ff: string): void {
    if (this.effectiveFontFamily() === ff) return;
    super.setFontFamily(ff);
    this.each(
      (p) => {
        p.setFontFamily(ff);
      },
      (p) => {
        p.removeFontFamily();
      },
    );
  }
  override setPlatformFontFamily(pff: string): void {
    if (this.effectivePlatformFontFamily() === pff) return;
    super.setPlatformFontFamily(pff);
    this.each(
      (p) => {
        p.setPlatformFontFamily(pff);
      },
      (p) => {
        p.removePlatformFontFamily();
      },
    );
  }
  override setFontModifier(fm: string): void {
    if (this.effectiveFontModifier() === fm) return;
    super.setFontModifier(fm);
    this.each(
      (p) => {
        p.setFontModifier(fm);
      },
      (p) => {
        p.removeFontModifier();
      },
    );
  }
  override setDisabled(val: number): void {
    if (
      (!this.isDisabledDefined() && val < 0) ||
      (this.effectiveDisabled() && val > 0) ||
      (!this.effectiveDisabled() && val === 0)
    ) {
      return;
    }
    super.setDisabled(val);
    this.each(
      (p) => {
        p.setDisabled(val);
      },
      (p) => {
        p.removeDisabled();
      },
    );
  }
  override setFontMultiplier(val: number): void {
    if ((!this.isFontMultiplierDefined() && val < 0) || this.effectiveFontMultiplier() === val) return;
    super.setFontMultiplier(val);
    this.each(
      (p) => {
        p.setFontMultiplier(val);
      },
      (p) => {
        p.removeFontMultiplier();
      },
    );
  }
  /** C++ `GroupStyle::setTextPadding(int)`: the argument is truncated before the comparison. */
  override setTextPadding(v: number): void {
    const val = Math.trunc(v);
    if ((!this.isTextPaddingDefined() && val < 0) || this.effectiveTextPadding() === val) return;
    super.setTextPadding(val);
    this.each(
      (p) => {
        p.setTextPadding(val);
      },
      (p) => {
        p.removeTextPadding();
      },
    );
  }
  override setShadow(val: Shadow): void {
    if (this.effectiveShadow().equals(val)) return;
    super.setShadow(val);
    this.each(
      (p) => {
        p.setShadow(val);
      },
      (p) => {
        p.removeShadow();
      },
    );
  }
  override setLineBreakMode(mode: LineBreakMode): void {
    if (this.effectiveLineBreakMode() === mode) return;
    super.setLineBreakMode(mode);
    this.each(
      (p) => {
        p.setLineBreakMode(mode);
      },
      (p) => {
        p.removeLineBreakMode();
      },
    );
  }
  override setSelectionColor(color: Color): void {
    if (color.equals(this.selectionColor())) return;
    super.setSelectionColor(color);
    for (const p of this.groupProfiles_) p.setSelectionColor(color);
  }
  override setIsSelected(selected: boolean): void {
    if (selected === this.isSelected()) return;
    super.setIsSelected(selected);
    for (const p of this.groupProfiles_) p.setIsSelected(selected);
  }
  override setDrawHighlightRect(highlight: boolean): void {
    if (highlight === this.drawHighlightRect()) return;
    super.setDrawHighlightRect(highlight);
    for (const p of this.groupProfiles_) p.setDrawHighlightRect(highlight);
  }

  /** C++ `GroupStyle::clone`: shares the member styles. */
  override clone(): GroupStyle {
    const g = new GroupStyle();
    g.copyFrom(this);
    g.mode_ = this.mode_;
    g.setProfiles(this.groupProfiles_);
    return g;
  }

  /**
   * C++ `GroupStyle::deepClone`: deep-copies the members, then copies this style over (the C++
   * order, so `setProfiles`' copy of member 0 is overwritten). The mode is not copied (C++).
   */
  override deepClone(): GroupStyle {
    const g = new GroupStyle();
    g.setProfiles(this.groupProfiles_.map((p) => p.deepClone()));
    g.copyFrom(this);
    return g;
  }

  /** C++ `deepCopyFrom`: also member by member when the other group has as many members. */
  override deepCopyFrom(other: Style): void {
    super.deepCopyFrom(other);
    if (!(other instanceof GroupStyle)) return;
    if (this.groupProfiles_.length !== other.groupProfiles_.length) return;
    other.groupProfiles_.forEach((p, i) => {
      this.groupProfiles_[i]?.deepCopyFrom(p);
    });
  }
}
