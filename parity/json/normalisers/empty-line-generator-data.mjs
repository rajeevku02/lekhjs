// Normaliser `empty-line-generator-data` (DR-ENG-05). A wireframe generator measures each line of
// its text (`h.split(text, { checkHeight })`, `h.textSize`); an empty line measures as no line in
// the C++ web and backend (`TextUtil::lines`) and as one empty line in lekhjs (spec 03 §8.1, B5),
// so every row laid out after it moves by one line height and the generated `data` differs. A
// line with no letter or digit (blank, or only the script's syntax, as a menu's `=` separator with
// an empty label on each side) measures empty pieces the same way. At a template path, for a
// `data/[i]` string: true when the template's generator text has such a line and the two strings have the same tokens (operators, names, punctuation) with any numbers;
// null otherwise. The check is structural: it cannot tell a second difference in the same rows
// from this one, so it applies only to templates whose text has such a line.
import { tokens } from './lua-data-number.mjs';
import { obj } from './util.mjs';

export const name = 'empty-line-generator-data';

/** @param {any} t */
function hasEmptyLine(t) {
  const text = obj(obj(t)?.['generator'])?.['text'];
  return typeof text === 'string' && text.split('\n').some((l) => !/[\p{L}\p{N}]/u.test(l));
}

/** @param {any} t @param {string[]} rest */
function dataString(t, rest) {
  const data = obj(t)?.['data'];
  const m = /^\[(\d+)\]$/.exec(rest[1] ?? '');
  if (!Array.isArray(data) || m === null) return null;
  const s = data[Number(m[1])];
  return typeof s === 'string' ? s : null;
}

/** @param {any} cpp @param {any} ts @param {any} _input @param {string[]} [rest] */
export function equal(cpp, ts, _input, rest = []) {
  if (rest.length !== 2 || rest[0] !== 'data') return null;
  if (!hasEmptyLine(cpp) || !hasEmptyLine(ts)) return null;
  const a = dataString(cpp, rest);
  const b = dataString(ts, rest);
  if (a === null || b === null) return null;
  const x = tokens(a);
  const y = tokens(b);
  if (x === null || y === null || x.length !== y.length) return null;
  for (let i = 0; i < x.length; i++) {
    const p = x[i];
    const q = y[i];
    if (typeof p === 'string' || typeof q === 'string') {
      if (p !== q) return null;
    } else if (p === undefined || q === undefined) return null;
  }
  return true;
}
