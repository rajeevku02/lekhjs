// The host functions (spec 04 §5.1, §13): `split`, `splitLines`, `parseSizeSpec` and `monthInfo`,
// against expectations derived by hand from `LuaShapeGenerator.cpp:91-497` and `:499`, plus the 16
// distinct `split` option sets the scripts use.
import { describe, expect, it } from 'vitest';
import { monthInfo, parseSizeSpec, split, splitByChar, splitLines, weekdayOf } from '../../src/generators';
import type { SplitOptions } from '../../src/template';

const measure = (s: string) => ({ w: 7 * s.length, h: 14 });

describe('splitLines', () => {
  it.each([
    ['', []],
    ['a', ['a']],
    ['a\n', ['a']],
    ['\n', ['']],
    ['a\n\nb', ['a', '', 'b']],
    ['a\r\nb', ['a', 'b']],
    ['a\r\r\nb', ['a\r', 'b']],
    ['\ra\rb', ['a\rb']],
  ])('%j', (s, out) => {
    expect(splitLines(s)).toEqual(out);
  });
});

describe('splitByChar', () => {
  it.each([
    ['', []],
    [',', ['', '']],
    ['a,', ['a', '']],
    ['a\\,b,c', ['a,b', 'c']],
    ['a\\\\,b', ['a\\', 'b']],
    ['a\\x', ['a\\x']],
  ])('%j', (s, out) => {
    expect(splitByChar(s, ',')).toEqual(out);
  });
});

describe('parseSizeSpec', () => {
  it('reads sizes and alignments', () => {
    expect(parseSizeSpec('{10c, 20r, 30}')).toEqual({
      parsed: true,
      specs: [
        { size: 10, align: 'center' },
        { size: 20, align: 'right' },
        { size: 30, align: 'left' },
      ],
    });
    expect(parseSizeSpec(' {10C, 5L} # note').specs).toEqual([
      { size: 10, align: 'center' },
      { size: 5, align: 'left' },
    ]);
    expect(parseSizeSpec('{,5l}').specs).toEqual([
      { size: 0, align: 'left' },
      { size: 5, align: 'left' },
    ]);
    expect(parseSizeSpec('{-5r}').specs).toEqual([{ size: -5, align: 'right' }]);
    // The last character decides; `atoi` of the rest reads what it can.
    expect(parseSizeSpec('{abc5}').specs).toEqual([{ size: 0, align: 'left' }]);
  });

  it.each(['', '{}', '{', '10', '{10x}', '{10, y}', 'x{10}'])('%j is not a spec', (s) => {
    expect(parseSizeSpec(s).parsed).toBe(false);
  });
});

describe('split', () => {
  const words = (text: string, o: SplitOptions) => split(text, o, measure).map((i) => i.word);

  it('reads selection and disabled marks in either order, and escapes them', () => {
    const items = split('*-One,-*Two,Three,\\*Lit', { by: ',', checkSelection: true, checkDisabled: true }, measure);
    expect(items.map((i) => [i.word, i.selected, i.disabled])).toEqual([
      ['One', true, true],
      ['Two', true, true],
      ['Three', false, false],
      ['*Lit', false, false],
    ]);
    // Without the check the marks are text.
    expect(words('*-One', { by: ',' })).toEqual(['*-One']);
  });

  it('reads start and end icons (trimmed; the word keeps its spaces)', () => {
    const [a] = split('[ icon_a ] Text', { by: '\n', checkStartIcon: true }, measure);
    expect(a).toMatchObject({ word: ' Text', startIcon: 'icon_a' });
    const [b] = split('Text [icon_b]', { by: '\n', checkEndIcon: true }, measure);
    expect(b).toMatchObject({ word: 'Text ', endIcon: 'icon_b' });
    // C++ keeps scanning left after a match.
    const [c] = split('a [x] b [y]', { by: '\n', checkEndIcon: true }, measure);
    expect(c).toMatchObject({ word: 'a ', endIcon: 'x] b' });
    const [d] = split('[unclosed text', { by: '\n', checkStartIcon: true }, measure);
    expect(d?.word).toBe('[unclosed text');
    expect(d?.startIcon).toBeUndefined();
  });

  it('reads the end text after the last comma', () => {
    const o: SplitOptions = { by: '\n', checkEndText: true };
    expect(split('Name, 42', o, measure)[0]).toMatchObject({ word: 'Name', endText: '42' });
    expect(split('a,b,', o, measure)[0]).toMatchObject({ word: 'a,b,' });
    expect(split('a,b,', o, measure)[0]?.endText).toBeUndefined();
    expect(split('a\\,b,c', o, measure)[0]).toMatchObject({ word: 'a,b', endText: 'c' });
  });

  it('unescapes new lines, reads the indent', () => {
    expect(words('a\\nb\\\\c', { by: ',', checkEscapeNewLine: true })).toEqual(['a\nb\\c']);
    expect(split('   x\ny', { by: '\n', checkIndent: true }, measure).map((i) => [i.word, i.indent])).toEqual([
      ['x', 3],
      ['y', 0],
    ]);
  });

  it('measures with the pads, and the ratios share the sums', () => {
    const items = split('ab,c', { by: ',', checkWidth: true, widthPad: 2 }, measure);
    expect(items.map((i) => [i.width, i.height, i.widthRatio, i.heightRatio])).toEqual([
      [16, 14, 16 / 25, 0.5],
      [9, 14, 9 / 25, 0.5],
    ]);
    // Unmeasured: zeros (C++ left them uninitialised).
    expect(split('ab', { by: ',' }, measure)[0]).toMatchObject({ width: 0, height: 0, widthRatio: 0, heightRatio: 0 });
    // Empty words measure to zero: the ratio is 1.
    expect(split(',', { by: ',', checkHeight: true }, () => ({ w: 0, h: 0 })).map((i) => i.heightRatio)).toEqual([
      1, 1,
    ]);
  });

  it('an empty separator or text gives no item', () => {
    expect(split('a,b', { by: '' }, measure)).toEqual([]);
    expect(split('', { by: ',' }, measure)).toEqual([]);
    expect(split('', { by: '\n' }, measure)).toEqual([]);
  });

  // The 16 distinct option sets of the 33 scripts.
  const SETS: SplitOptions[] = [
    {
      by: ',',
      checkEscapeNewLine: true,
      checkHeight: true,
      checkWidth: true,
      heightPad: 1,
      widthPad: 2,
      checkDisabled: true,
      checkSelection: true,
      checkStartIcon: true,
      checkEndIcon: true,
    },
    { by: ',', checkHeight: true, checkWidth: true, heightPad: 8, widthPad: 12 },
    { by: '\n', checkSelection: true, checkHeight: true, checkWidth: true, heightPad: 12, checkDisabled: true },
    { by: ',', checkDisabled: true, checkSelection: true, checkWidth: true, widthPad: 20 },
    { by: ',', checkSelection: true, checkDisabled: true, checkEscapeNewLine: true, checkWidth: true, widthPad: 18 },
    { by: ',', checkSelection: true, checkEscapeNewLine: true, checkWidth: true, widthPad: 2 },
    { by: ',', checkSelection: true, checkEscapeNewLine: true, checkWidth: true, widthPad: 20 },
    { by: ',', checkWidth: true, checkDisabled: true, widthPad: 12 },
    { by: ',', checkWidth: true, checkDisabled: true, widthPad: 18 },
    { by: '/' },
    { by: '\n', checkDisabled: true, checkSelection: true, checkWidth: true, widthPad: 20, heightPad: 18 },
    { by: '\n', checkHeight: true, heightPad: 6, checkDisabled: true, checkStartIcon: true },
    {
      by: '\n',
      checkHeight: true,
      heightPad: 8,
      checkDisabled: true,
      checkStartIcon: true,
      checkEndIcon: true,
      checkSelection: true,
      checkEndText: true,
      checkEscapeNewLine: true,
    },
    {
      by: '\n',
      checkHeight: true,
      heightPad: 8,
      checkDisabled: true,
      checkStartIcon: true,
      checkSelection: true,
      checkEndText: true,
    },
    {
      by: '\n',
      checkHeight: true,
      heightPad: 8,
      checkDisabled: true,
      checkStartIcon: true,
      checkSelection: true,
      checkIndent: true,
    },
    { by: '\n', checkHeight: true, heightPad: 8, checkDisabled: true, checkStartIcon: true, checkSelection: true },
  ];
  const TEXT = '*[icon_a] One, x\n-Two [icon_b],y\n  Three\\nmore/2022/03';

  it.each(SETS.map((o, i) => [i, o] as const))('option set %i: one item per piece, ratios sum to 1', (_i, o) => {
    const items = split(TEXT, o, measure);
    const pieces = o.by === '\n' ? splitLines(TEXT) : splitByChar(TEXT, o.by);
    expect(items.length).toBe(pieces.length);
    if (o.checkWidth === true || o.checkHeight === true) {
      const sum = (k: 'widthRatio' | 'heightRatio') => items.reduce((s, i) => s + i[k], 0);
      expect(sum('widthRatio')).toBeCloseTo(1, 9);
      expect(sum('heightRatio')).toBeCloseTo(1, 9);
    }
  });
});

describe('monthInfo (DR-GEN-06: no time zone)', () => {
  it.each([
    [3, 2022, 3, 31],
    [2, 2024, 5, 29],
    [2, 2023, 4, 28],
    [2, 1900, 5, 28],
    [2, 2000, 3, 29],
    [9, 1752, 6, 30],
    [1, 1970, 5, 31],
  ])('%i/%i: weekday of the 1st %i, %i days', (m, y, w, d) => {
    expect(monthInfo(m, y)).toEqual({ weekdayOfFirst: w, daysInMonth: d });
  });

  it('a month outside 1..12 is January, as C++ read it', () => {
    expect(monthInfo(13, 2022)).toEqual(monthInfo(1, 2022));
    expect(monthInfo(0, 2022)).toEqual(monthInfo(1, 2022));
  });

  it('matches the UTC calendar for every month of 1901-2100', () => {
    for (let y = 1901; y <= 2100; y++) {
      for (let m = 1; m <= 12; m++) {
        expect(weekdayOf(y, m, 1)).toBe(new Date(Date.UTC(y, m - 1, 1)).getUTCDay());
      }
    }
  });
});
