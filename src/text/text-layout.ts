// Text layout (spec 06 §3, spec 03 §8): split on `\n`, wrap, measure, place lines in a box at a
// line pitch of 1.18 × the effective font size, with each paragraph's base direction.
//
// Two caches (spec 03 §8.2):
//   - level 1, the per-element `TextMeasureMemo`, keyed by exactly 11 effective fields joined
//     with U+0000 (`fontEpoch` first). While the key holds, `layout` places the remembered lines
//     again without a single `measureLine` call; colour, alignment, box position and zoom are not
//     in the key, because they do not change sizes;
//   - level 2, the runtime's `LineWidthCache`, which the wrap loop asks before the measurer.
// Everything here is synchronous (AC-TXT-09, AC-ENG-25).
import { Lru } from '../base';
import type { Rect } from '../geometry';
import { Size } from '../geometry';
import { FontSpec, TextAlignHorizontal, TextAlignVertical, TextDecoration, type Style } from '../style';
import { paragraphDirection, type TextDirection } from './direction';
import type { FontRegistry } from './font-registry';
import type { FontNameResolver } from './font-resolver';
import { buildCanvasFont, buildFontKey } from './font-string';
import type { ResolvedFont } from './font-types';
import type { LineWidthCache } from './line-width-cache';
import type { TextMeasurer } from './ports';
import { TEXT_SWITCHES_OFF, type TextTestSwitches } from './test-switches';
import { WordWrapper } from './word-wrapper';

/** The line pitch factor (DR-TXT-01): line height = 1.18 × size × multiplier everywhere. */
export const LINE_PITCH = 1.18;

export type TextAlign = 'left' | 'center' | 'right';
export type TextVerticalAlign = 'top' | 'center' | 'bottom';
/** `float` lays out unconstrained; `clip` wraps and clips at paint (spec 03 §8.2 field 9). */
export type WrapMode = 'wrap' | 'float' | 'clip';

/** The resolved, effective text style a layout needs (spec 06 §3.1). */
export interface TextStyleSnapshot {
  readonly font: ResolvedFont;
  readonly fontSize: number;
  readonly fontMultiplier: number;
  readonly fontModifier: string;
  readonly align: TextAlign;
  readonly verticalAlign: TextVerticalAlign;
  readonly underline: boolean;
  readonly strikeThrough: boolean;
}

/** The snapshot of `style`'s effective text attributes; `defaultAlignAlways` forces left (`Edit.cpp:166-168`). */
export function textStyleSnapshot(
  style: Style,
  resolver: FontNameResolver,
  opts: { defaultAlignAlways?: boolean } = {},
): TextStyleSnapshot {
  const spec = FontSpec.of(style);
  const ah = style.effectiveTextAlignHorizontal();
  const av = style.effectiveTextAlignVertical();
  const deco = style.effectiveTextDecoration();
  return Object.freeze({
    font: resolver.resolve({ family: spec.family, modifier: spec.modifier, weight: spec.weight, style: spec.style }),
    fontSize: spec.size,
    fontMultiplier: spec.multiplier,
    fontModifier: spec.modifier,
    align:
      opts.defaultAlignAlways === true
        ? 'left'
        : ah === TextAlignHorizontal.Left
          ? 'left'
          : ah === TextAlignHorizontal.Right
            ? 'right'
            : 'center',
    verticalAlign: av === TextAlignVertical.Top ? 'top' : av === TextAlignVertical.Bottom ? 'bottom' : 'center',
    underline: (deco & TextDecoration.UnderLine) !== 0,
    strikeThrough: (deco & TextDecoration.StrikeThrough) !== 0,
  });
}

export interface TextLayoutInput {
  readonly text: string;
  readonly style: TextStyleSnapshot;
  /** The text box (C++ `inRect`) in canvas units. */
  readonly box: Rect;
  /** ≤ 0: no wrapping. Callers fold the padding in (box width − 2·pad). */
  readonly wrapWidth: number;
  /** Rotation about the box centre, radians (C++ `TextDrawParam.angle`). */
  readonly angle: number;
  readonly wrapMode?: WrapMode;
  /** `Style.revisionSum()` of the element's style, for the memo's fast path. */
  readonly styleRevision?: number;
}

export interface LaidOutLine {
  readonly text: string;
  readonly width: number;
  /** The anchor x for the style's alignment: left edge, centre or right edge of the line. */
  readonly x: number;
  readonly baselineY: number;
  /** Top of the line's pitch band (`top + i·LP`). */
  readonly top: number;
  readonly dir: TextDirection;
  /** UTF-16 offsets into the laid-out text. */
  readonly start: number;
  readonly end: number;
}

export interface LaidOutText {
  readonly lines: readonly LaidOutLine[];
  readonly width: number;
  readonly height: number;
  readonly lineHeight: number;
  /** The measurement key: the font string, plus `|stretch` when not normal. */
  readonly fontKey: string;
  /** The canvas/CSS font string (`ctx.font`). */
  readonly font: string;
  readonly stretch: string;
  /** Effective pixel size (size × multiplier). */
  readonly px: number;
  readonly ascent: number;
  readonly descent: number;
  /** `alphabetic`, or `top` under `lineSpacingCompat`. */
  readonly baseline: 'alphabetic' | 'top';
  readonly align: TextAlign;
  readonly underline: boolean;
  readonly strikeThrough: boolean;
  readonly box: Rect;
  readonly angle: number;
}

/** The measured part of a layout: what the memo keeps. */
interface Measured {
  readonly lines: readonly { text: string; width: number; start: number; end: number; dir: TextDirection }[];
  readonly width: number;
  readonly lineHeight: number;
  readonly fontKey: string;
  readonly font: string;
  readonly px: number;
  readonly ascent: number;
  readonly descent: number;
}

/**
 * The per-element memo (spec 03 §8.2 level 1). It dies with its element; `layout` reuses it while
 * the 11-field key is unchanged.
 */
export class TextMeasureMemo {
  key: string | null = null;
  /** @internal */
  measured: Measured | null = null;
  private fastText: string | null = null;
  private fastRev = NaN;
  private fastWidth = NaN;
  private fastEpoch = NaN;

  /** Forgets everything. */
  clear(): void {
    this.key = null;
    this.measured = null;
    this.fastText = null;
  }

  /** @internal The fast path: same text, style revision, wrap width and epoch as last time. */
  fastHit(text: string, rev: number | undefined, wrapWidth: number, epoch: number): boolean {
    return (
      rev !== undefined &&
      this.measured !== null &&
      this.fastText === text &&
      this.fastRev === rev &&
      this.fastWidth === wrapWidth &&
      this.fastEpoch === epoch
    );
  }

  /** @internal */
  remember(text: string, rev: number | undefined, wrapWidth: number, epoch: number): void {
    this.fastText = text;
    this.fastRev = rev ?? NaN;
    this.fastWidth = wrapWidth;
    this.fastEpoch = epoch;
  }
}

export interface TextLayoutOptions {
  readonly measurer: TextMeasurer;
  readonly cache: LineWidthCache;
  /** The runtime's registry: `fontEpoch` and the bundled faces' hhea metrics (OQ-38). */
  readonly fonts?: FontRegistry;
  /** Test-only switches (spec 06 §3.6); default all off. */
  readonly testing?: TextTestSwitches;
}

export class TextLayout {
  private readonly measurer: TextMeasurer;
  private readonly cache: LineWidthCache;
  private readonly fonts: FontRegistry | undefined;
  private readonly testing: TextTestSwitches;
  private readonly wrapper = new WordWrapper();
  private readonly metrics = new Lru<string, { epoch: number; ascent: number; descent: number }>(128);

  constructor(opts: TextLayoutOptions) {
    this.measurer = opts.measurer;
    this.cache = opts.cache;
    this.fonts = opts.fonts;
    this.testing = opts.testing ?? TEXT_SWITCHES_OFF;
  }

  /** The current font epoch (0 without a registry). */
  get fontEpoch(): number {
    return this.fonts?.fontEpoch ?? 0;
  }

  /** Line height for a style: 1.18 × size × multiplier (C++ web pitch under `lineSpacingCompat`). */
  lineHeight(style: Pick<TextStyleSnapshot, 'fontSize' | 'fontMultiplier'>): number {
    if (this.testing.lineSpacingCompat) return (this.testing.linePitch ?? 1.0) * style.fontSize;
    return (this.testing.linePitch ?? LINE_PITCH) * style.fontSize * style.fontMultiplier;
  }

  /** The effective wrap width: -1 when unconstrained. */
  static effectiveWrapWidth(wrapWidth: number, mode: WrapMode = 'wrap'): number {
    return mode === 'float' || !(wrapWidth > 0) ? -1 : wrapWidth;
  }

  /** The 11-field memo key (spec 03 §8.2), fields joined with U+0000, `fontEpoch` first. */
  measureKey(text: string, style: TextStyleSnapshot, wrapWidth: number, mode: WrapMode = 'wrap'): string {
    return [
      String(this.fontEpoch),
      text,
      style.font.families.join(','),
      String(style.fontSize),
      String(style.fontMultiplier),
      String(style.font.weight),
      style.font.style,
      style.fontModifier,
      mode,
      String(TextLayout.effectiveWrapWidth(wrapWidth, mode)),
      String(this.lineHeight(style)),
    ].join('\u0000');
  }

  /** Lays `input` out; with a `memo`, measures only when the key changed. */
  layout(input: TextLayoutInput, memo?: TextMeasureMemo): LaidOutText {
    const mode = input.wrapMode ?? 'wrap';
    const ww = TextLayout.effectiveWrapWidth(input.wrapWidth, mode);
    const epoch = this.fontEpoch;
    let measured: Measured;
    if (memo?.fastHit(input.text, input.styleRevision, ww, epoch) === true && memo.measured !== null) {
      measured = memo.measured;
    } else {
      const key = this.measureKey(input.text, input.style, input.wrapWidth, mode);
      if (memo !== undefined && memo.key === key && memo.measured !== null) {
        measured = memo.measured;
      } else {
        measured = this.measureText(input.text, input.style, ww);
        if (memo !== undefined) {
          memo.key = key;
          memo.measured = measured;
        }
      }
      memo?.remember(input.text, input.styleRevision, ww, epoch);
    }
    return this.place(measured, input);
  }

  /** The measured size of `text` (replaces `Platform::measureText` / `TextUtil::getTextSize`); not clamped to the constraint. */
  measure(text: string, style: TextStyleSnapshot, constraint: Size): Size {
    const m = this.measureText(text, style, constraint.width > 0 ? constraint.width : -1);
    return new Size(m.width, m.lines.length * m.lineHeight);
  }

  private measureText(text: string, style: TextStyleSnapshot, wrapWidth: number): Measured {
    const px = style.fontSize * style.fontMultiplier;
    const fontKey = buildFontKey(style.font, px);
    const epoch = this.fontEpoch;
    const measure = (s: string) =>
      this.cache.width(fontKey, s, epoch, () => this.measurer.measureLine(s, fontKey).width);
    const wrapped = this.wrapper.wrap(text, wrapWidth, measure);
    const paragraphs = new Map<number, TextDirection>();
    const hard = text.split('\n');
    let width = 0;
    const lines = wrapped.map((l) => {
      let dir = paragraphs.get(l.paragraph);
      if (dir === undefined) {
        dir = paragraphDirection(hard[l.paragraph] ?? '');
        paragraphs.set(l.paragraph, dir);
      }
      if (l.width > width) width = l.width;
      return { text: l.text, width: l.width, start: l.start, end: l.end, dir };
    });
    const { ascent, descent } = this.fontMetrics(style.font, fontKey, px, epoch);
    return {
      lines,
      width,
      lineHeight: this.lineHeight(style),
      fontKey,
      font: buildCanvasFont(style.font, px),
      px,
      ascent,
      descent,
    };
  }

  private place(m: Measured, input: TextLayoutInput): LaidOutText {
    const style = input.style;
    const box = input.box;
    const lp = m.lineHeight;
    const h = m.lines.length * lp;
    const top =
      style.verticalAlign === 'top'
        ? box.y
        : style.verticalAlign === 'bottom'
          ? box.y + box.height - h
          : box.y + box.height / 2 - h / 2;
    const compat = this.testing.lineSpacingCompat;
    const x = style.align === 'left' ? box.x : style.align === 'right' ? box.x + box.width : box.x + box.width / 2;
    const lines = m.lines.map((l, i) => {
      const lineTop = top + i * lp;
      const baselineY = compat ? lineTop : lineTop + (lp - (m.ascent + m.descent)) / 2 + m.ascent;
      return { text: l.text, width: l.width, x, baselineY, top: lineTop, dir: l.dir, start: l.start, end: l.end };
    });
    return {
      lines,
      width: m.width,
      height: h,
      lineHeight: lp,
      fontKey: m.fontKey,
      font: m.font,
      stretch: style.font.stretch,
      px: m.px,
      ascent: m.ascent,
      descent: m.descent,
      baseline: compat ? 'top' : 'alphabetic',
      align: style.align,
      underline: style.underline,
      strikeThrough: style.strikeThrough,
      box,
      angle: input.angle,
    };
  }

  /**
   * Ascent/descent of the primary font: `fontBoundingBox*` from the measurer, else the bundled
   * face's hhea metrics, else 0.8 / 0.2 × px (OQ-38). Cached per key and epoch.
   */
  private fontMetrics(
    font: ResolvedFont,
    fontKey: string,
    px: number,
    epoch: number,
  ): { ascent: number; descent: number } {
    const hit = this.metrics.get(fontKey);
    if (hit?.epoch === epoch) return hit;
    const lm = this.measurer.measureLine('Hg', fontKey);
    let ascent = lm.ascent;
    let descent = lm.descent;
    if (!Number.isFinite(ascent) || !Number.isFinite(descent)) {
      const face =
        font.primary !== '' ? this.fonts?.faceFor(font.primary, font.weight, font.style !== 'normal') : undefined;
      if (face !== undefined) {
        ascent = (face.ascender / face.unitsPerEm) * px;
        descent = (-face.descender / face.unitsPerEm) * px;
      } else {
        ascent = 0.8 * px;
        descent = 0.2 * px;
      }
    }
    const v = { epoch, ascent, descent };
    this.metrics.set(fontKey, v);
    return v;
  }
}
