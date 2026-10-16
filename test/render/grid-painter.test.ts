// GridPainter: C++ CanvasWidget::drawBackground — the background rect (white unless a colour,
// a 2 px separator border on a finite canvas), the two alternating greys, spacing × zoom, the
// offset and phase from the zoomed scroll.
import { describe, expect, it } from 'vitest';
import {
  GRID_LINE_COLOR_1,
  GRID_LINE_COLOR_2,
  GridPainter,
  SEPARATOR_COLOR,
  type GridPaintInput,
} from '../../src/render';
import { Color } from '../../src/style';
import { RecordingPlatform } from './helpers';

const base: GridPaintInput = {
  background: { type: 'default' },
  gridPresent: true,
  gridWidth: 20,
  zoom: 1,
  scrollX: 0,
  scrollY: 0,
  width: 100,
  height: 60,
  infiniteCanvas: true,
};

function paint(over: Partial<GridPaintInput>) {
  const dp = new RecordingPlatform();
  new GridPainter().paint(dp, { ...base, ...over });
  return dp.paths;
}

describe('GridPainter', () => {
  it('fills the canvas white with no border on an infinite canvas', () => {
    const [bg] = paint({ gridPresent: false });
    expect(bg?.ops).toEqual(['L 100 0', 'L 100 60', 'L 0 60', 'Z']);
    expect(bg?.style.effectiveFillPaint().solidColor.toCss()).toBe('rgba(255, 255, 255, 1)');
    expect(bg?.style.effectiveStrokeWidth()).toBe(0);
  });

  it('a colour background fills with it; an image background is white (C++ TODO)', () => {
    const c = new Color(1, 2, 3);
    expect(
      paint({ gridPresent: false, background: { type: 'color', color: c } })[0]?.style.effectiveFillPaint().solidColor,
    ).toEqual(c);
    expect(
      paint({ gridPresent: false, background: { type: 'image' } })[0]
        ?.style.effectiveFillPaint()
        .solidColor.toCss(),
    ).toBe('rgba(255, 255, 255, 1)');
  });

  it('a finite canvas gets a 2 px border in the theme separator colour', () => {
    const light = paint({ gridPresent: false, infiniteCanvas: false })[0]?.style;
    expect(light?.effectiveStrokeWidth()).toBe(2);
    expect(light?.effectiveStrokePaint().solidColor).toEqual(SEPARATOR_COLOR.light);
    const dark = paint({ gridPresent: false, infiniteCanvas: false, theme: 'dark' })[0]?.style;
    expect(dark?.effectiveStrokePaint().solidColor).toEqual(SEPARATOR_COLOR.dark);
  });

  it('draws vertical then horizontal lines at the spacing, alternating colours', () => {
    const [, ...lines] = paint({});
    // i·20 < 100 + 20 → 6 verticals; i·20 < 60 + 20 → 4 horizontals
    expect(lines).toHaveLength(10);
    expect(lines.slice(0, 6).map((l) => [l.start.x, l.start.y, l.ops[0]])).toEqual([
      [0, 0, 'L 0 60'],
      [20, 0, 'L 20 60'],
      [40, 0, 'L 40 60'],
      [60, 0, 'L 60 60'],
      [80, 0, 'L 80 60'],
      [100, 0, 'L 100 60'],
    ]);
    expect(lines.slice(6).map((l) => l.start.y)).toEqual([0, 20, 40, 60]);
    const colours = lines.map((l) => l.style.effectiveStrokePaint().solidColor);
    expect(colours.slice(0, 2)).toEqual([GRID_LINE_COLOR_1, GRID_LINE_COLOR_2]);
    expect(lines.every((l) => l.style.effectiveStrokeWidth() === 1)).toBe(true);
  });

  it('spacing and stroke width scale with the zoom', () => {
    const [, ...lines] = paint({ zoom: 2 });
    expect(lines.slice(0, 2).map((l) => l.start.x)).toEqual([0, 40]);
    expect(lines[0]?.style.effectiveStrokeWidth()).toBe(2);
  });

  it('a positive scroll offsets by scroll·zoom mod spacing; an odd cell count swaps the colours', () => {
    // sx = 30 → start 10, cell 1 (odd) → style2 first
    const [, first] = paint({ scrollX: 30 });
    expect(first?.start.x).toBe(10);
    expect(first?.style.effectiveStrokePaint().solidColor).toEqual(GRID_LINE_COLOR_2);
  });

  it('a negative scroll: start = w − (−s mod w), even cell count swaps', () => {
    // sx = −30 → start 20 − 10 = 10; trunc(30/20) = 1 → odd → not swapped
    let [, first] = paint({ scrollX: -30 });
    expect(first?.start.x).toBe(10);
    expect(first?.style.effectiveStrokePaint().solidColor).toEqual(GRID_LINE_COLOR_1);
    // sx = −10 → trunc(10/20) = 0 → even → swapped
    [, first] = paint({ scrollX: -10 });
    expect(first?.start.x).toBe(10);
    expect(first?.style.effectiveStrokePaint().solidColor).toEqual(GRID_LINE_COLOR_2);
  });

  it('no lines without a grid or with a non-positive spacing', () => {
    expect(paint({ gridPresent: false })).toHaveLength(1);
    expect(paint({ gridWidth: 0 })).toHaveLength(1);
  });
});
