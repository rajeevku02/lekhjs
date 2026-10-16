// Spec 06 §3.2 rule 1 (DR-TXT-03): break after UAX #14 HY (`-`), BA (`–`, soft hyphen) and SY
// (`/`) when a character that may start a line follows; URLs break after `/` first and between
// graphemes only where no `/` or `-` opportunity fits; white space breaks are the C++ ones.
import { describe, expect, it } from 'vitest';
import { WRAP_EPSILON, WordWrapper, splitHardLines } from '../../src/text';
import { fixedMeasurer } from './helpers';

function wrap(text: string, width: number) {
  const m = fixedMeasurer(10);
  return new WordWrapper().wrap(text, width, (s) => m.measureLine(s, '15px x').width).map((l) => l.text);
}
const ends = (line: string) => new WordWrapper().breakOpportunities(line).map((b) => b.segEnd);

describe('rule 1 break opportunities', () => {
  it('after a white-space run, the line before excludes the spaces', () => {
    expect(new WordWrapper().breakOpportunities('ab  cd e')).toEqual([
      { segEnd: 2, nextStart: 4 },
      { segEnd: 6, nextStart: 7 },
    ]);
  });

  it('none at leading or trailing white space, nor at a no-break space', () => {
    expect(ends('  ab')).toEqual([]);
    expect(ends('ab  ')).toEqual([]);
    expect(ends('ab cd')).toEqual([]);
  });

  it('after a hyphen, an en dash, a soft hyphen and a slash', () => {
    expect(ends('well-known')).toEqual([5]);
    expect(ends('2020–2026x')).toEqual([5]);
    expect(ends('hyphen­ation')).toEqual([7]);
    expect(ends('and/or')).toEqual([4]);
  });

  it('not before a digit after HY (LB25), nor after SY between digits', () => {
    expect(ends('x-1')).toEqual([]);
    expect(ends('1/2')).toEqual([]);
    expect(ends('a/1')).toEqual([2]);
  });

  it('not before a closing or another HY/SY character, nor at a word start', () => {
    expect(ends('a-)')).toEqual([]);
    expect(ends('a--b')).toEqual([3]);
    expect(ends('http://x')).toEqual([7]);
    expect(ends('a -b')).toEqual([1]);
  });
});

describe('wrapping with the HY/BA/SY breaks', () => {
  it('a hyphenated word breaks after the hyphen', () => {
    expect(wrap('state-of-the-art design', 70)).toEqual(['state-', 'of-the-', 'art', 'design']);
  });

  it('a URL breaks after "/" first', () => {
    const url = 'https://lekh.app/boards/team/roadmap';
    expect(wrap(url, 120)).toEqual(['https://', 'lekh.app/', 'boards/team/', 'roadmap']);
  });

  it('a URL breaks between graphemes only where no "/" opportunity fits', () => {
    const url = 'https://example.com/averyveryverylongpathsegment/x';
    const lines = wrap(url, 100);
    expect(lines.join('')).toBe(url);
    for (const l of lines) expect(l.length * 10).toBeLessThanOrEqual(100 + WRAP_EPSILON);
    expect(lines).toEqual(['https://', 'example.co', 'm/', 'averyveryv', 'erylongpat', 'hsegment/x']);
  });
});

describe('hard lines (C++ std::getline)', () => {
  it('a final newline adds no line; an empty text is one empty line (B5)', () => {
    expect(splitHardLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitHardLines('a\n\n')).toEqual(['a', '']);
    expect(splitHardLines('\n')).toEqual(['']);
    expect(splitHardLines('')).toEqual(['']);
    expect(wrap('', 50)).toEqual(['']);
  });

  it('keeps offsets into the whole text', () => {
    const m = fixedMeasurer(10);
    const lines = new WordWrapper().wrap('ab cd\nef gh', 25, (s) => m.measureLine(s, 'k').width);
    expect(lines.map((l) => [l.text, l.start, l.end, l.paragraph])).toEqual([
      ['ab', 0, 2, 0],
      ['cd', 3, 5, 0],
      ['ef', 6, 8, 1],
      ['gh', 9, 11, 1],
    ]);
  });
});
