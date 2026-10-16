// Normaliser `datepicker-weekday` (DR-GEN-08, OQ-20). `android_datepicker.lua` headed the shape
// with the weekday of the 1st of the month; lekhjs names the selected day's weekday, and the
// header box follows the measured name. At a `template` path of
// `avabodh.wireframe.androiddatepicker`: null unless the two weekdays differ; then true when the
// templates differ only by the header width.
import { DATEPICKER, onlyHeaderWidth } from './datepicker-header.mjs';
import { generatorText, luaDate } from './wireframe-date.mjs';
import { obj } from './util.mjs';

export const name = 'datepicker-weekday';

/** @param {any} cpp @param {any} ts @param {any} input */
export function equal(cpp, ts, input) {
  if (obj(ts)?.['id'] !== DATEPICKER) return null;
  const text = generatorText(input);
  const date = text === null ? null : luaDate(text);
  if (date === null || date.weekdayOfFirst === date.weekdayOfSelected) return null;
  return onlyHeaderWidth(cpp, ts);
}
