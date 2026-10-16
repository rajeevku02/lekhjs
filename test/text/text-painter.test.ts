// TextPainter (spec 06 §4, §3.3): one font assignment per block, fillText per line at its
// baseline, underline / strike-through positions and thickness, rotation about the box centre,
// and the `top` baseline under `lineSpacingCompat`. Also a real @napi-rs/canvas draw.
import { describe, expect, it } from 'vitest';
import { Rect } from '../../src/geometry';
import { Style, TextDecoration } from '../../src/style';
import { createTestTextStack } from '../../src/testing';
import { textStyleSnapshot } from '../../src/text';
import { createCanvas } from '@napi-rs/canvas';
import { MANIFEST, fixedMeasurer, napiMeasurer, recordingContext } from './helpers';

describe('TextPainter', () => {
  const box = new Rect(0, 0, 200, 100);

  it('sets the font once, then fills each line at its anchor and baseline', () => {
    const stack = createTestTextStack({ measurer: fixedMeasurer(10) });
    const t = stack.layout.layout({
      text: 'one\ntwo',
      style: textStyleSnapshot(new Style(), stack.resolver),
      box,
      wrapWidth: 200,
      angle: 0,
    });
    const { ctx, fills, log } = recordingContext();
    stack.painter.paint(ctx, t, { fill: 'rgba(0, 0, 0, 1)' });
    expect(ctx.font).toBe('normal 400 15px "Noto Sans", sans-serif');
    expect(fills.map((f) => [f.text, f.x, f.y, f.baseline])).toEqual(
      t.lines.map((l) => [l.text, 100, l.baselineY, 'alphabetic']),
    );
    expect(log[0]).toBe('save');
    expect(log.at(-1)).toBe('restore');
    expect(ctx.fillStyle).toBe('rgba(0, 0, 0, 1)');
  });

  it('underline at top + (LP − fs)/2 + 0.92·fs, strike-through at + 0.5·fs, width max(1 view px, fs/15)', () => {
    const stack = createTestTextStack({ measurer: fixedMeasurer(10) });
    const style = new Style();
    style.setFontSize(30);
    style.setTextDecoration(TextDecoration.UnderLine | TextDecoration.StrikeThrough);
    const t = stack.layout.layout({
      text: 'abc',
      style: textStyleSnapshot(style, stack.resolver),
      box,
      wrapWidth: 0,
      angle: 0,
    });
    const { ctx, log } = recordingContext();
    stack.painter.paint(ctx, t, { fill: '#000', viewScale: 0.25 });
    const line = t.lines[0];
    expect(line).toBeDefined();
    const em = (line?.top ?? 0) + (t.lineHeight - 30) / 2;
    expect(log).toContain(`moveTo ${(100 - 15).toFixed(3)} ${(em + 15).toFixed(3)}`);
    expect(log).toContain(`lineTo ${(100 + 15).toFixed(3)} ${(em + 27.6).toFixed(3)}`);
    expect(ctx.lineWidth).toBe(4); // max(1 / 0.25, 30 / 15)
  });

  it('rotates about the box centre', () => {
    const stack = createTestTextStack({ measurer: fixedMeasurer(10) });
    const t = stack.layout.layout({
      text: 'x',
      style: textStyleSnapshot(new Style(), stack.resolver),
      box: new Rect(10, 20, 100, 50),
      wrapWidth: 0,
      angle: 0.5,
    });
    const { ctx, log } = recordingContext();
    stack.painter.paint(ctx, t, { fill: '#000' });
    expect(log.slice(0, 4)).toEqual(['save', 'translate 60 45', 'rotate 0.5', 'translate -60 -45']);
  });

  it('lineSpacingCompat: pitch = font size, textBaseline top at top + i·LP', () => {
    const stack = createTestTextStack({ measurer: fixedMeasurer(10), testing: { lineSpacingCompat: true } });
    const style = new Style();
    style.setFontSize(20);
    style.setFontMultiplier(2);
    const t = stack.layout.layout({
      text: 'a\nb',
      style: textStyleSnapshot(style, stack.resolver),
      box,
      wrapWidth: 0,
      angle: 0,
    });
    expect(t.lineHeight).toBe(20);
    expect(t.baseline).toBe('top');
    expect(t.lines.map((l) => l.baselineY)).toEqual([30, 50]);
    const { ctx, fills } = recordingContext();
    stack.painter.paint(ctx, t, { fill: '#000' });
    expect(fills.map((f) => f.baseline)).toEqual(['top', 'top']);
  });

  it('draws on a real @napi-rs/canvas context', () => {
    const stack = createTestTextStack({ measurer: napiMeasurer(), manifest: MANIFEST });
    const t = stack.layout.layout({
      text: 'Lekh',
      style: textStyleSnapshot(new Style(), stack.resolver),
      box,
      wrapWidth: 0,
      angle: 0,
    });
    const canvas = createCanvas(200, 100);
    const ctx = canvas.getContext('2d');
    stack.painter.paint(ctx, t, { fill: '#000' });
    const px = ctx.getImageData(0, 0, 200, 100).data;
    let ink = 0;
    for (let i = 3; i < px.length; i += 4) if ((px[i] ?? 0) > 0) ink++;
    expect(ink).toBeGreaterThan(20);
  });
});
