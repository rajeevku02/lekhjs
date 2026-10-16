// AC-TXT-28: Japanese never wraps so that a line starts with 。、」）！ or a small kana or ー, or
// ends with 「 or （ (spec 06 §3.2 rule 4, kinsoku).
import { describe, expect, it } from 'vitest';
import { LB, WordWrapper, lineBreakClass } from '../../src/text';
import { fixedMeasurer } from './helpers';

const NO_START = ['。', '、', '」', '）', '！', '？', 'ぁ', 'ゃ', 'ょ', 'っ', 'ァ', 'ッ', 'ー', '・', '：', '，', '．'];
const NO_END = ['「', '（', '『', '【', '〈'];

function wrap(text: string, width: number) {
  const m = fixedMeasurer(10);
  return new WordWrapper().wrap(text, width, (s) => m.measureLine(s, '15px x').width).map((l) => l.text);
}

describe('kinsoku (AC-TXT-28)', () => {
  it('the generated table classes the prohibited characters', () => {
    for (const ch of NO_START) {
      expect([LB.CL, LB.CP, LB.EX, LB.IS, LB.NS]).toContain(lineBreakClass(ch.codePointAt(0) ?? 0));
    }
    for (const ch of NO_END) expect(lineBreakClass(ch.codePointAt(0) ?? 0)).toBe(LB.OP);
  });

  it('never starts a line with a no-start character placed at the natural break', () => {
    for (const ch of NO_START) {
      // Each line holds 4 characters; the prohibited character sits at index 4, 8, 12, …
      const text = `日本語${ch}文章日本${ch}語文章日${ch}本語文章`;
      for (const w of [30, 40, 50, 60]) {
        const lines = wrap(text, w);
        for (const l of lines.slice(1))
          expect(NO_START, `${ch} @ ${String(w)}: ${JSON.stringify(lines)}`).not.toContain(l[0]);
        expect(lines.join('')).toBe(text);
      }
    }
  });

  it('never ends a line with an opening bracket placed at the natural break', () => {
    for (const ch of NO_END) {
      const text = `日本語${ch}文章日本${ch}語文章日${ch}本語文章`;
      for (const w of [30, 40, 50, 60]) {
        const lines = wrap(text, w);
        for (const l of lines.slice(0, -1)) expect(NO_END, `${ch} @ ${String(w)}`).not.toContain(l[l.length - 1]);
      }
    }
  });

  it('moves the break to the previous allowed boundary', () => {
    expect(wrap('日本語。文章', 30)).toEqual(['日本', '語。文', '章']);
    expect(wrap('日本「語文章', 30)).toEqual(['日本', '「語文', '章']);
  });

  it('a long-vowel mark and a small tsu stay with the preceding kana', () => {
    expect(wrap('コーヒーカップ', 30)).toEqual(['コー', 'ヒー', 'カップ']);
    for (const l of wrap('コーヒーカップがっこう', 30).slice(1)) expect(['ー', 'ッ', 'っ']).not.toContain(l[0]);
  });
});
