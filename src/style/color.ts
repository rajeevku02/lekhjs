// ARGB colour (port of C++ `color_t` and `HSV`, `base/TypeDefinitions.h`). Immutable: the C++
// setters (`setRed`, …) become `with*` copies. Channels are integers 0-255.
//
// Placement: spec 02 §2 lists `Color` under `base/`; it is here because `style/` is its first
// user and E2 owns `style/` (recorded in the E2 summary).

/** C++ `HSV`: h in degrees [0, 360), s and v in [0, 1]. */
export interface Hsv {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

export class Color {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;

  /** C++ `color_t(r, g, b, a)`; the default is opaque black, as `color_t()`. */
  constructor(red = 0, green = 0, blue = 0, alpha = 0xff) {
    this.red = red & 0xff;
    this.green = green & 0xff;
    this.blue = blue & 0xff;
    this.alpha = alpha & 0xff;
    Object.freeze(this);
  }

  /**
   * C++ `color_t(unsigned)`: `0xAARRGGBB`. Stored boards hold the value as a signed 32-bit
   * integer (`-16777216` is opaque black), so a negative input reads as its unsigned bits.
   */
  static fromInt(value: number): Color {
    const v = value >>> 0;
    return new Color((v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff, (v >>> 24) & 0xff);
  }

  /** C++ `toInt()` read back as a signed 32-bit integer, the form the serializer writes. */
  toInt(): number {
    return (this.alpha << 24) | (this.red << 16) | (this.green << 8) | this.blue | 0;
  }

  /** The unsigned `0xAARRGGBB` value. */
  toUint(): number {
    return this.toInt() >>> 0;
  }

  /** C++ `equals`: two fully transparent colours are equal whatever their RGB. */
  equals(other: Color): boolean {
    if (other.alpha === 0 && this.alpha === 0) return true;
    return (
      this.red === other.red && this.green === other.green && this.blue === other.blue && this.alpha === other.alpha
    );
  }

  /**
   * C++ `disabled()`: 60 % towards white. The C++ computes `(int)(255·0.6f + 0.4f·c)` in float;
   * the integer form below gives the same channel for every c in 0-255.
   */
  disabled(): Color {
    const d = (c: number) => Math.floor((1530 + 4 * c) / 10);
    return new Color(d(this.red), d(this.green), d(this.blue), this.alpha);
  }

  /** C++ `inverted()`. */
  inverted(): Color {
    return new Color(255 - this.red, 255 - this.green, 255 - this.blue, this.alpha);
  }

  withRed(r: number): Color {
    return new Color(r, this.green, this.blue, this.alpha);
  }
  withGreen(g: number): Color {
    return new Color(this.red, g, this.blue, this.alpha);
  }
  withBlue(b: number): Color {
    return new Color(this.red, this.green, b, this.alpha);
  }
  withAlpha(a: number): Color {
    return new Color(this.red, this.green, this.blue, a);
  }

  /** CSS `rgba(r, g, b, a)`, as the web platform writes it (`util.colorStr`). */
  toCss(): string {
    return `rgba(${String(this.red)}, ${String(this.green)}, ${String(this.blue)}, ${String(this.alpha / 255)})`;
  }

  /** C++ `toHsv()`. */
  toHsv(): Hsv {
    const r = this.red / 255;
    const g = this.green / 255;
    const b = this.blue / 255;
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    const v = max;
    const delta = max - min;
    if (delta < 0.00001) return { h: 0, s: 0, v };
    if (max <= 0) return { h: 0, s: 0, v };
    const s = delta / max;
    let h: number;
    if (r >= max) h = (g - b) / delta;
    else if (g >= max) h = 2.0 + (b - r) / delta;
    else h = 4.0 + (r - g) / delta;
    h *= 60.0;
    if (h < 0.0) h += 360.0;
    return { h, s, v };
  }

  /** C++ `color_t::fromHSV` (channels truncated as the C++ `unsigned` conversion does). */
  static fromHsv(hsv: Hsv): Color {
    const mk = (r: number, g: number, b: number) =>
      new Color(Math.trunc(r * 255), Math.trunc(g * 255), Math.trunc(b * 255));
    const { s, v } = hsv;
    if (s <= 0.0) return mk(v, v, v);
    let hh = hsv.h;
    if (hh >= 360.0) hh = 0.0;
    hh /= 60.0;
    const i = Math.trunc(hh);
    const ff = hh - i;
    const p = v * (1.0 - s);
    const q = v * (1.0 - s * ff);
    const t = v * (1.0 - s * (1.0 - ff));
    switch (i) {
      case 0:
        return mk(v, t, p);
      case 1:
        return mk(q, v, p);
      case 2:
        return mk(p, v, t);
      case 3:
        return mk(p, q, v);
      case 4:
        return mk(t, p, v);
      default:
        return mk(v, p, q);
    }
  }
}

/** Opaque black, C++ `color_t()`. */
export const BLACK: Color = Object.freeze(new Color(0, 0, 0, 0xff));
