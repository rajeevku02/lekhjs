// Shared helpers for the template suites: a `TemplateEnv` over the test text stack with a fixed
// advance per character, a warning log, and a DrawingPlatform that records every call.
import { CONFIG_DEFAULTS } from '../../src/base';
import type { BezierCurve, Point, Rect, Size } from '../../src/geometry';
import type { DecodedImage, DrawingPlatform, PathPaint } from '../../src/render';
import type { Style } from '../../src/style';
import {
  NO_TEMPLATES,
  TemplateTextService,
  type GeneratorContext,
  type TemplateEnv,
  type TemplateResolver,
  type TemplateWarningCode,
} from '../../src/template';
import type { LaidOutText } from '../../src/text';
import { RecordedWidthMeasurer, createTestTextStack } from '../../src/testing';

export interface TestEnv extends TemplateEnv {
  readonly warnings: { code: TemplateWarningCode; details: Readonly<Record<string, string | number>> }[];
  readonly measurer: RecordedWidthMeasurer;
}

export interface TestEnvOptions {
  resolver?: TemplateResolver;
  images?: ReadonlyMap<string, DecodedImage>;
  advance?: number;
  generatorContext?: TemplateEnv['generatorContext'];
}

/** A context whose text sizes are 10 per character by 12 high. */
export const STUB_CONTEXT: GeneratorContext = Object.freeze({
  textSize: (t: string) => ({ w: t.length * 10, h: 12 }),
  strokeWidth: () => 1,
  splitLines: (t: string) => t.split('\n'),
  split: () => [],
  parseSizeSpec: () => ({ parsed: false, specs: [] }),
  monthInfo: () => ({ weekdayOfFirst: 1, daysInMonth: 30 }),
});

export function testEnv(opts: TestEnvOptions = {}): TestEnv {
  const measurer = new RecordedWidthMeasurer(new Map(), opts.advance ?? 10);
  const stack = createTestTextStack({ measurer });
  const warnings: TestEnv['warnings'] = [];
  const images = opts.images ?? new Map<string, DecodedImage>();
  return {
    config: CONFIG_DEFAULTS,
    text: new TemplateTextService(stack.layout, stack.resolver),
    resolver: opts.resolver ?? NO_TEMPLATES,
    image: (key) => images.get(key),
    generatorContext: opts.generatorContext ?? (() => STUB_CONTEXT),
    warn: (code, details) => warnings.push({ code, details }),
    warnings,
    measurer,
  };
}

const r = (n: number) => String(Math.round(n * 1000) / 1000);

/** Records every drawing call as a short string. */
export class LogPlatform implements DrawingPlatform {
  readonly log: string[] = [];
  readonly styles: Style[] = [];
  readonly paints: (PathPaint | undefined)[] = [];
  readonly texts: LaidOutText[] = [];

  startDrawing(pt: Point, style: Style, paint?: PathPaint): void {
    this.styles.push(style);
    this.paints.push(paint);
    this.log.push(`start ${r(pt.x)} ${r(pt.y)}`);
  }
  endDrawing(): void {
    this.log.push('end');
  }
  closePath(): void {
    this.log.push('Z');
  }
  addLineTo(pt: Point): void {
    this.log.push(`L ${r(pt.x)} ${r(pt.y)}`);
  }
  moveTo(pt: Point): void {
    this.log.push(`M ${r(pt.x)} ${r(pt.y)}`);
  }
  addCircle(c: Point, radius: number): void {
    this.log.push(`circle ${r(c.x)} ${r(c.y)} ${r(radius)}`);
  }
  addArc(): void {
    this.log.push('arc');
  }
  addEllipse(c: Point, w: number, h: number, rot: number): void {
    this.log.push(`E ${r(c.x)} ${r(c.y)} ${r(w)} ${r(h)} ${r(rot)}`);
  }
  addCurve(c: BezierCurve): void {
    const pts = c.numPoints === 3 ? [c.point2, c.point3] : [c.point2, c.point3, c.point4];
    this.log.push(`${c.numPoints === 3 ? 'Q' : 'C'} ${pts.map((p) => `${r(p.x)} ${r(p.y)}`).join(' ')}`);
  }
  addRoundedRect(rect: Rect): void {
    this.log.push(`RR ${r(rect.x)} ${r(rect.y)}`);
  }
  drawText(text: LaidOutText): void {
    this.texts.push(text);
    this.log.push(`text ${text.lines.map((l) => l.text).join('|')}`);
  }
  drawImage(center: Point, size: Size, rotation: number, image: DecodedImage | null | undefined): void {
    this.log.push(
      `image ${r(center.x)} ${r(center.y)} ${r(size.width)} ${r(size.height)} ${r(rotation)} ${String(image !== undefined && image !== null)}`,
    );
  }
  saveContext(): void {
    this.log.push('save');
  }
  restoreContext(): void {
    this.log.push('restore');
  }
  translate(x: number, y: number): void {
    this.log.push(`translate ${r(x)} ${r(y)}`);
  }
  clip(): void {
    this.log.push('clip');
  }
}
