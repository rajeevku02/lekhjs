// What a live template reads from its surroundings. C++ reached globals for all of it
// (`Platform::currentPlatform` for text and images, `Config::instance()`, `TemplateStore::instance()`
// and `LekhGlobal` for embeds); here a session builds one `TemplateEnv` and every template it
// creates holds it (spec 03 §1 rule 3, spec 01 C4).
import type { ConfigValues } from '../base';
import type { Rect, Size } from '../geometry';
import type { DecodedImage } from '../render';
import type { Style } from '../style';
import {
  textStyleSnapshot,
  type FontNameResolver,
  type LaidOutText,
  type TextLayout,
  type TextMeasureMemo,
  type WrapMode,
} from '../text';
import type { GeneratorContext } from './generator/generator-context';
import type { ShapeTemplate } from './model/shape-template';
import type { TemplateResolver } from './catalog/template-resolver';

/** The engine tunables a template reads (C++ `Config::instance()` fields). */
export type TemplateConfig = Pick<
  ConfigValues,
  | 'alignmentPad'
  | 'textObjectBoundsAdjust'
  | 'intersectionSnapDist'
  | 'regulaizeShape'
  | 'parallelogramRegularizeAngle'
  | 'minTextEditWidth'
>;

/** Content-free warnings a template emits (spec 03 §14, spec 04 §5.1). */
export type TemplateWarningCode = 'expression_invalid' | 'generator_failed' | 'embed_cycle';

/** Text measuring and layout for templates (spec 03 §8.3: one path, `measureSlot`). */
export interface TemplateText {
  /** C++ `Platform::getTextSize(text, style, constraint)`: −1 = unconstrained. */
  measure(text: string, style: Style, constraint: Size): Size;
  /** Lays `text` out in `box`; `wrapWidth` ≤ 0 means no wrapping. */
  layout(
    text: string,
    style: Style,
    box: Rect,
    wrapWidth: number,
    angle: number,
    wrapMode: WrapMode,
    memo?: TextMeasureMemo,
  ): LaidOutText;
}

export interface TemplateEnv {
  readonly config: TemplateConfig;
  readonly text: TemplateText;
  /** Embeds and by-reference templates (C++ `TemplateStore` + the document's templates). */
  readonly resolver: TemplateResolver;
  /** A decoded image by its key (a URL, or the `data:` key of an inline image), if loaded. */
  image(key: string): DecodedImage | undefined;
  /**
   * Whether the image under `key` is still loading, for the live view's placeholder label
   * (`ShapeImageElement`). False (or absent) for every other draw: export, thumbnails, the backend.
   */
  imageLoading?(key: string): boolean;
  /** The host functions a generator may call, bound to `t` (spec 04 §5.1). */
  generatorContext(t: ShapeTemplate): GeneratorContext;
  warn(code: TemplateWarningCode, details: Readonly<Record<string, string | number>>): void;
}

/** `TemplateText` over the runtime's `TextLayout` and `FontNameResolver` (the text/ stack). */
/** Receives every `measure` while tapped (`TemplateTextService.tapMeasures`). */
export type MeasureTap = (text: string, style: Style, constraint: Size, size: Size) => void;

export class TemplateTextService implements TemplateText {
  private readonly layout_: TextLayout;
  private readonly resolver_: FontNameResolver;
  private tap_: MeasureTap | null = null;

  constructor(layout: TextLayout, resolver: FontNameResolver) {
    this.layout_ = layout;
    this.resolver_ = resolver;
  }

  measure(text: string, style: Style, constraint: Size): Size {
    const size = this.layout_.measure(text, textStyleSnapshot(style, this.resolver_), constraint);
    this.tap_?.(text, style, constraint, size);
    return size;
  }

  /**
   * Runs `fn` with every `measure` also reported to `tap`: the recognizer's snapshot builder
   * records the sizes a re-read of the snapshot objects measures, so the worker, which never
   * measures text, can answer the same calls (spec 07 §6.4, §6.7).
   */
  tapMeasures<T>(tap: MeasureTap, fn: () => T): T {
    const prev = this.tap_;
    this.tap_ = tap;
    try {
      return fn();
    } finally {
      this.tap_ = prev;
    }
  }

  layout(
    text: string,
    style: Style,
    box: Rect,
    wrapWidth: number,
    angle: number,
    wrapMode: WrapMode,
    memo?: TextMeasureMemo,
  ): LaidOutText {
    return this.layout_.layout(
      {
        text,
        style: textStyleSnapshot(style, this.resolver_),
        box,
        wrapWidth,
        angle,
        wrapMode,
        styleRevision: style.revisionSum(),
      },
      memo,
    );
  }
}
