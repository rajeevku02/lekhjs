// Units, lengths and document scaling (port of C++ `Measure.{h,cpp}`). Immutable values.
//
// A point is 1/144 inch (`POINTS_PER_INCH = 144`); the legacy `pixel` unit equals one point.

export const POINTS_PER_INCH = 144;

/** C++ `enum class Unit`. */
export const Unit = Object.freeze({ Point: 0, Pixel: 1, Inch: 2, Centimeter: 3 } as const);
export type Unit = (typeof Unit)[keyof typeof Unit];

/** C++ `std::round`: halves away from zero (JS `Math.round` rounds them up). */
function roundHalfAway(v: number): number {
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

/** C++ `Length`. */
export class Length {
  readonly val: number;
  readonly unit: Unit;

  constructor(val = 0, unit: Unit = Unit.Point) {
    this.val = val;
    this.unit = unit;
    Object.freeze(this);
  }

  /** The length in points, optionally rounded (C++ `points(round)`). */
  points(round = false): number {
    const v = Length.inPoints(this.val, this.unit);
    return round ? roundHalfAway(v) : v;
  }

  /** C++ `toUnit`: converts directly between inch and cm to avoid going through points. */
  toUnit(newUnit: Unit): number {
    if (this.unit === newUnit) return this.val;
    if (this.unit === Unit.Point) return Length.inUnit(this.val, newUnit);
    if (newUnit === Unit.Point) return Length.inPoints(this.val, this.unit);
    if (this.unit === Unit.Inch && newUnit === Unit.Centimeter) return this.val * 2.54;
    if (this.unit === Unit.Centimeter && newUnit === Unit.Inch) return this.val / 2.54;
    return Length.inUnit(this.points(), newUnit);
  }

  static inPoints(val: number, unit: Unit): number {
    if (unit === Unit.Inch) return val * POINTS_PER_INCH;
    if (unit === Unit.Centimeter) return (val / 2.54) * POINTS_PER_INCH;
    return val;
  }

  static inUnit(val: number, unit: Unit): number {
    if (unit === Unit.Inch) return val / POINTS_PER_INCH;
    if (unit === Unit.Centimeter) return (val / POINTS_PER_INCH) * 2.54;
    return val;
  }

  /** The serialized unit name. */
  static unitStr(unit: Unit): string {
    switch (unit) {
      case Unit.Pixel:
        return 'pixel';
      case Unit.Inch:
        return 'inch';
      case Unit.Centimeter:
        return 'cm';
      default:
        return 'point';
    }
  }

  /** Parses a unit name; anything unknown is `Point`, as in C++. */
  static unitFromStr(str: string): Unit {
    switch (str) {
      case 'pixel':
        return Unit.Pixel;
      case 'inch':
        return Unit.Inch;
      case 'cm':
        return Unit.Centimeter;
      default:
        return Unit.Point;
    }
  }
}

/** C++ `Scaling`: the document's display unit and scale. */
export class Scaling {
  readonly unit: Unit;
  readonly value: number;

  constructor(unit: Unit = Unit.Point, value = 1.0) {
    this.unit = unit;
    this.value = value;
    Object.freeze(this);
  }

  /** C++ `setDefault()`. */
  static default(): Scaling {
    return new Scaling(Unit.Point, 1.0);
  }

  /** C++ `setInchDefault()`. */
  static inchDefault(): Scaling {
    return new Scaling(Unit.Inch, 1.0);
  }

  /** Points → the document unit × scale, rounded to two decimals. */
  pointToUnit(num: number): number {
    const v = Length.inUnit(num, this.unit) * this.value;
    return roundHalfAway(v * 100) / 100;
  }

  /** The document unit → points; a non-positive scale leaves the number unchanged. */
  unitToPoint(num: number): number {
    if (this.value <= 0) return num;
    return Length.inPoints(num, this.unit) / this.value;
  }

  isDefault(): boolean {
    return this.unit === Unit.Point && this.value === 1.0;
  }
}
