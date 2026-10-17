// The Lua semantics the hand-ported wireframe modules keep (spec 04 §5.3, §5.5). Modules import
// these and nothing stateful: they are bundled, with this file, into the canonical JS text.

/** A parameter value as a module receives it (C++ `pushParamsTable`). */
export type ParamValue = number | string | boolean | null | undefined;

/** Lua truthiness: everything but `nil` and `false` (0 and '' are true). */
export function truthy(v: ParamValue): boolean {
  return v !== null && v !== undefined && v !== false;
}

/**
 * A number inside a data-expression string, as Lua 5.3 `tostring` wrote a float (spec 04 §5.5;
 * orchestrator decision in B4, superseding DR-GEN-13): `%.14g`, with `.0` on a whole value, so the
 * generated text is byte-compatible with what the C++ engine wrote into stored boards (`"23.0"`,
 * `"-28.680000305176"`). The values the scripts held as Lua integers (indices, loop counters) are
 * formatted with `String` at their call sites, as Lua printed them without `.0`.
 */
export function num(x: number): string {
  return luaFloatString(x);
}

/**
 * Lua 5.3 `tostring` of a value the script held as an INTEGER (an integer literal, a counter, a sum
 * that has not yet had a float added): plain digits, no `.0`.
 */
export function int(x: number): string {
  return Object.is(x, -0) ? '0' : String(x);
}

/** `int(x)` when Lua held `x` as an integer, else `num(x)`. */
export function lnum(x: number, integer: boolean): string {
  return integer ? int(x) : num(x);
}

/**
 * A number that came from a template parameter: C++ `pushParamsTable` pushed an integer JSON value
 * with `lua_pushinteger` and any other with `lua_pushnumber`, so an integral value prints without
 * `.0` (the oracle's `Number.isInteger` rule).
 */
export function pnum(x: number): string {
  return Number.isInteger(x) ? int(x) : num(x);
}

/** Lua 5.3 `tostring` of a float: `%.14g`, `.0` appended when the result reads as an integer. */
export function luaFloatString(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  let s: string;
  if (x === 0) {
    s = Object.is(x, -0) ? '-0' : '0';
  } else {
    const [mant = '0', expS = '0'] = x.toExponential(13).split('e');
    const exp = Number(expS);
    if (exp < -4 || exp >= 14) {
      const m = mant.includes('.') ? mant.replace(/0+$/, '').replace(/\.$/, '') : mant;
      s = `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
    } else {
      s = x.toFixed(13 - exp);
      if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
  }
  return /^-?\d+$/.test(s) ? `${s}.0` : s;
}

/**
 * Lua `..` of one operand: a string as is, a number formatted, anything else raises (Lua: "attempt
 * to concatenate a … value"), which fails the generation as it did in C++.
 */
export function str(v: ParamValue): string {
  if (typeof v === 'string') return v;
  // A parameter value: an integral one was pushed as a Lua integer (`pnum`).
  if (typeof v === 'number') return pnum(v);
  throw new TypeError(`attempt to concatenate a ${v === null || v === undefined ? 'nil' : typeof v} value`);
}

/** `i, i+1, …, i+n-1` as an index list (the scripts' `for` loops over `tostring(dataEnd+i)`). */
export function indexList(start: number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(String(start + i));
  return out.join(' ');
}
