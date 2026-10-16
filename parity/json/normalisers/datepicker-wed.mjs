// Normaliser `datepicker-wed` (DR-GEN-07). `android_datepicker.lua` named Wednesday "Web"; lekhjs
// writes "Wed", and the header box follows the measured name. At a `template` path of
// `avabodh.wireframe.androiddatepicker`: null unless the C++ header showed "Web" with the selected
// day's own weekday (a Wednesday 1st, the 1st selected or a day on the same weekday; any other day
// is DR-GEN-08's); then true when the templates differ only by the header width.
import { DATEPICKER, onlyHeaderWidth } from './datepicker-header.mjs';
import { generatorText, luaDate } from './wireframe-date.mjs';
import { obj } from './util.mjs';

export const name = 'datepicker-wed';

/** @param {any} cpp @param {any} ts @param {any} input */
export function equal(cpp, ts, input) {
  if (obj(ts)?.['id'] !== DATEPICKER) return null;
  const text = generatorText(input);
  const date = text === null ? null : luaDate(text);
  if (date === null || date.weekdayOfFirst !== 3 || date.weekdayOfSelected !== 3) return null;
  return onlyHeaderWidth(cpp, ts);
}
