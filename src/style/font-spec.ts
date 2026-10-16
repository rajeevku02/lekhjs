// The effective font of a style (spec 02 §4 `FontSpec`): the stored font attributes after
// inheritance, plus the effective pixel size every text consumer uses (spec 06 §2). Pure data:
// resolving the family to a CSS font and building the font string is text/'s job
// (`FontNameResolver`, `buildCanvasFont`), because style/ sits below text/.
import { FontStyle, FontWeight, type Style } from './style';

export class FontSpec {
  /** Stored `fontfamily` (`""` = the platform default). */
  readonly family: string;
  /** Runtime-only C++ `platformFontFamily`; carried, not used for resolution. */
  readonly platformFamily: string;
  /** Stored `fontmodifier` (face suffix, e.g. `DemiBold`). */
  readonly modifier: string;
  readonly size: number;
  readonly multiplier: number;
  readonly weight: FontWeight;
  readonly style: FontStyle;

  constructor(init: {
    family?: string;
    platformFamily?: string;
    modifier?: string;
    size?: number;
    multiplier?: number;
    weight?: FontWeight;
    style?: FontStyle;
  }) {
    this.family = init.family ?? '';
    this.platformFamily = init.platformFamily ?? '';
    this.modifier = init.modifier ?? '';
    this.size = init.size ?? 15;
    this.multiplier = init.multiplier ?? 1;
    this.weight = init.weight ?? FontWeight.Normal;
    this.style = init.style ?? FontStyle.Normal;
    Object.freeze(this);
  }

  /** The effective font of `style` (every field inherited through `Style.parent`). */
  static of(style: Style): FontSpec {
    return new FontSpec({
      family: style.effectiveFontFamily(),
      platformFamily: style.effectivePlatformFontFamily(),
      modifier: style.effectiveFontModifier(),
      size: style.effectiveFontSize(),
      multiplier: style.effectiveFontMultiplier(),
      weight: style.effectiveFontWeight(),
      style: style.effectiveFontStyle(),
    });
  }

  /** `effectiveFontSize × effectiveFontMultiplier` (spec 06 §2): the one size every consumer uses. */
  get px(): number {
    return effectiveFontPx(this.size, this.multiplier);
  }

  get bold(): boolean {
    return this.weight === FontWeight.Bold;
  }

  get italic(): boolean {
    return this.style === FontStyle.Italic || this.style === FontStyle.Oblique;
  }
}

/** Size × multiplier (spec 06 §2). */
export function effectiveFontPx(size: number, multiplier: number): number {
  return size * multiplier;
}
