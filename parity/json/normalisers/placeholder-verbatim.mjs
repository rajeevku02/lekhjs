// Normaliser `placeholder-verbatim` (DR-GEN-14). A script generator under a template id that is
// not one of the 34 wireframe ids is a placeholder in lekhjs (spec 04 §7.4): its template JSON is
// written back verbatim. C++ resolved the Lua (`scriptfile` or `script`) and ran it, so it wrote a
// regenerated template. At a `template` path: true when the TS template is such a placeholder and
// equals the input's template (scripts aside); null when it is not a placeholder.
import { wireframeIds, scriptKind } from './generator-script.mjs';
import { obj, sameValue, withoutScript } from './util.mjs';

export const name = 'placeholder-verbatim';

/** @param {any} cpp @param {any} ts @param {any} input */
export function equal(cpp, ts, input) {
  const t = obj(ts);
  if (t === null || typeof t['id'] !== 'string' || wireframeIds().has(t['id'])) return null;
  const g = obj(t['generator']);
  if (g === null || scriptKind(g) === null) return null;
  if (input === undefined) return false;
  const c = obj(cpp);
  if (c === null || c['id'] !== t['id']) return false;
  return sameValue(t, withoutScript(input));
}
