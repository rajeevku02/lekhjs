// AC-TXT-31: `WordWrapper` replayed through `RecordedWidthMeasurer` with the native dump's
// per-grapheme advances breaks at the same UTF-16 offsets as the 3.5.9 iOS app (and Android's
// where they agree), at every recorded width.
//
// The dump comes from the dev-build "dump wrap" action on device (H-TXT-2, DEV-75) and lands in
// test/text/fixtures/native-wrap/*.json. Until it exists the replay suite has nothing to run and
// is reported as todo; the replay machinery itself is checked below on a hand-built case.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RecordedWidthMeasurer, type NativeWrapCase } from '../../src/testing';
import { WordWrapper } from '../../src/text';
import { PKG_ROOT } from '../lint/eslint-helpers';

/** One dumped text object (the H-TXT-2 format). */
interface DumpCase extends NativeWrapCase {
  font: string;
  platform: 'ios' | 'android';
  /** Per width: the UTF-16 offsets where lines 2, 3, … start. */
  widths: { width: number; breaks: number[] }[];
}

const DIR = path.join(PKG_ROOT, 'test/text/fixtures/native-wrap');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];

/** The UTF-16 start offsets of the second and later lines of each paragraph. */
function breaksOf(text: string, width: number, m: RecordedWidthMeasurer): number[] {
  return new WordWrapper()
    .wrap(text, width, (s) => m.measureLine(s, '15px x').width)
    .filter((l, i, all) => i > 0 && all[i - 1]?.paragraph === l.paragraph)
    .map((l) => l.start);
}

describe('native wrap replay (AC-TXT-31)', () => {
  if (files.length === 0) {
    it.todo('replays the H-TXT-2 native wrap dump (blocked: no dump in test/text/fixtures/native-wrap yet)');
  }
  for (const f of files) {
    const cases = JSON.parse(readFileSync(path.join(DIR, f), 'utf8')) as DumpCase[];
    it(`${f}: every case breaks at the native offsets`, () => {
      const m = RecordedWidthMeasurer.fromNativeDump(cases);
      const diffs: string[] = [];
      for (const c of cases.filter((x) => x.platform === 'ios')) {
        for (const w of c.widths) {
          const got = breaksOf(c.text, w.width, m);
          if (JSON.stringify(got) !== JSON.stringify(w.breaks))
            diffs.push(`${c.text.slice(0, 20)} @ ${String(w.width)}`);
        }
      }
      expect(diffs).toEqual([]);
    });
  }

  it('the replay measurer sums the recorded grapheme advances', () => {
    const c = { text: 'ab 中文👍🏽', advances: [7, 8, 4, 15, 15, 20] };
    const m = RecordedWidthMeasurer.fromNativeDump([c]);
    expect(m.measureLine('ab 中文👍🏽', '15px x').width).toBe(69);
    expect(m.measureLine('中👍🏽', '15px x').width).toBe(35);
    expect(breaksOf(c.text, 40, m)).toEqual([4]); // 'ab 中' | '文👍🏽'
    expect(() => RecordedWidthMeasurer.fromNativeDump([{ text: 'ab', advances: [1] }])).toThrow(RangeError);
    expect(() => m.measureLine('z', '15px x')).toThrow(RangeError);
  });
});
