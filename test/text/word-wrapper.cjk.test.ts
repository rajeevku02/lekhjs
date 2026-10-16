// AC-TXT-06: CJK text with no spaces and an over-long Latin word both wrap within the width;
// graphemes (emoji ZWJ sequences, flags, combining marks) are never split. Spec 06 §3.2 rules 2-3.
import { describe, expect, it } from 'vitest';
import { WRAP_EPSILON, WordWrapper } from '../../src/text';
import { fixedMeasurer, napiMeasurer } from './helpers';

const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (s: string) => [...seg.segment(s)].map((g) => g.segment);

function wrapFixed(text: string, width: number, advance = 10) {
  const m = fixedMeasurer(advance);
  return new WordWrapper().wrap(text, width, (s) => m.measureLine(s, '15px x').width);
}

describe('rule 2: scripts written without spaces (AC-TXT-06)', () => {
  it('breaks Chinese with no spaces between graphemes, every line within the width', () => {
    const text = '我们的系统在每个平台上都以相同的方式换行而不会溢出边框';
    for (const w of [35, 50, 95, 133]) {
      const lines = wrapFixed(text, w);
      expect(lines.length).toBeGreaterThan(1);
      for (const l of lines) expect(l.width).toBeLessThanOrEqual(w + WRAP_EPSILON);
      expect(lines.map((l) => l.text).join('')).toBe(text);
    }
  });

  it('breaks Japanese kana and Korean hangul', () => {
    for (const text of ['ひらがなとカタカナのぶんしょうです', '한국어문장은공백이없어도줄바꿈됩니다']) {
      const lines = wrapFixed(text, 60);
      expect(lines.length).toBeGreaterThan(2);
      for (const l of lines) expect(l.width).toBeLessThanOrEqual(60 + WRAP_EPSILON);
    }
  });

  it('breaks between Latin and CJK runs', () => {
    expect(wrapFixed('Lekh中文混排ab', 45).map((l) => l.text)).toEqual(['Lekh', '中文混排', 'ab']);
  });

  it('breaks Thai at dictionary word boundaries, not inside words', () => {
    const text = 'ภาษาไทยไม่มีการเว้นวรรคระหว่างคำ';
    const words = [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map((w) => w.index);
    const lines = wrapFixed(text, 80);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines.slice(1)) expect(words).toContain(l.start);
  });

  it('measures with the bundled fonts on @napi-rs/canvas too (fallback advances included)', () => {
    const m = napiMeasurer();
    const key = 'normal 400 15px "Noto Sans", sans-serif';
    const text = '在每个平台上都以相同的方式换行';
    const lines = new WordWrapper().wrap(text, 60, (s) => m.measureLine(s, key).width);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(60 + WRAP_EPSILON);
  });
});

describe('rule 3: an over-long word breaks at a grapheme boundary (AC-TXT-06)', () => {
  it('breaks a Latin word wider than the line, filling each line', () => {
    const lines = wrapFixed('Supercalifragilisticexpialidocious', 100);
    expect(lines.map((l) => l.text)).toEqual(['Supercalif', 'ragilistic', 'expialidoc', 'ious']);
  });

  it('keeps the words around an over-long word on their own lines', () => {
    const lines = wrapFixed('a Supercalifragilistic b', 100);
    expect(lines.map((l) => l.text)).toEqual(['a', 'Supercalif', 'ragilistic', 'b']);
  });

  it('measures within the width with a real font', () => {
    const m = napiMeasurer();
    const key = 'normal 700 20px "Noto Serif", serif';
    const lines = new WordWrapper().wrap(
      'Pneumonoultramicroscopicsilicovolcanoconiosis',
      90,
      (s) => m.measureLine(s, key).width,
    );
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(90 + WRAP_EPSILON);
  });

  it('never splits an emoji ZWJ sequence, a flag, a skin tone or a combining mark', () => {
    const atoms = ['👨‍👩‍👧', '🇮🇳', '👍🏽', 'é', 'ñ', 'a'];
    const text = atoms.join('').repeat(4);
    const lines = wrapFixed(text, 25);
    for (const l of lines) for (const g of graphemes(l.text)) expect(atoms).toContain(g);
    expect(lines.map((l) => l.text).join('')).toBe(text);
  });

  it('puts a single grapheme wider than the line on a line of its own', () => {
    const lines = wrapFixed('abc', 5);
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });
});
