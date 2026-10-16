// The fixed date behaviour of `calendar` and `android_datepicker` (AC-GEN-21; spec 04 §5.3):
// DR-GEN-05 (a malformed text draws 2022/3/4 and never throws), DR-GEN-06 (no time zone),
// DR-GEN-07 ('Wed') and DR-GEN-08 (OQ-20: the header weekday is the selected day's); and the two
// Lua number conversions the scripts show (`tonumber`, `tostring`).
import { describe, expect, it } from 'vitest';
import { WIREFRAME_MODULES, luaNumberString, luaToNumber, parseWireframeDate } from '../../src/generators';
import type { TextEntry, WireframeModule } from '../../src/template';
import { STUB_HOST } from './oracle/stub-host';

function mod(key: string): WireframeModule {
  const m = WIREFRAME_MODULES.find((x) => x.key === key);
  if (m === undefined) throw new Error(`no module ${key}`);
  return m;
}
const calendar = mod('wireframe/calendar');
const picker = mod('wireframe/android_datepicker');

const textsOf = (m: WireframeModule, text: string): readonly TextEntry[] =>
  m.generate({ params: {}, text }, STUB_HOST).texts;
/** The android_datepicker header ("Wed, Oct 2025"). */
const header = (text: string) => textsOf(picker, text)[1]?.text;
/** The calendar's month header ("October 2025"). */
const monthHead = (text: string) => textsOf(calendar, text)[0]?.text;

describe('DR-GEN-05: a malformed date text draws the default 2022/3/4', () => {
  const MALFORMED = ['', 'A', 'Hello world', '2022/13', 'abc/3/4', '2022/x/4', '2022/3/y', '//', '2023/7.5/9x'];

  it.each(MALFORMED)('%j: no throw, default parts', (text) => {
    expect(() => calendar.generate({ params: {}, text }, STUB_HOST)).not.toThrow();
    expect(() => picker.generate({ params: {}, text }, STUB_HOST)).not.toThrow();
  });

  it('a text with fewer than 3 parts is 2022/3/4 (Friday 4 March 2022)', () => {
    expect(parseWireframeDate('A', STUB_HOST)).toMatchObject({ y: 2022, ys: '2022', m: 3, d: 4 });
    expect(monthHead('A')).toBe('March 2022');
    expect(header('')).toBe('Fri, March 2022');
  });

  it('a part that does not parse keeps that part of the default; the others are read', () => {
    expect(parseWireframeDate('abc/7/9', STUB_HOST)).toMatchObject({ ys: '2022', m: 7, d: 9 });
    expect(parseWireframeDate('2019/x/9', STUB_HOST)).toMatchObject({ ys: '2019', m: 3, d: 9 });
    expect(parseWireframeDate('2019/7/y', STUB_HOST)).toMatchObject({ ys: '2019', m: 7, d: 4 });
    expect(monthHead('abc/7/9')).toBe('July 2022');
  });

  it("the scripts' range rules stay: a month outside 1..12 is January, a day outside the month is 2", () => {
    expect(parseWireframeDate('2022/13/45', STUB_HOST)).toMatchObject({ m: 1, d: 2 });
    expect(parseWireframeDate('2023/2/29', STUB_HOST)).toMatchObject({ m: 2, d: 2 });
    expect(parseWireframeDate('2024/2/29', STUB_HOST)).toMatchObject({ m: 2, d: 29 });
  });

  it('a fractional month inside 1..12 is truncated (Lua raised)', () => {
    expect(parseWireframeDate('2023/7.5/9', STUB_HOST)).toMatchObject({ m: 7 });
  });

  it('no stale year: each generation reads only its own text', () => {
    expect(monthHead('1999/5/5')).toBe('May 1999');
    expect(monthHead('A')).toBe('March 2022');
  });
});

describe('DR-GEN-06: the drawn month does not depend on the time zone', () => {
  it('calendar and android_datepicker are identical under TZ=UTC and TZ=Pacific/Kiritimati', () => {
    const saved = process.env['TZ'];
    const run = () =>
      ['2018/12/25', '2024/3/1', '1970/1/1'].map((text) => [
        calendar.generate({ params: {}, text }, STUB_HOST),
        picker.generate({ params: {}, text }, STUB_HOST),
      ]);
    try {
      process.env['TZ'] = 'UTC';
      const utc = run();
      process.env['TZ'] = 'Pacific/Kiritimati';
      expect(run()).toEqual(utc);
    } finally {
      if (saved === undefined) delete process.env['TZ'];
      else process.env['TZ'] = saved;
    }
  });
});

describe('DR-GEN-07 and DR-GEN-08: the android_datepicker header', () => {
  it("Wednesday is 'Wed' (the script had 'Web')", () => {
    expect(header('2025/10/1')).toBe('Wed, Oct 2025');
    expect(header('2025/10/8')).toBe('Wed, Oct 2025');
  });

  it("names the selected day's weekday, not the 1st's (OQ-20)", () => {
    // 1 December 2018 is a Saturday; the 25th a Tuesday.
    expect(header('2018/12/25')).toBe('Tue, Dec 2018');
    expect(header('2018/12/1')).toBe('Sat, Dec 2018');
    // An out-of-range day is drawn as the 2nd: Sunday 2 January 2022.
    expect(header('2022/13/45')).toBe('Sun, Jan 2022');
  });

  it('the circled day is the selected day', () => {
    const out = picker.generate({ params: {}, text: '2018/12/25' }, STUB_HOST);
    const circles = out.draw.filter((d) => d.path.startsWith('E '));
    expect(circles).toHaveLength(1);
    const at = Number(circles[0]?.path.split(' ')[1]);
    // The circle's box is the 5 data entries after the day's text box.
    const dayText = out.texts.find((t) => t.location.split(' ')[0] === String(at - 5));
    expect(dayText?.text).toBe('25');
  });
});

describe('Lua number conversions', () => {
  it('tonumber: decimal, float, hex and surrounding space; nil for the rest', () => {
    expect(luaToNumber('2022')).toEqual({ value: 2022, integer: true });
    expect(luaToNumber(' 2022 \t')).toEqual({ value: 2022, integer: true });
    expect(luaToNumber('2022.0')).toEqual({ value: 2022, integer: false });
    expect(luaToNumber('2e3')).toEqual({ value: 2000, integer: false });
    expect(luaToNumber('.5')).toEqual({ value: 0.5, integer: false });
    expect(luaToNumber('0x7E6')).toEqual({ value: 2022, integer: true });
    expect(luaToNumber('0x1p4')).toEqual({ value: 16, integer: false });
    for (const s of ['', ' ', 'abc', '20 22', 'inf', 'nan', '1e', '0x', '12a']) expect(luaToNumber(s)).toBeNull();
  });

  it('tostring: integers as digits, floats as %.14g with .0 when whole', () => {
    const f = (value: number) => luaNumberString({ value, integer: false });
    expect(luaNumberString({ value: 2022, integer: true })).toBe('2022');
    expect(f(2022)).toBe('2022.0');
    expect(f(2020.5)).toBe('2020.5');
    expect(f(1 / 3)).toBe('0.33333333333333');
    expect(f(1e15)).toBe('1e+15');
    expect(f(1e-5)).toBe('1e-05');
    expect(f(0.0001)).toBe('0.0001');
    expect(f(-0)).toBe('-0.0');
    expect(f(Infinity)).toBe('inf');
  });

  it('a float year prints as Lua printed it', () => {
    expect(monthHead('2020.0/2/3')).toBe('February 2020.0');
  });
});
