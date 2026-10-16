// Normaliser `date-malformed` (DR-GEN-05). With a date text the scripts could not read (fewer than
// 3 `/` parts, a part that is not a Lua numeral, or a fractional month inside 1..12), C++ raised in
// `calendar.lua` / `android_datepicker.lua` and kept no output (an empty `data` on a first
// generation) or printed the year as "nil"; lekhjs draws the default 2022/3/4. At a `template`
// path of either template: null when the input's text is a date the scripts read (the rule does
// not apply); otherwise true when lekhjs drew the shape (non-empty `data`) and the templates agree
// outside `data`.
import { generatorText, luaDate } from './wireframe-date.mjs';
import { obj, sameValue } from './util.mjs';

export const name = 'date-malformed';

const IDS = new Set(['avabodh.wireframe.calendar', 'avabodh.wireframe.androiddatepicker']);

/** @param {any} cpp @param {any} ts @param {any} input */
export function equal(cpp, ts, input) {
  const c = obj(cpp);
  const t = obj(ts);
  if (c === null || t === null || !IDS.has(String(t['id']))) return null;
  const text = generatorText(input);
  if (text === null) return false;
  if (luaDate(text) !== null) return null;
  const data = t['data'];
  if (!Array.isArray(data) || data.length === 0) return false;
  return c['id'] === t['id'] && sameValue(c, t, new Set(['data']));
}
