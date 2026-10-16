// `info.version`: parse, compare and the accepted range (spec 04 §9.1; port of C++ `Version`,
// `L/document/Version.{h,cpp}`, and the range check of `parseMetaInfo`).
//
// Stricter than C++ `std::stoi` on purpose: a version is dot-separated non-negative integers and
// nothing else. A JSON number reads as `String(n)` (`4.2` → "4.2"). Missing components are 0, so
// "5" = "5.0", and "4.3.1" > 4.3 is accepted while "5.0.1" > 5.0 is not.
import type { JsonValue } from '../../template';
import { LoadError } from '../errors';

export class FormatVersion {
  /** The oldest format the reader opens. */
  static readonly MIN_SUPPORTED = '2.0';
  /** The newest format, and what offline saves write. */
  static readonly LATEST = '5.0';
  /** Written for a cloud board with no title and no JS generator. */
  static readonly BASE = '4.2';
  /** Written for a cloud board with a title and no JS generator. */
  static readonly TITLES = '4.3';

  readonly components: readonly number[];

  private constructor(components: readonly number[]) {
    this.components = Object.freeze(components.slice());
    Object.freeze(this);
  }

  /** The version in `value` (a string or a JSON number), or `null` when missing or malformed. */
  static parse(value: JsonValue | undefined): FormatVersion | null {
    let s: string;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) return null;
      s = String(value);
    } else if (typeof value === 'string') {
      s = value;
    } else {
      return null;
    }
    if (!/^\d+(?:\.\d+)*$/.test(s)) return null;
    return new FormatVersion(s.split('.').map((c) => Number(c)));
  }

  static of(s: string): FormatVersion {
    const v = FormatVersion.parse(s);
    if (v === null) throw new Error(`FormatVersion.of: malformed constant ${s}`);
    return v;
  }

  /** <0, 0 or >0, comparing component by component (missing ones are 0). */
  compare(other: FormatVersion): number {
    const n = Math.max(this.components.length, other.components.length);
    for (let i = 0; i < n; i++) {
      const a = this.components[i] ?? 0;
      const b = other.components[i] ?? 0;
      if (a !== b) return a < b ? -1 : 1;
    }
    return 0;
  }

  lessThan(other: FormatVersion): boolean {
    return this.compare(other) < 0;
  }
  greaterThan(other: FormatVersion): boolean {
    return this.compare(other) > 0;
  }
  equals(other: FormatVersion): boolean {
    return this.compare(other) === 0;
  }

  toString(): string {
    return this.components.join('.');
  }

  /**
   * The reader's check: `value` must be a version in [2.0, 5.0]. Above 5.0 throws
   * `format_too_new`; missing, malformed, empty or below 2.0 throws `format_invalid`.
   */
  static checkReadable(value: JsonValue | undefined): FormatVersion {
    const v = FormatVersion.parse(value);
    if (v === null) throw new LoadError('format_invalid');
    if (v.greaterThan(FormatVersion.of(FormatVersion.LATEST))) throw new LoadError('format_too_new');
    if (v.lessThan(FormatVersion.of(FormatVersion.MIN_SUPPORTED))) throw new LoadError('format_invalid');
    return v;
  }
}
