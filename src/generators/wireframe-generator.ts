// `WireframeGenerator`: runs one pure wireframe module and applies its structured output to the
// template (spec 04 §5.1; replaces C++ `LuaShapeGenerator`, `L/shapegen/LuaShapeGenerator.cpp`).
//
// `generate` (called only by `ShapeTemplate.load()`, AC-GEN-07):
//   1. calls the module with the template's parameter values and `generator.text`, inside `try`;
//   2. on success replaces the template's data, draw, texts, images, embeds and containers (C++
//      `clearTemplateData` + `parseTemplateData` of the script's JSON: the same parser, injected by
//      io/ as the `TemplateDataApplier`), keeps `minW`/`minH` and applies `disabled`;
//   3. on a throw keeps the previous output, as C++ did, and warns `generator_failed`; with no
//      previous output (the first generation) the template draws the placeholder until a later
//      generation succeeds (DR-GEN-10). `minW`/`minH` start at 0 (DR-GEN-03).
// It is `generateAlways`: the serializer writes `data` but not the generated members, and the
// template has no title. It writes `{script, text, interprettext[, embedrefs]}` with the module's
// canonical JS text (spec 04 §5.5); the text is a copy and is never evaluated (AC-GEN-09).
import type {
  DataStore,
  GeneratorBehavior,
  GeneratorContext,
  JsonObject,
  ShapeTemplate,
  WireframeModule,
} from '../template';
import { ShapeGenerator } from '../template';
import { outputToTemplateJson, placeholderOutput, type TemplateDataApplier } from './wireframe-output';

/** What a generator block carries besides its script. */
export interface GeneratorFields {
  readonly text: string;
  readonly interpretText: boolean;
  readonly embedRefs: readonly string[];
}

/** `embedrefs` as C++ held them: a `std::set` of strings (sorted, unique). */
export function embedRefsOf(gen: JsonObject): string[] {
  const refs = gen['embedrefs'];
  if (!Array.isArray(refs)) return [];
  return [...new Set(refs.filter((r): r is string => typeof r === 'string'))].sort();
}

/** `text`, `interprettext` and `embedrefs` of a stored generator block. */
export function generatorFieldsOf(gen: JsonObject): GeneratorFields {
  const text = gen['text'];
  return {
    text: typeof text === 'string' ? text : '',
    interpretText: gen['interprettext'] === true,
    embedRefs: embedRefsOf(gen),
  };
}

/** The parameter values a module receives (C++ `pushParamsTable`: other JSON types are nil). */
export function paramValuesOf(t: ShapeTemplate): Record<string, number | string | boolean | null> {
  const out: Record<string, number | string | boolean | null> = {};
  for (const p of t.params) {
    const v = p.value;
    out[p.name] = typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : null;
  }
  return out;
}

export class WireframeGenerator extends ShapeGenerator {
  readonly behavior: GeneratorBehavior = 'generateAlways';
  readonly module: WireframeModule;
  private readonly script_: string;
  private readonly apply_: TemplateDataApplier;
  private text_: string;
  private readonly interpretText_: boolean;
  private readonly embedRefs_: readonly string[];
  private minW_ = 0;
  private minH_ = 0;
  private hasOutput_ = false;

  constructor(module: WireframeModule, script: string, fields: GeneratorFields, apply: TemplateDataApplier) {
    super();
    this.module = module;
    this.script_ = script;
    this.apply_ = apply;
    this.text_ = fields.text;
    this.interpretText_ = fields.interpretText;
    this.embedRefs_ = Object.freeze(fields.embedRefs.slice());
  }

  interpretText(): boolean {
    return this.interpretText_;
  }

  interpretedText(): string {
    return this.text_;
  }

  override setInterpretedText(text: string): void {
    this.text_ = text;
  }

  embedReferences(): readonly string[] {
    return this.embedRefs_;
  }

  /** The canonical JS text this generator writes. */
  script(): string {
    return this.script_;
  }

  /** The minimum size of the last successful generation. */
  minSize(): { readonly w: number; readonly h: number } {
    return { w: this.minW_, h: this.minH_ };
  }

  generate(t: ShapeTemplate, ctx: GeneratorContext): void {
    let out;
    try {
      out = this.module.generate({ params: paramValuesOf(t), text: this.text_ }, ctx);
    } catch (err) {
      t.env().warn('generator_failed', {
        templateId: t.templateId,
        message: err instanceof Error ? err.message : typeof err,
      });
      if (!this.hasOutput_) this.apply_(t, outputToTemplateJson(placeholderOutput()));
      return;
    }
    this.apply_(t, outputToTemplateJson(out));
    this.minW_ = out.minW;
    this.minH_ = out.minH;
    if (out.disabled !== undefined) t.getStyle().setDisabled(out.disabled ? 1 : 0);
    this.hasOutput_ = true;
  }

  /** C++ `LuaShapeGenerator::setDimension`: the box is at least the generated minimum size. */
  setDimension(ds: DataStore): void {
    if (this.minH_ > 0 && this.minH_ > ds.height()) ds.setHeight(this.minH_);
    if (this.minW_ > 0 && this.minW_ > ds.width()) ds.setWidth(this.minW_);
  }

  clone(): WireframeGenerator {
    const g = new WireframeGenerator(
      this.module,
      this.script_,
      { text: this.text_, interpretText: this.interpretText_, embedRefs: this.embedRefs_ },
      this.apply_,
    );
    // The clone's template copies the generated members, so it has the same output to keep.
    g.minW_ = this.minW_;
    g.minH_ = this.minH_;
    g.hasOutput_ = this.hasOutput_;
    return g;
  }

  /** C++ `serializeGenerator` for a script generator, with the canonical JS text. */
  toJSON(): JsonObject {
    const out: Record<string, string | boolean | string[]> = {
      script: this.script_,
      text: this.text_,
      interprettext: this.interpretText_,
    };
    if (this.embedRefs_.length > 0) out['embedrefs'] = this.embedRefs_.slice();
    return out;
  }
}
