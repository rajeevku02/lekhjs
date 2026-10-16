// The `getMonthInfo` host function as pure calendar arithmetic (spec 04 §5.1; DR-GEN-06). C++
// (`lua_getMonthInfo`, `L/shapegen/LuaShapeGenerator.cpp:499`) asked `mktime` / `localtime`, so the
// weekday could depend on the time zone and DST; here it is the proleptic Gregorian calendar with
// no `Date` and no time zone. As C++: a month outside 1..12 is read as 1, and a non-integer month
// or year is truncated.

/** Weekday (1 = Sunday … 7 = Saturday) of the 1st, and the number of days, of `month`/`year`. */
export function monthInfo(
  month: number,
  year: number,
): { readonly weekdayOfFirst: number; readonly daysInMonth: number } {
  if (!Number.isFinite(month) || !Number.isFinite(year)) return { weekdayOfFirst: 1, daysInMonth: 30 };
  let m = Math.trunc(month);
  const y = Math.trunc(year);
  if (m < 1 || m > 12) m = 1;
  return { weekdayOfFirst: weekdayOf(y, m, 1) + 1, daysInMonth: daysIn(m, y) };
}

/** Whether `year` is a Gregorian leap year. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysIn(month: number, year: number): number {
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return 31;
}

const T = Object.freeze([0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]);

/** Sakamoto's method: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(year: number, month: number, day: number): number {
  const y = month < 3 ? year - 1 : year;
  const floorDiv = (a: number, b: number) => Math.floor(a / b);
  const w = y + floorDiv(y, 4) - floorDiv(y, 100) + floorDiv(y, 400) + (T[month - 1] ?? 0) + day;
  return ((w % 7) + 7) % 7;
}
