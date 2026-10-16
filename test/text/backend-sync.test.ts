// AC-TXT-09 (text half): the backend measures with @napi-rs/canvas through the same TextLayout
// code, synchronously: no engine text call returns a thenable, and the napi measurer is the one
// used. (The `createNodeRuntime` and object `layout()` halves come with session/ and model/.)
import { describe, expect, it } from 'vitest';
import { Rect, Size } from '../../src/geometry';
import { FontWeight, Style } from '../../src/style';
import { createTestTextStack } from '../../src/testing';
import { CanvasTextMeasurer, TextMeasureMemo, textStyleSnapshot } from '../../src/text';
import { MANIFEST, napiMeasurer, recordingContext } from './helpers';

const isThenable = (v: unknown) => typeof (v as { then?: unknown } | null)?.then === 'function';

describe('backend text is synchronous (AC-TXT-09)', () => {
  it('measure, layout, paint and resolve return plain values over the napi measurer', () => {
    const measurer = napiMeasurer();
    const stack = createTestTextStack({
      measurer,
      manifest: MANIFEST,
      host: 'backend',
      fallbackFamilies: ['Noto Sans CJK SC'],
    });
    expect(stack.measurer).toBeInstanceOf(CanvasTextMeasurer);
    const style = new Style();
    style.setFontWeight(FontWeight.Bold);
    const snap = textStyleSnapshot(style, stack.resolver);
    const results: unknown[] = [
      snap,
      stack.layout.measure('Start\nProcess', snap, new Size(80, 0)),
      stack.layout.layout(
        { text: 'A decision node', style: snap, box: new Rect(0, 0, 80, 40), wrapWidth: 80, angle: 0 },
        new TextMeasureMemo(),
      ),
      measurer.measureLine('x', 'normal 400 15px "Noto Sans", sans-serif'),
    ];
    for (const r of results) expect(isThenable(r)).toBe(false);
    const laid = stack.layout.layout({ text: 'x', style: snap, box: new Rect(0, 0, 9, 9), wrapWidth: 0, angle: 0 });
    const paint = stack.painter.paint.bind(stack.painter) as (...args: unknown[]) => unknown;
    const painted = paint(recordingContext().ctx, laid, { fill: '#000' });
    expect(isThenable(painted)).toBe(false);
    expect(measurer.calls).toBeGreaterThan(0);
    expect(snap.font.families).toEqual(['"Noto Sans"', '"Noto Sans CJK SC"', 'sans-serif']);
  });
});
