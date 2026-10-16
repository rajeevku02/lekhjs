// The generator contract on a live template (spec 04 §5.1; port of C++ `ShapeGenerator`,
// `L/shapegen/ShapeGenerator.h`). `template/` defines it and never imports `generators/`: the
// registry, the wireframe adapter, the native generators and the placeholder implement it there,
// and the codec attaches one to a template.
//
// `generate` is called only from `ShapeTemplate.load()` (AC-GEN-07): never from layout, paint,
// hit testing or export.
import type { Point } from '../../geometry';
import type { DataStore } from '../expr/data-store';
import type { JsonObject } from '../json';
import type { InterestingPoint, ShapeTemplate } from '../model/shape-template';
import type { GeneratorContext } from './generator-context';

/** C++ `ShapeGenerator::Behavior`: wireframe generators `generateAlways`, native ones `onParamChange`. */
export type GeneratorBehavior = 'generateAlways' | 'onParamChange';

/** What the serializer writes as `template.generator`. */
export type GeneratorJson = JsonObject;

export abstract class ShapeGenerator {
  abstract readonly behavior: GeneratorBehavior;
  abstract interpretText(): boolean;
  /** `generator.text` (C++ `interpretedText`). */
  abstract interpretedText(): string;
  /** The template ids the generated template embeds (`embedrefs`), sorted (C++ `std::set`). */
  abstract embedReferences(): readonly string[];
  /** Rewrites `t`'s template data (data, draw, texts, images, embeds, containers). */
  abstract generate(t: ShapeTemplate, ctx: GeneratorContext): void;
  /** Enforces the generator's minimum size on the instance box. */
  abstract setDimension(ds: DataStore): void;
  abstract clone(): ShapeGenerator;
  abstract toJSON(): GeneratorJson;

  /* eslint-disable @typescript-eslint/no-unused-vars -- default hooks take the parameters their overrides use */
  /** Sets `generator.text`; the template reloads after. */
  setInterpretedText(_text: string): void {
    /* by default the text is not interpreted */
  }
  canDoVertexEditing(): boolean {
    return false;
  }
  doesPartialTextManipulation(): boolean {
    return false;
  }
  getInterestingPoints(_t: ShapeTemplate, _ds: DataStore, _out: InterestingPoint[]): void {
    /* none by default */
  }
  /** Moves vertex `index` to `to`; returns where it went (C++ `out`). */
  moveVertexTo(_t: ShapeTemplate, _ds: DataStore, _index: number, to: Point): Point {
    return to;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
