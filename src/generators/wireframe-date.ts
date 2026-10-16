// The date handling `calendar.lua` and `android_datepicker.lua` share (spec 04 §5.3), and the two
// Lua number conversions they show to the user: `tonumber` of a text part and `tostring` of the
// year. Bundled into both modules' canonical JS text, as `wireframe-lua.ts` is.
//
// DR-GEN-05: the scripts kept the year text in globals (`ys`, `ms`, `ds`) set only when the text
// split into 3 parts, so a malformed first text raised (`head..' '..ys` on nil) and a later one
// showed a stale year; a part `tonumber` did not read made `m < 1` / `d < 1` raise. Here the
// strings come from the local `y`/`m`/`d`, a part that does not parse keeps the script's default
// (2022/3/4), and nothing throws. A month inside 1..12 that is not whole (Lua: a nil month name,
// so an error) is truncated, as `getMonthInfo` truncated it.
import type { DrawEntry, GeneratorContext, TextEntry } from '../template';
import { indexList, num } from './wireframe-lua';

/** A Lua number: the value, and whether Lua holds it as an integer (it prints without `.0`). */
export interface LuaNumber {
  readonly value: number;
  readonly integer: boolean;
}

const LUA_SPACE = /^[ \t\n\v\f\r]*|[ \t\n\v\f\r]*$/g;
const DEC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const HEX = /^([+-]?)0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?(?:[pP]([+-]?\d+))?$/;

/** Lua 5.3 `tonumber(s)` of a string; null where Lua returns nil (`inf`/`nan` are not numerals). */
export function luaToNumber(s: string): LuaNumber | null {
  const t = s.replace(LUA_SPACE, '');
  if (DEC.test(t)) {
    const value = Number(t);
    const integer = /^[+-]?\d+$/.test(t) && Number.isSafeInteger(value);
    return { value, integer };
  }
  const hx = HEX.exec(t);
  if (hx === null) return null;
  const [, sign = '', intPart = '', frac, exp] = hx;
  if (intPart === '' && (frac === undefined || frac === '')) return null;
  let value = 0;
  for (const c of intPart) value = value * 16 + Number.parseInt(c, 16);
  if (frac === undefined && exp === undefined) {
    value = sign === '-' ? -value : value;
    return { value, integer: Number.isSafeInteger(value) };
  }
  let scale = 1 / 16;
  for (const c of frac ?? '') {
    value += Number.parseInt(c, 16) * scale;
    scale /= 16;
  }
  value *= 2 ** Number(exp ?? '0');
  return { value: sign === '-' ? -value : value, integer: false };
}

/** Lua 5.3 `tostring` of a number: integers as digits, floats as `%.14g` with `.0` when whole. */
export function luaNumberString(n: LuaNumber): string {
  const x = n.value;
  if (n.integer) return String(x);
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  let s: string;
  if (x === 0) {
    s = Object.is(x, -0) ? '-0' : '0';
  } else {
    const [mant = '0', expS = '0'] = x.toExponential(13).split('e');
    const exp = Number(expS);
    if (exp < -4 || exp >= 14) {
      const m = mant.includes('.') ? mant.replace(/0+$/, '').replace(/\.$/, '') : mant;
      s = `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
    } else {
      s = x.toFixed(13 - exp);
      if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
  }
  return /^-?\d+$/.test(s) ? `${s}.0` : s;
}

/** The date a calendar text names, after the scripts' checks. */
export interface WireframeDate {
  readonly y: number;
  /** The year as Lua printed it. */
  readonly ys: string;
  /** 1..12. */
  readonly m: number;
  /** The selected day, inside the month (out of range: 2, as the scripts). */
  readonly d: number;
  /** Weekday (1 = Sunday) of the 1st. */
  readonly day: number;
  readonly days: number;
}

/** `y/m/d` from the text (DR-GEN-05), with the month's info (`getMonthInfo`). */
export function parseWireframeDate(text: string, ctx: GeneratorContext): WireframeDate {
  let y: LuaNumber = { value: 2022, integer: true };
  let m = 3;
  let d = 4;
  const arr = ctx.split(text, { by: '/' });
  if (arr.length >= 3) {
    y = luaToNumber(arr[0]?.word ?? '') ?? y;
    const mm = luaToNumber(arr[1]?.word ?? '');
    if (mm !== null) m = mm.value < 1 || mm.value > 12 ? 1 : Math.trunc(mm.value);
    d = luaToNumber(arr[2]?.word ?? '')?.value ?? d;
  }
  const info = ctx.monthInfo(m, y.value);
  let day = info.weekdayOfFirst;
  const days = info.daysInMonth;
  if (day < 1 || day > 7) day = 1;
  if (d < 1 || d > days) d = 2;
  return { y: y.value, ys: luaNumberString(y), m, d, day, days };
}

export const MONTHS = Object.freeze([
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]);

const SELECTED = -10504995;

/** The parts of a template the month grid appends to. */
export interface GridSink {
  readonly data: string[];
  readonly draw: DrawEntry[];
  readonly texts: TextEntry[];
}

/**
 * The month grid both scripts draw (`calendar.lua:53-83`, `android_datepicker.lua:72-102`): a row
 * of weekday initials, then the days, with a filled circle behind the selected day. Returns the
 * next free data index.
 */
export function drawMonthGrid(
  out: GridSink,
  ctx: GeneratorContext,
  g: {
    readonly date: WireframeDate;
    readonly dataEnd: number;
    readonly yh: number;
    readonly lh: (numLines: number) => string;
    readonly gap: number;
    readonly cw: number;
  },
): number {
  const { date, gap, cw, yh } = g;
  const { day, days, d } = date;
  let dataEnd = g.dataEnd;
  const numLines = Math.floor((days + day + 6) / 7);
  const lh = g.lh(numLines);
  const cellw = `(w-${num(2 * gap + cw)})/6`;
  for (let i = 0; i < numLines; i++) {
    const yc = `-h/2+${num(yh)}+ (2 * ${String(i)}+1)*0.5*${lh}`;
    let larr: string[];
    if (i === 0) {
      larr = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    } else if (i === 1) {
      larr = [];
      let s = 1;
      while (s < day) {
        larr.push(' ');
        s++;
      }
      while (s < 8) {
        larr.push(String(s - day + 1));
        s++;
      }
    } else {
      const s = (i - 1) * 7 + 1 - day;
      larr = [];
      for (let k = 1; k <= 7; k++) larr.push(s + k <= days ? String(s + k) : '');
    }
    larr.forEach((label, j) => {
      let xc = `-w/2+${num(gap + cw / 2)}+${String(j)}*${cellw}`;
      if (j === 0) xc = `-w/2+${num(gap + cw / 2)}`;
      if (j === 6) xc = `w/2-${num(gap + cw / 2)}`;
      const sz = ctx.textSize(label);
      out.data.push(xc, yc, num(sz.w + 2), num(sz.h), '0');
      out.texts.push({ text: label, location: indexList(dataEnd, 5) });
      dataEnd += 5;
      // Lua `d == tonumber(label)`: only the day numbers are numerals.
      if (/^\d+$/.test(label) && d === Number(label)) {
        out.data.push(xc, yc, num(cw + 8), num(cw + 8), '0');
        out.draw.push({
          path: `E ${indexList(dataEnd, 5)}`,
          style: { strokewidth: 0, fillpaint: { color: SELECTED, type: 2 } },
        });
        dataEnd += 5;
      }
    });
  }
  return dataEnd;
}
