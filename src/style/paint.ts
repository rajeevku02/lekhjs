// Fill/stroke paint, gradients and shadow (port of C++ `Style::Paint`, `Style::Gradient`,
// `Style::Shadow`). Immutable value types. The C++ `computed*` gradient coordinates are not
// here: they are layout output, computed into the layout and never into the style (B10, spec 03
// §15).
import type { Color } from './color';
import { BLACK } from './color';

/** C++ `Paint::Type` (the serialized numbers). `LinearGradient` is the C++ `PaintTypeLinerGradient`. */
export const PaintType = Object.freeze({
  Default: 0,
  NoPaint: 1,
  Solid: 2,
  LinearGradient: 3,
  RadialGradient: 4,
  Pattern: 5,
} as const);
export type PaintType = (typeof PaintType)[keyof typeof PaintType];

/** C++ `Paint::FillRule`. */
export const FillRule = Object.freeze({ Default: 0, NonZero: 1, EvenOdd: 2 } as const);
export type FillRule = (typeof FillRule)[keyof typeof FillRule];

/** C++ `Gradient::Spread`. */
export const GradientSpread = Object.freeze({ Default: 0, Pad: 1, Repeat: 2, Reflect: 3 } as const);
export type GradientSpread = (typeof GradientSpread)[keyof typeof GradientSpread];

/** C++ `Gradient::Type`. */
export const GradientType = Object.freeze({ Linear: 0, Radial: 1 } as const);
export type GradientType = (typeof GradientType)[keyof typeof GradientType];

/** C++ `Gradient::Stop`. */
export interface GradientStop {
  readonly offset: number;
  readonly color: Color;
}

/** C++ `Gradient::Linear` without the computed coordinates. */
export interface LinearGradientSpec {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stops: readonly GradientStop[];
  readonly spread: GradientSpread;
}

/** C++ `Gradient::Radial` without the computed coordinates. */
export interface RadialGradientSpec {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fx: number;
  readonly fy: number;
  readonly fr: number;
  readonly stops: readonly GradientStop[];
  readonly spread: GradientSpread;
}

export const EMPTY_LINEAR_GRADIENT: LinearGradientSpec = Object.freeze({
  x1: 0,
  y1: 0,
  x2: 0,
  y2: 0,
  stops: Object.freeze([]),
  spread: GradientSpread.Default,
});

export const EMPTY_RADIAL_GRADIENT: RadialGradientSpec = Object.freeze({
  cx: 0,
  cy: 0,
  r: 0,
  fx: 0,
  fy: 0,
  fr: 0,
  stops: Object.freeze([]),
  spread: GradientSpread.Default,
});

/** Namespace-free helpers for gradients (spec 02 §4 `Gradient`). */
export const Gradient = Object.freeze({
  linear(g: Partial<LinearGradientSpec>): LinearGradientSpec {
    return Object.freeze({ ...EMPTY_LINEAR_GRADIENT, ...g, stops: Object.freeze([...(g.stops ?? [])]) });
  },
  radial(g: Partial<RadialGradientSpec>): RadialGradientSpec {
    return Object.freeze({ ...EMPTY_RADIAL_GRADIENT, ...g, stops: Object.freeze([...(g.stops ?? [])]) });
  },
});

export interface PaintInit {
  type?: PaintType;
  fillRule?: FillRule;
  solidColor?: Color;
  linearGradient?: LinearGradientSpec;
  radialGradient?: RadialGradientSpec;
}

/** C++ `Style::Paint`. The default is C++ `Paint()`: no paint, default fill rule, black. */
export class Paint {
  readonly type: PaintType;
  readonly fillRule: FillRule;
  readonly solidColor: Color;
  readonly linearGradient: LinearGradientSpec;
  readonly radialGradient: RadialGradientSpec;

  constructor(init: PaintInit = {}) {
    this.type = init.type ?? PaintType.NoPaint;
    this.fillRule = init.fillRule ?? FillRule.Default;
    this.solidColor = init.solidColor ?? BLACK;
    this.linearGradient = init.linearGradient ?? EMPTY_LINEAR_GRADIENT;
    this.radialGradient = init.radialGradient ?? EMPTY_RADIAL_GRADIENT;
    Object.freeze(this);
  }

  static solid(color: Color): Paint {
    return new Paint({ type: PaintType.Solid, solidColor: color });
  }

  /** A copy with the given fields replaced (the C++ copy-then-assign idiom). */
  with(init: PaintInit): Paint {
    return new Paint({
      type: this.type,
      fillRule: this.fillRule,
      solidColor: this.solidColor,
      linearGradient: this.linearGradient,
      radialGradient: this.radialGradient,
      ...init,
    });
  }

  /**
   * C++ `Paint::equals`: same type; NoPaint and Default are then equal; Solid compares the
   * colour; gradients and patterns compare equal on type alone (the C++ "TODO: for gradient").
   */
  equals(other: Paint): boolean {
    if (other.type !== this.type) return false;
    if (this.type === PaintType.NoPaint || this.type === PaintType.Default) return true;
    if (this.type === PaintType.Solid) return this.solidColor.equals(other.solidColor);
    return true;
  }
}

/** C++ `Paint` with `type = PaintTypeDefault`: the "not set" marker of a style slot. */
export const DEFAULT_PAINT: Paint = Object.freeze(new Paint({ type: PaintType.Default }));
/** C++ `Paint()`: no paint. */
export const NO_PAINT: Paint = Object.freeze(new Paint({ type: PaintType.NoPaint }));

/** C++ `Style::Shadow`; a negative radius means "no shadow". Read and written, never drawn. */
export class Shadow {
  readonly dx: number;
  readonly dy: number;
  readonly radius: number;
  readonly color: Color;

  constructor(dx = 0, dy = 0, radius = -1, color: Color = BLACK) {
    this.dx = dx;
    this.dy = dy;
    this.radius = radius;
    this.color = color;
    Object.freeze(this);
  }

  /** C++ `operator==`: two "no shadow" values are equal whatever their other fields. */
  equals(other: Shadow): boolean {
    if (other.radius < 0 && this.radius < 0) return true;
    return (
      other.radius === this.radius && other.color.equals(this.color) && other.dx === this.dx && other.dy === this.dy
    );
  }
}

/** The C++ default shadow (radius -1). */
export const NO_SHADOW: Shadow = Object.freeze(new Shadow());
