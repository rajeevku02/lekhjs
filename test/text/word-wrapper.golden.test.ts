// AC-TXT-05: wrap of whitespace-only Latin text equals the C++ `TextUtil::getWidth` line splits
// when both measure with the same width table. The golden is written by
// parity/tools/capture-word-wrap/regen.mjs from the C++ TextUtil.cpp.
// AC-TXT-30 (oracle half): with `lineSpacingCompat` on, the layout height equals the C++ web's
// `getTextSize` height (font size per line) for the same splits.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Size } from '../../src/geometry';
import { RecordedWidthMeasurer, createTestTextStack } from '../../src/testing';
import { LineWidthCache, WordWrapper, buildFontKey, textStyleSnapshot } from '../../src/text';
import { Style } from '../../src/style';
import { PKG_ROOT } from '../lint/eslint-helpers';

interface Golden {
  fontPx: number;
  table: Record<string, number>;
  fixtures: string[];
  cases: { fixture: number; width: number; height: number; lines: string[] }[];
}
const golden = JSON.parse(
  readFileSync(path.join(PKG_ROOT, 'test/fixtures/golden/word-wrap/whitespace-latin.json'), 'utf8'),
) as Golden;

describe('WordWrapper vs C++ TextUtil::getWidth (AC-TXT-05)', () => {
  const measurer = RecordedWidthMeasurer.fromWidthTable(golden.table);
  const wrapper = new WordWrapper();

  it('has the 200 captured cases', () => {
    expect(golden.cases).toHaveLength(200);
  });

  it('splits every fixture at every width exactly as C++', () => {
    const mismatches: string[] = [];
    for (const c of golden.cases) {
      const text = golden.fixtures[c.fixture] ?? '';
      const got = wrapper.wrap(text, c.width, (s) => measurer.measureLine(s, '15px x').width).map((l) => l.text);
      if (JSON.stringify(got) !== JSON.stringify(c.lines))
        mismatches.push(`fixture ${String(c.fixture)} @ ${String(c.width)}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('with lineSpacingCompat on, layout heights equal the C++ web heights (AC-TXT-30)', () => {
    const stack = createTestTextStack({ measurer, testing: { lineSpacingCompat: true } });
    const style = new Style();
    style.setFontSize(golden.fontPx);
    style.setFontMultiplier(1.4); // the C++ web pitch ignores the multiplier
    const snap = textStyleSnapshot(style, stack.resolver);
    // The table is per font size 15 px, so measure as if the multiplier were 1.
    const flat = { ...snap, fontMultiplier: 1 };
    for (const c of golden.cases) {
      const text = golden.fixtures[c.fixture] ?? '';
      const h = stack.layout.measure(text, flat, new Size(c.width, 0)).height;
      expect(h).toBe(c.height);
      expect(stack.layout.lineHeight(snap)).toBe(golden.fontPx);
    }
  });

  it('the shared cache serves the backwards prefix measurements', () => {
    const cache = new LineWidthCache();
    const key = buildFontKey(
      {
        families: ['"Noto Sans"', 'sans-serif'],
        weight: 400,
        style: 'normal',
        stretch: 'normal',
        source: 'bundled',
        primary: 'Noto Sans',
      },
      15,
    );
    const counting = RecordedWidthMeasurer.fromWidthTable(golden.table);
    const text = golden.fixtures[4] ?? '';
    const run = () => wrapper.wrap(text, 120, (s) => cache.width(key, s, 0, () => counting.measureLine(s, key).width));
    const first = run();
    const calls = counting.calls;
    expect(run()).toEqual(first);
    expect(counting.calls).toBe(calls);
  });
});
