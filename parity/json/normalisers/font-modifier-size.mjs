// Normaliser `font-modifier-size` (DR-TXT-04). lekhjs honours `fontmodifier` (a face suffix such
// as `Black` or `DemiBold`) on every platform (spec 06 §8.3); the C++ web and backend ignore it,
// so an auto-sized text box measures with a different face and gets a different `width`/`height`.
// At an object path: true when the two objects differ only in `params/width` and `params/height`
// and the object's template style (or own style) names a modifier that changes the face; null
// when there is no such modifier.
import { modifierChangesFace } from './modifier-tokens.mjs';
import { obj, sameValue } from './util.mjs';

export const name = 'font-modifier-size';

const SIZE = new Set(['params/width', 'params/height']);

/** @param {any} o */
function modifierOf(o) {
  for (const s of [obj(obj(o['template'])?.['style']), obj(o['style'])]) {
    const m = s?.['fontmodifier'];
    if (typeof m === 'string' && modifierChangesFace(m)) return m;
  }
  return null;
}

/** @param {any} cpp @param {any} ts */
export function equal(cpp, ts) {
  const c = obj(cpp);
  const t = obj(ts);
  if (c === null || t === null) return null;
  if (modifierOf(c) === null || modifierOf(t) === null) return null;
  return sameValue(c, t, SIZE);
}
