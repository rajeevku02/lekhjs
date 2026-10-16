// Fuzzy cost interval (port of C++ `recognizer::RangeNumber`), with C++ `recognizer::Probability`
// merged in (spec 02 §1.2: `Probability` is merged into `RangeNumber`). Immutable: the C++
// in-place `add`/`divide` return a new value.

/** C++ `Probability::Type`. */
export const ProbabilityType = Object.freeze({ Crisp: 0, Fuzzy: 1, Indeterminate: 2 } as const);
export type ProbabilityType = (typeof ProbabilityType)[keyof typeof ProbabilityType];

/** C++ `recognizer::Probability`: a value in [0, 1], read as a boolean above 0.5. */
export class Probability {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }

  /** True above 0.5. */
  boolValue(): boolean {
    return this.value > 0.5;
  }

  /** Crisp for exactly 0 or 1, Indeterminate for NaN or ±∞, else Fuzzy. */
  type(): ProbabilityType {
    if (!Number.isFinite(this.value)) return ProbabilityType.Indeterminate;
    if (this.value === 0 || this.value === 1) return ProbabilityType.Crisp;
    return ProbabilityType.Fuzzy;
  }
}

/**
 * An interval `[start, end]` used for line costs. The comparisons compare the mid-points and give
 * a crisp `Probability` (0 or 1), as in C++ (whose TODO to compute real probabilities is kept).
 */
export class RangeNumber {
  readonly start: number;
  readonly end: number;

  constructor(start = 0, end = 0) {
    this.start = start;
    this.end = end;
  }

  /** C++ `add`: both ends summed. */
  add(other: RangeNumber): RangeNumber {
    return new RangeNumber(this.start + other.start, this.end + other.end);
  }

  /** C++ `divide(long)`: both ends divided by `num`. */
  divide(num: number): RangeNumber {
    return new RangeNumber(this.start / num, this.end / num);
  }

  greaterThan(other: RangeNumber): Probability {
    return new Probability(this.mid() > other.mid() ? 1 : 0);
  }

  lessThan(other: RangeNumber): Probability {
    return new Probability(this.mid() < other.mid() ? 1 : 0);
  }

  equalsTo(other: RangeNumber): Probability {
    return new Probability(this.mid() === other.mid() ? 1 : 0);
  }

  /** C++ `isZero`: 1 when `end` is 0 (the start is not looked at, as in C++). */
  isZero(): Probability {
    return new Probability(this.end !== 0 ? 0 : 1);
  }

  private mid(): number {
    return (this.start + this.end) / 2;
  }
}
