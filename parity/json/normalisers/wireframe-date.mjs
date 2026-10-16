// The date text of the `calendar` and `android_datepicker` wireframe templates as the two Lua
// scripts read it, for the normalisers of their script fixes (DR-GEN-05, -07, -08). Written
// independently of lekhjs (it explains a difference, so it must not reuse the code under test).
//
// The scripts split the text on `/` (`\/` and `\\` are escapes), and with at least 3 parts read
// `tonumber` of the first three; `m < 1 or m > 12` makes the month 1, a day outside the month makes
// it 2. A part that is not a Lua numeral is nil, which raises (month, day) or prints "nil" (year),
// and a whole month inside 1..12 is required to index the month names.
import { obj } from './util.mjs';

/** `split(text, {by='/'})` without the markup options. @param {string} s */
function splitSlash(s) {
  /** @type {string[]} */
  const out = [];
  let line = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    const next = s.charAt(i + 1);
    if (c === '\\' && (next === '/' || next === '\\')) {
      line += next;
      i++;
    } else if (c === '/') {
      out.push(line);
      line = '';
    } else line += c;
  }
  if (s.length > 0) out.push(line);
  return out;
}

/** Lua 5.3 `tonumber` of a decimal or hexadecimal integer numeral; null for anything else. @param {string} s */
function luaNumber(s) {
  const t = s.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '');
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  const hx = /^([+-]?)0[xX]([0-9a-fA-F]+)$/.exec(t);
  if (hx !== null) return (hx[1] === '-' ? -1 : 1) * Number.parseInt(hx[2] ?? '0', 16);
  return null;
}

/**
 * The date the scripts read, or null where they did not (DR-GEN-05: they raised, or showed "nil").
 * `weekdayOfFirst` and `weekdayOfSelected` are 0 (Sunday) … 6.
 * @param {string} text
 * @returns {{ y: number, m: number, d: number, weekdayOfFirst: number, weekdayOfSelected: number } | null}
 */
export function luaDate(text) {
  const parts = splitSlash(text).map(luaNumber);
  if (parts.length < 3) return null;
  const [y, m0, d0] = parts;
  if (y == null || m0 == null || d0 == null) return null;
  const m = m0 < 1 || m0 > 12 ? 1 : m0;
  if (!Number.isInteger(m)) return null;
  const at = (/** @type {number} */ day) => {
    const t = new Date(0);
    t.setUTCFullYear(Math.trunc(y), m - 1, day);
    return t;
  };
  const days = 32 - at(32).getUTCDate();
  const d = d0 < 1 || d0 > days ? 2 : Math.trunc(d0);
  return { y, m, d, weekdayOfFirst: at(1).getUTCDay(), weekdayOfSelected: at(d).getUTCDay() };
}

/** The generator text of an input template, or null. @param {any} input */
export function generatorText(input) {
  const g = obj(obj(input)?.['generator']);
  const t = g?.['text'];
  return typeof t === 'string' ? t : null;
}
