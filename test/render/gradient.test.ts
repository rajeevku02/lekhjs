// computeGradient: the C++ ShapePathElement::draw formulas (percent of the box → canvas units),
// computed from the current box, never written into the style (B10).
import { describe, expect, it } from 'vitest';
import { computeGradient } from '../../src/render';
import { Color, Gradient, Paint, PaintType } from '../../src/style';

const stops = [
  { offset: 0, color: new Color(255, 0, 0) },
  { offset: 1, color: new Color(0, 0, 255) },
];
const box = { cx: 150, cy: 100, width: 200, height: 100 };

describe('computeGradient', () => {
  it('linear: left + x·w/100, top + y·h/100', () => {
    const p = new Paint({
      type: PaintType.LinearGradient,
      linearGradient: Gradient.linear({ x1: 0, y1: 50, x2: 100, y2: 50, stops }),
    });
    expect(computeGradient(p, box)).toEqual({
      type: 'linear',
      x1: 50,
      y1: 100,
      x2: 250,
      y2: 100,
      stops: p.linearGradient.stops,
    });
  });

  it('radial: radii scale with the width only', () => {
    const p = new Paint({
      type: PaintType.RadialGradient,
      radialGradient: Gradient.radial({ cx: 50, cy: 50, r: 50, fx: 25, fy: 25, fr: 10, stops }),
    });
    expect(computeGradient(p, box)).toEqual({
      type: 'radial',
      cx: 150,
      cy: 100,
      r: 100,
      fx: 100,
      fy: 75,
      fr: 20,
      stops: p.radialGradient.stops,
    });
  });

  it('null for a solid paint or no paint', () => {
    expect(computeGradient(Paint.solid(new Color(1, 2, 3)), box)).toBeNull();
    expect(computeGradient(new Paint(), box)).toBeNull();
  });
});
