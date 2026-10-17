// Normaliser `empty-text-line` (DR-ENG-05). lekhjs measures an empty text as one empty line
// (spec 03 §8.1, B5); the C++ web and backend measure it as no line at all (`TextUtil::lines` reads
// nothing from an empty string), so a floating text box (`avabodh.basic.text`) whose text is empty
// is sized to the bounds adjust alone (8 × 8) by C++ and one line taller by lekhjs. At an object
// path, for `params/height` only: true when the object is such a text box, every text slot of its
// template is empty, the C++ height is the width (8: no line) and the TS height is larger; null
// otherwise.
import { num, obj } from './util.mjs';

export const name = 'empty-text-line';

const TEXT_TEMPLATE = 'avabodh.basic.text';

/** @param {any} o */
function emptyTextBox(o) {
  const t = obj(obj(o)?.['template']);
  if (t === null || t['id'] !== TEXT_TEMPLATE) return false;
  const texts = t['texts'];
  if (!Array.isArray(texts)) return texts === undefined || texts === 'default';
  return texts.every((x) => {
    const s = obj(x)?.['text'];
    return s === undefined || s === '';
  });
}

/** @param {any} cpp @param {any} ts @param {any} _input @param {string[]} [rest] */
export function equal(cpp, ts, _input, rest = []) {
  if (rest.length !== 2 || rest[0] !== 'params' || rest[1] !== 'height') return null;
  if (!emptyTextBox(cpp) || !emptyTextBox(ts)) return null;
  const cp = obj(obj(cpp)?.['params']);
  const tp = obj(obj(ts)?.['params']);
  const ch = num(cp?.['height']);
  const cw = num(cp?.['width']);
  const th = num(tp?.['height']);
  if (ch === null || cw === null || th === null) return false;
  return ch === cw && th > ch;
}
