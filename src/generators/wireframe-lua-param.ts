// Lua value semantics for parameters that the later wireframe ports (G4) need, kept apart from
// `wireframe-lua.ts` so that adding them leaves the canonical texts of the other modules as they
// were (esbuild's minified names depend on the whole bundled graph).
import { str, type ParamValue } from './wireframe-lua';

/** Lua `tostring` of a parameter value: `nil`, `true`/`false`, numbers by `pnum` (an integral parameter is a Lua integer), strings as is. */
export function luaToString(v: ParamValue): string {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return str(v);
}

/**
 * The scripts' `position` clamp: `if pos == nil then pos = 0 end`, then `pos < 0` → 0 and
 * `pos > 1` → 1. Lua 5.3 compares a number only with a number, so any other value (a string, even
 * a numeric one, or a boolean) raises, which fails the generation as it did in C++.
 */
export function clampPosition(v: ParamValue): number {
  if (v === null || v === undefined) return 0;
  if (typeof v !== 'number') throw new TypeError(`attempt to compare ${typeof v} with number`);
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
