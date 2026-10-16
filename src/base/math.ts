// Numeric helpers (port of C++ `math::MathUtil` and the numeric half of `base::BaseUtil`).
// Plain doubles throughout; `PI` is `Math.PI` (OQ-46).

/** C++ `base/Const.h`. Kept at their C++ values: they are tuned constants, not sin/cos of 30°. */
export const SIN30 = 0.49999;
export const COS30 = 0.86602;
export const SQRT2 = 1.4142135623730951;
export const SQRT3 = 1.7320508075688772;

/** C++ `INT_MAX`, used as "no distance yet" by several geometry functions. */
export const INT_MAX = 2147483647;

/** C++ `BaseUtil::round`: floor(d + 0.5). */
export function roundHalfUp(d: number): number {
  return Math.floor(d + 0.5);
}

/** C++ `(int)x` of a finite double: truncation toward zero. */
export function toInt(x: number): number {
  return Math.trunc(x);
}

function sgn(x: number): number {
  return x < 0 ? -1 : 1;
}

/** Real roots of a·x² + b·x + c = 0 (degree drops when a = 0), in the C++ order. */
export function solveQuadEquation(a: number, b: number, c: number): number[] {
  const out: number[] = [];
  if (a === 0) {
    if (b !== 0) out.push(-c / b);
    return out;
  }
  let d = b * b - 4 * a * c;
  if (d < 0) return out;
  if (d === 0) {
    out.push(-b / (2 * a));
  } else {
    d = Math.sqrt(d);
    out.push((-b + d) / (2 * a));
    out.push((-b - d) / (2 * a));
  }
  return out;
}

/** Real roots of a·x³ + b·x² + c·x + d = 0, deduplicated within 1e-4, in the C++ order. */
export function solveCubic(a: number, b: number, c: number, d: number): number[] {
  if (a === 0) return solveQuadEquation(b, c, d);

  const A = b / a;
  const B = c / a;
  const C = d / a;
  const Q = (3 * B - A ** 2) / 9.0;
  const R = (9 * A * B - 27 * C - 2 * A ** 3) / 54.0;
  const D = Q ** 3 + R ** 2;

  const t: number[] = [];
  if (D >= 0) {
    const S = sgn(R + Math.sqrt(D)) * Math.abs(R + Math.sqrt(D)) ** (1.0 / 3.0);
    const T = sgn(R - Math.sqrt(D)) * Math.abs(R - Math.sqrt(D)) ** (1.0 / 3.0);
    t.push(-A / 3 + (S + T));
    const Im = Math.abs((Math.sqrt(3) * (S - T)) / 2.0);
    if (Im === 0) {
      t.push(-A / 3 - (S + T) / 2);
      t.push(-A / 3 - (S + T) / 2);
    }
  } else {
    const th = Math.acos(R / Math.sqrt(-(Q ** 3)));
    t.push(2 * Math.sqrt(-Q) * Math.cos(th / 3.0) - A / 3.0);
    t.push(2 * Math.sqrt(-Q) * Math.cos((th + 2 * Math.PI) / 3.0) - A / 3.0);
    t.push(2 * Math.sqrt(-Q) * Math.cos((th + 4 * Math.PI) / 3.0) - A / 3.0);
  }

  const sln: number[] = [];
  const delta = 0.0001;
  for (const val of t) {
    let exists = false;
    for (const s of sln) {
      if (s - delta < val && s + delta > val) exists = true;
    }
    if (!exists) sln.push(val);
  }
  return sln;
}

/**
 * A number as C++ `std::ostream << value` writes it with the default flags: `%g` with six
 * significant digits (`0.25`, `-0.333333`, `1e-05`, `1.23457e+06`).
 */
export function formatG6(value: number): string {
  if (Number.isNaN(value)) return value < 0 ? '-nan' : 'nan';
  if (!Number.isFinite(value)) return value < 0 ? '-inf' : 'inf';
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  const precision = 6;
  const exp = Number(value.toExponential(precision - 1).split('e')[1]);
  if (exp < -4 || exp >= precision) {
    const [mant = '', e = ''] = value.toExponential(precision - 1).split('e');
    const m = mant.includes('.') ? mant.replace(/0+$/, '').replace(/\.$/, '') : mant;
    const en = Number(e);
    const sign = en < 0 ? '-' : '+';
    const digits = String(Math.abs(en)).padStart(2, '0');
    return `${m}e${sign}${digits}`;
  }
  const fixed = value.toFixed(Math.max(0, precision - 1 - exp));
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}
