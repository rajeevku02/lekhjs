// AC-TXT-29 (unit half): a paragraph's direction is its first strong character (DR-TXT-09); the
// painter sets `ctx.direction` before each `fillText` and keeps `textAlign` absolute, so every
// line sits where the ltr layout puts it. Recording-context spy.
import { describe, expect, it } from 'vitest';
import { Rect } from '../../src/geometry';
import { Style, TextAlignHorizontal } from '../../src/style';
import { createTestTextStack } from '../../src/testing';
import { paragraphDirection, textStyleSnapshot } from '../../src/text';
import { fixedMeasurer, recordingContext } from './helpers';

describe('paragraph direction (AC-TXT-29)', () => {
  it('first strong character: Arabic-first → rtl, Latin-first → ltr, digits only → ltr', () => {
    expect(paragraphDirection('مرحبا بالعالم Lekh 2026')).toBe('rtl');
    expect(paragraphDirection('Lekh يرسم المخططات')).toBe('ltr');
    expect(paragraphDirection('2026 - 10 - 16')).toBe('ltr');
    expect(paragraphDirection('  (שלום) world')).toBe('rtl');
    expect(paragraphDirection('')).toBe('ltr');
  });

  it('each paragraph gets its own direction, on every wrapped line of it', () => {
    const stack = createTestTextStack({ measurer: fixedMeasurer(10) });
    const snap = textStyleSnapshot(new Style(), stack.resolver);
    const t = stack.layout.layout({
      text: 'مرحبا بالعالم Lekh 2026\nLekh يرسم المخططات',
      style: snap,
      box: new Rect(0, 0, 100, 100),
      wrapWidth: 100,
      angle: 0,
    });
    expect(t.lines.length).toBeGreaterThan(2);
    const firstPara = t.lines.filter((l) => l.start < 23);
    expect(firstPara.every((l) => l.dir === 'rtl')).toBe(true);
    expect(t.lines.filter((l) => l.start >= 24).every((l) => l.dir === 'ltr')).toBe(true);
  });

  it('the painter sets ctx.direction before each fillText; textAlign stays absolute; x equals ltr', () => {
    const stack = createTestTextStack({ measurer: fixedMeasurer(10) });
    for (const align of [TextAlignHorizontal.Left, TextAlignHorizontal.Center, TextAlignHorizontal.Right]) {
      const style = new Style();
      style.setTextAlignHorizontal(align);
      const snap = textStyleSnapshot(style, stack.resolver);
      const box = new Rect(10, 10, 300, 80);
      const mixed = stack.layout.layout({
        text: 'مرحبا Lekh 12\nLekh مرحبا',
        style: snap,
        box,
        wrapWidth: 300,
        angle: 0,
      });
      const ltr = stack.layout.layout({
        text: 'abcde Lekh 12\nLekh abcde',
        style: snap,
        box,
        wrapWidth: 300,
        angle: 0,
      });
      const { ctx, fills } = recordingContext();
      stack.painter.paint(ctx, mixed, { fill: '#000' });
      expect(fills.map((f) => f.direction)).toEqual(['rtl', 'ltr']);
      expect(fills.every((f) => ['left', 'center', 'right'].includes(f.align))).toBe(true);
      expect(fills.map((f) => f.x)).toEqual(ltr.lines.map((l) => l.x));
      expect(fills.map((f) => f.y)).toEqual(ltr.lines.map((l) => l.baselineY));
    }
  });
});
