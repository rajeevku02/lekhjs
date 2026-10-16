// The `fontmodifier` tokens of spec 06 §8.3 (`lekhjs/src/text/font-modifier.ts`), restated here
// because parity/ does not import lekhjs/src: a modifier changes the face when every part of it is
// a known token and it names a weight other than 400, a style or a stretch.
const TOKENS = Object.freeze([
  ['ultralight', 200],
  ['extralight', 200],
  ['extrabold', 800],
  ['condensed', -1],
  ['compressed', -1],
  ['semibold', 600],
  ['demibold', 600],
  ['expanded', -1],
  ['regular', 400],
  ['oblique', -1],
  ['italic', -1],
  ['medium', 500],
  ['light', 300],
  ['heavy', 800],
  ['black', 900],
  ['roman', 400],
  ['thin', 100],
  ['bold', 700],
  ['book', 400],
  ['wide', -1],
]);

/** @param {string} modifier */
export function modifierChangesFace(modifier) {
  let rest = modifier.toLowerCase().replace(/[\s_-]/g, '');
  if (rest === '') return false;
  let changes = false;
  while (rest.length > 0) {
    const hit = TOKENS.find(([t]) => rest.startsWith(/** @type {string} */ (t)));
    if (hit === undefined) return false;
    const [tok, w] = /** @type {[string, number]} */ (hit);
    if (w !== 400) changes = true;
    rest = rest.slice(tok.length);
  }
  return changes;
}
