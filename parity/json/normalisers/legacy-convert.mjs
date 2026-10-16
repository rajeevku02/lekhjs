// Normaliser `legacy-convert` (DR-ENG-12). C++ keeps six JSON legacy object types (circle,
// ellipse, polygon, curve, text, image) as legacy objects and writes them back as legacy; lekhjs
// converts them on load (spec 03 §10.4) and writes a templated object. At an object path whose
// C++ `type` is legacy: true when the TS object is the conversion of the C++ one — same `order`,
// centre, rotation and (where the legacy type stores one) size; the text and the style carried
// into the template; the catalogue template the converter uses; an image keeps the stored bytes
// (the input's `data`; C++ re-encoded them). Null when the C++ object is not legacy.
import { num, obj, sameValue } from './util.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { withinTolerance } = /** @type {typeof import('../tolerance.cjs')} */ (require('../tolerance.cjs'));

export const name = 'legacy-convert';

/** Legacy type → the catalogue template the converter instantiates (null: a computed template). */
const TEMPLATE = Object.freeze({
  'avabodh.basic.text': 'avabodh.basic.text',
  'avabodh.basic.image': 'avabodh.basic.image',
  'avabodh.basic.ellipse': 'avabodh.basic.ellipse',
  'avabodh.basic.circle': 'avabodh.basic.ellipse',
  'avabodh.basic.polygon': null,
  'avabodh.basic.curve': null,
});

/** @param {any} a @param {any} b */
const close = (a, b) => a !== null && b !== null && withinTolerance(a, b);

/** @param {any} cpp @param {any} ts @param {any} input */
export function equal(cpp, ts, input) {
  const c = obj(cpp);
  if (c === null || typeof c['type'] !== 'string' || !Object.hasOwn(TEMPLATE, c['type'])) return null;
  const type = /** @type {keyof typeof TEMPLATE} */ (c['type']);
  const t = obj(ts);
  if (t === null || t['type'] !== 'templated') return false;
  if (num(c['order']) !== num(t['order'])) return false;
  const tmpl = obj(t['template']);
  const params = obj(t['params']);
  if (tmpl === null || params === null) return false;
  const want = TEMPLATE[type];
  if (want !== null && tmpl['id'] !== want) return false;
  const centre = obj(c['center']);
  if (type === 'avabodh.basic.circle') {
    // C++ `CircleObject::getSelectionRectangle`: integer-truncated, one unit of margin.
    const cx = num(centre?.['x']);
    const cy = num(centre?.['y']);
    const r = num(c['radius']);
    if (cx === null || cy === null || r === null) return false;
    const side = Math.trunc(2 * r + 2);
    if (!close(Math.trunc(cx - r - 1) + side / 2, num(params['cx']))) return false;
    if (!close(Math.trunc(cy - r - 1) + side / 2, num(params['cy']))) return false;
    if (!close(side, num(params['width'])) || !close(side, num(params['height']))) return false;
  } else if (centre !== null) {
    if (!close(num(centre['x']), num(params['cx'])) || !close(num(centre['y']), num(params['cy']))) return false;
  }
  if (
    type !== 'avabodh.basic.circle' &&
    c['rotation'] !== undefined &&
    !close(num(c['rotation']), num(params['angle']))
  )
    return false;
  if (type === 'avabodh.basic.ellipse' || type === 'avabodh.basic.image') {
    if (!close(num(c['width']), num(params['width'])) || !close(num(c['height']), num(params['height']))) return false;
  }
  if (type === 'avabodh.basic.image') {
    const img = obj(Array.isArray(tmpl['images']) ? tmpl['images'][0] : undefined);
    if (img === null || img['format'] !== c['format']) return false;
    const stored = obj(input);
    if (stored === null || img['data'] !== stored['data']) return false;
    return true;
  }
  if (typeof c['text'] === 'string' && c['text'] !== '') {
    const first = obj(Array.isArray(tmpl['texts']) ? tmpl['texts'][0] : undefined);
    if (first === null || first['text'] !== c['text']) return false;
  }
  if (c['style'] !== undefined && !sameValue(c['style'], tmpl['style'])) return false;
  return true;
}
