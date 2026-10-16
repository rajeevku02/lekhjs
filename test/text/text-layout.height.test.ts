// AC-TXT-02: for any text and style, the measured height is lines × 1.18 × size × multiplier
// (spec 06 §3.3), measured with @napi-rs/canvas and the bundled fonts. Also the placement rules
// of §3.3: block height, vertical align, the baseline formula and the horizontal anchors.
import { describe, expect, it } from 'vitest';
import { Rect, Size } from '../../src/geometry';
import { FontStyle, FontWeight, Style, TextAlignHorizontal, TextAlignVertical } from '../../src/style';
import { createTestTextStack } from '../../src/testing';
import { LINE_PITCH, textStyleSnapshot } from '../../src/text';
import { MANIFEST, napiMeasurer, prng } from './helpers';

const FAMILIES = ['Noto Sans', 'Noto Serif', 'Noto Sans Mono', 'Caveat', '', 'Unknown Family'];
const WORDS = ['Lekh', 'diagram', 'shape', 'a', 'connector', 'Noto', 'wrap', 'x', '1.18', 'pitch', 'Über', 'naïve'];

describe('measured height (AC-TXT-02)', () => {
  const stack = createTestTextStack({ measurer: napiMeasurer(), manifest: MANIFEST });

  it('LINE_PITCH is 1.18', () => {
    expect(LINE_PITCH).toBe(1.18);
  });

  it('height = lines × 1.18 × size × multiplier over 1,000 random cases', () => {
    const rnd = prng(0x5eed);
    for (let i = 0; i < 1000; i++) {
      const style = new Style();
      const size = 6 + rnd() * 114;
      const mult = 0.5 + rnd() * 2.5;
      style.setFontSize(size);
      style.setFontMultiplier(mult);
      style.setFontFamily(FAMILIES[Math.floor(rnd() * FAMILIES.length)] ?? '');
      if (rnd() < 0.3) style.setFontWeight(FontWeight.Bold);
      if (rnd() < 0.3) style.setFontStyle(FontStyle.Italic);
      const n = Math.floor(rnd() * 30);
      let text = '';
      for (let w = 0; w < n; w++)
        text += (w > 0 ? (rnd() < 0.1 ? '\n' : ' ') : '') + (WORDS[Math.floor(rnd() * WORDS.length)] ?? '');
      const wrapWidth = rnd() < 0.2 ? 0 : 20 + rnd() * 600;
      const snap = textStyleSnapshot(style, stack.resolver);
      const sz = stack.layout.measure(text, snap, new Size(wrapWidth, 0));
      const laid = stack.layout.layout({ text, style: snap, box: new Rect(0, 0, wrapWidth, 100), wrapWidth, angle: 0 });
      const lines = laid.lines.length;
      expect(lines).toBeGreaterThanOrEqual(1);
      expect(Math.abs(sz.height - lines * 1.18 * size * mult)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(laid.height - sz.height)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('empty text is one empty line: width 0, height one pitch (B5, DR-ENG-05)', () => {
    const snap = textStyleSnapshot(new Style(), stack.resolver);
    expect(stack.layout.measure('', snap, new Size(100, 0))).toEqual(new Size(0, 1.18 * 15));
    expect(stack.layout.measure('', snap, new Size(0, 0))).toEqual(new Size(0, 1.18 * 15));
  });

  it('measure is not clamped to the constraint (as web/backend, unlike iOS)', () => {
    const snap = textStyleSnapshot(new Style(), stack.resolver);
    const sz = stack.layout.measure('hi', snap, new Size(500, 400));
    expect(sz.width).toBeLessThan(500);
    expect(sz.height).toBeCloseTo(17.7, 10);
  });
});

describe('placement (spec 06 §3.3)', () => {
  const stack = createTestTextStack({ measurer: napiMeasurer(), manifest: MANIFEST });
  const style = new Style();
  style.setFontSize(20);
  style.setFontFamily('Noto Sans');
  const box = new Rect(10, 20, 200, 100);

  it('centre: block centred in the box; baseline centres the font box in each line', () => {
    const snap = textStyleSnapshot(style, stack.resolver);
    const t = stack.layout.layout({ text: 'one\ntwo\nthree', style: snap, box, wrapWidth: 200, angle: 0 });
    const lp = 1.18 * 20;
    expect(t.lineHeight).toBeCloseTo(lp, 12);
    const top = 20 + 50 - (3 * lp) / 2;
    // Noto Sans: fontBoundingBox ascent/descent = 1069/293 per 1000 em (spike b).
    const a = 1.069 * 20;
    const d = 0.293 * 20;
    t.lines.forEach((l, i) => {
      expect(l.top).toBeCloseTo(top + i * lp, 9);
      expect(l.baselineY).toBeCloseTo(top + i * lp + (lp - (a + d)) / 2 + a, 3);
      expect(l.x).toBe(110);
    });
    expect(t.baseline).toBe('alphabetic');
  });

  it('top and bottom alignment; left and right anchors', () => {
    const s = new Style();
    s.setParent(style);
    s.setTextAlignVertical(TextAlignVertical.Top);
    s.setTextAlignHorizontal(TextAlignHorizontal.Left);
    let t = stack.layout.layout({
      text: 'a\nb',
      style: textStyleSnapshot(s, stack.resolver),
      box,
      wrapWidth: 200,
      angle: 0,
    });
    expect(t.lines[0]?.top).toBe(20);
    expect(t.lines[0]?.x).toBe(10);
    s.setTextAlignVertical(TextAlignVertical.Bottom);
    s.setTextAlignHorizontal(TextAlignHorizontal.Right);
    t = stack.layout.layout({
      text: 'a\nb',
      style: textStyleSnapshot(s, stack.resolver),
      box,
      wrapWidth: 200,
      angle: 0,
    });
    expect((t.lines[1]?.top ?? 0) + t.lineHeight).toBeCloseTo(120, 9);
    expect(t.lines[1]?.x).toBe(210);
  });

  it('defaultAlignAlways forces left (interpretText templates)', () => {
    const snap = textStyleSnapshot(style, stack.resolver, { defaultAlignAlways: true });
    expect(snap.align).toBe('left');
  });

  it('a font without fontBoundingBox metrics uses the hhea ascender/descender (OQ-38)', () => {
    const noBox = {
      measureLine: (s: string) => ({ width: s.length * 10, ascent: NaN, descent: NaN }),
    };
    const st = createTestTextStack({ measurer: noBox, manifest: MANIFEST });
    const t = st.layout.layout({
      text: 'x',
      style: textStyleSnapshot(style, st.resolver),
      box,
      wrapWidth: 0,
      angle: 0,
    });
    expect(t.ascent).toBeCloseTo(1.069 * 20, 9);
    expect(t.descent).toBeCloseTo(0.293 * 20, 9);
    const other = new Style();
    other.setFontSize(20);
    const plat = createTestTextStack({ measurer: noBox, manifest: MANIFEST, host: 'web' });
    const t2 = plat.layout.layout({
      text: 'x',
      style: textStyleSnapshot(other, plat.resolver),
      box,
      wrapWidth: 0,
      angle: 0,
    });
    expect(t2.ascent).toBeCloseTo(16, 9);
    expect(t2.descent).toBeCloseTo(4, 9);
  });
});
