// The check the `android_datepicker` header fixes share (DR-GEN-07, DR-GEN-08): the C++ and TS
// templates agree everywhere but in the header box, whose width follows the measured weekday name.
// The header is data entries 13..17 ("x, y, w, h, 0"): x is `-w/2+<gap + w/2>` and w a number, so
// only entries 13 and 15 may differ, and x must move by half of w's change. The other entries have
// already been compared by the `lua-data-number` step, which this repeats for the two entries.
import { equal as sameData } from './lua-data-number.mjs';
import { obj, sameValue } from './util.mjs';

export const DATEPICKER = 'avabodh.wireframe.androiddatepicker';

/** `-w/2+<n>` → n. @param {unknown} s */
function headerX(s) {
  const m = typeof s === 'string' ? /^-w\/2\+(-?[\d.eE+-]+)$/.exec(s.replace(/\s+/g, '')) : null;
  return m === null ? null : Number(m[1]);
}

/** @param {unknown} s */
function number(s) {
  return typeof s === 'string' && /^-?[\d.eE+-]+$/.test(s.trim()) ? Number(s) : null;
}

/**
 * Whether the two datepicker templates differ only by the header width.
 * @param {any} cpp @param {any} ts
 */
export function onlyHeaderWidth(cpp, ts) {
  const c = obj(cpp);
  const t = obj(ts);
  if (c === null || t === null || c['id'] !== t['id']) return false;
  const a = c['data'];
  const b = t['data'];
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length < 18) return false;
  for (let i = 0; i < a.length; i++) {
    if (i === 13 || i === 15) continue;
    if (a[i] !== b[i] && sameData(String(a[i]), String(b[i])) !== true) return false;
  }
  const x0 = headerX(a[13]);
  const x1 = headerX(b[13]);
  const w0 = number(a[15]);
  const w1 = number(b[15]);
  if (x0 === null || x1 === null || w0 === null || w1 === null) return false;
  // float32-widened C++ sizes: within a thousandth
  if (Math.abs(x1 - x0 - (w1 - w0) / 2) > 1e-3) return false;
  return sameValue(c, t, new Set(['data']));
}
