// The Lua semantics the hand-ported wireframe modules keep (spec 04 §5.3, §5.5). Modules import
// these and nothing stateful: they are bundled, with this file, into the canonical JS text.

/** A parameter value as a module receives it (C++ `pushParamsTable`). */
export type ParamValue = number | string | boolean | null | undefined;

/** Lua truthiness: everything but `nil` and `false` (0 and '' are true). */
export function truthy(v: ParamValue): boolean {
  return v !== null && v !== undefined && v !== false;
}

/**
 * A number inside a data-expression string: JS shortest round-trip, `-0` as `0` (spec 04 §5.5).
 * Lua's `%.14g` and float32 widening are not reproduced (DR-GEN-13); the comparison evaluates the
 * expressions instead of comparing text.
 */
export function num(x: number): string {
  return Object.is(x, -0) ? '0' : String(x);
}

/**
 * Lua `..` of one operand: a string as is, a number formatted, anything else raises (Lua: "attempt
 * to concatenate a … value"), which fails the generation as it did in C++.
 */
export function str(v: ParamValue): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return num(v);
  throw new TypeError(`attempt to concatenate a ${v === null || v === undefined ? 'nil' : typeof v} value`);
}

/** `i, i+1, …, i+n-1` as an index list (the scripts' `for` loops over `tostring(dataEnd+i)`). */
export function indexList(start: number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(String(start + i));
  return out.join(' ');
}
