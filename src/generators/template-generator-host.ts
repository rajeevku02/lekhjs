// `TemplateGeneratorHost`: the generator host functions bound to one template (spec 04 §5.1; the
// 8 Lua host functions of `L/shapegen/LuaShapeGenerator.cpp:585-607` minus `escapeJson` and
// `debugPrint`). Text is measured in the template's own style, unconstrained, through the session's
// text stack (C++ `Platform::getTextSize(str, stl->getStyle(), Size(-1, -1))`).
import { Size } from '../geometry';
import type { GeneratorContext, ShapeTemplate, SizeSpec, SplitItem, SplitOptions, TemplateText } from '../template';
import { monthInfo } from './month-info';
import { parseSizeSpec, split, splitLines } from './wireframe-text';

const UNCONSTRAINED: Size = Object.freeze(new Size(-1, -1));

export class TemplateGeneratorHost implements GeneratorContext {
  private readonly t_: ShapeTemplate;
  private readonly text_: TemplateText;

  constructor(t: ShapeTemplate, text: TemplateText) {
    this.t_ = t;
    this.text_ = text;
  }

  textSize(s: string): { readonly w: number; readonly h: number } {
    const size = this.text_.measure(s, this.t_.getStyle(), UNCONSTRAINED);
    return { w: size.width, h: size.height };
  }

  strokeWidth(): number {
    return this.t_.getStyle().effectiveStrokeWidth();
  }

  splitLines(s: string): string[] {
    return splitLines(s);
  }

  split(s: string, opts: SplitOptions): SplitItem[] {
    return split(s, opts, (w) => this.textSize(w));
  }

  parseSizeSpec(spec: string): SizeSpec {
    return parseSizeSpec(spec);
  }

  monthInfo(month: number, year: number): { readonly weekdayOfFirst: number; readonly daysInMonth: number } {
    return monthInfo(month, year);
  }
}
