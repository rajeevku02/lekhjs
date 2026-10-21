// Normaliser `unknown-generator-kept` (DR-GEN-12). A template whose generator is not a script
// (a native shape or a generator type) that no engine knows: C++ ShapeGenerator::getGenerator built
// nothing and the block was dropped on write (with the default angle added); lekhjs keeps it as a
// placeholder and writes the template back as read. At a `template` path: true when the input and
// TS templates hold a non-script generator, C++ wrote no generator and TS wrote the input's
// template; null otherwise (a script generator is `placeholder-verbatim`'s, DR-GEN-14).
import { scriptKind } from './generator-script.mjs';
import { obj, sameValue } from './util.mjs';

export const name = 'unknown-generator-kept';

/** @param {any} cpp @param {any} ts @param {any} input */
export function equal(cpp, ts, input) {
  const t = obj(ts);
  const g = t === null ? null : obj(t['generator']);
  if (t === null || g === null || scriptKind(g) !== null) return null;
  const c = obj(cpp);
  if (c === null || c['generator'] !== undefined || input === undefined) return null;
  return sameValue(t, input) ? true : null;
}
