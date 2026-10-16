// The generator host functions a session hands its templates until `generators/` provides
// `TemplateGeneratorHost` (spec 04 §5.1, task G1): text size and stroke width from the template's
// own style through the runtime's text layout, line splitting, and the calendar arithmetic. The
// wireframe markup parser (`split`) and `parseSizeSpec` belong to the generator port and answer
// "nothing" here.
import { Size } from '../geometry';
import type { GeneratorContext, ShapeTemplate, TemplateText } from '../template';

const UNCONSTRAINED: Size = Object.freeze(new Size(-1, -1));

export function basicGeneratorContext(t: ShapeTemplate, text: TemplateText): GeneratorContext {
  return {
    textSize(s: string) {
      const size = text.measure(s, t.getStyle(), UNCONSTRAINED);
      return { w: size.width, h: size.height };
    },
    strokeWidth: () => t.getStyle().effectiveStrokeWidth(),
    splitLines: (s: string) => s.split('\n').map((l) => l.replace('\r', '')),
    split: () => [],
    parseSizeSpec: () => ({ parsed: false, specs: [] }),
    monthInfo(month: number, year: number) {
      const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 1;
      const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return { weekdayOfFirst: first, daysInMonth: days };
    },
  };
}
