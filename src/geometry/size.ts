// Width/height value (port of C++ `geometry::Size`) and the `Range` value type.

export class Size {
  readonly width: number;
  readonly height: number;

  constructor(width = 0, height = 0) {
    this.width = width;
    this.height = height;
  }

  equals(other: Size): boolean {
    return other.width === this.width && other.height === this.height;
  }
}

/** C++ `geometry::Range`: a parameter interval, e.g. of a Bézier curve. */
export interface Range {
  readonly start: number;
  readonly end: number;
}
