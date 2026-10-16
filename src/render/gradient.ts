// Gradient coordinates for a box: the formulas of C++ `ShapePathElement::draw`
// (`ShapeElement.cpp:157-175`). Percentages of the box become canvas units. The C++ wrote the
// result into the style *after* drawing (B10), so a shape painted with the previous draw's
// coordinates; here they are computed from the current box, by the layout, before paint.
import type { Paint } from '../style';
import { PaintType } from '../style';
import type { ComputedGradient } from './drawing-platform';

/** The box a gradient is relative to: centre and size (C++ `ds->cx()`, `cy()`, `width()`, `height()`). */
export interface GradientBox {
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
}

/** The gradient of `paint` in canvas units, or `null` when `paint` is not a gradient. */
export function computeGradient(paint: Paint, box: GradientBox): ComputedGradient | null {
  const left = box.cx - box.width / 2;
  const top = box.cy - box.height / 2;
  if (paint.type === PaintType.LinearGradient) {
    const g = paint.linearGradient;
    return {
      type: 'linear',
      x1: left + (g.x1 * box.width) / 100,
      y1: top + (g.y1 * box.height) / 100,
      x2: left + (g.x2 * box.width) / 100,
      y2: top + (g.y2 * box.height) / 100,
      stops: g.stops,
    };
  }
  if (paint.type === PaintType.RadialGradient) {
    const g = paint.radialGradient;
    return {
      type: 'radial',
      cx: left + (g.cx * box.width) / 100,
      cy: top + (g.cy * box.height) / 100,
      r: (g.r * box.width) / 100,
      fx: left + (g.fx * box.width) / 100,
      fy: top + (g.fy * box.height) / 100,
      fr: (g.fr * box.width) / 100,
      stops: g.stops,
    };
  }
  return null;
}
