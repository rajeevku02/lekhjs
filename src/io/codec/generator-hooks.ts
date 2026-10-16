// How io/ meets generators/ (spec 04 §7.1: one choke point). Every template body the codec parses
// (document objects, document templates, arrowheads, library items, stencil files) first goes
// through `resolve` (generators/' `LuaToJsConverter`: classify, convert Lua to JS), then its
// `generator` block is built by `build`. Both are injected; io/ never evaluates `generator.script`
// (AC-GEN-09).
//
// Without `build`, a body's generator becomes a `RawGenerator`: it generates nothing and writes
// its JSON back verbatim, behaving as the C++ class its kind maps to (a script generator
// regenerates always, a native one on parameter change). It is the fallback for a codec that is
// not wired to generators/ (unit tests, tools); sessions always wire it.
import type { DataStore, GeneratorBehavior, GeneratorRef, GeneratorResolveFn, JsonObject } from '../../template';
import { ShapeGenerator, classifyGenerator, classifyOnly, cloneJson, deepFreeze } from '../../template';

export interface GeneratorHooks {
  /** Classify and convert one template body before it is parsed. Default: classification only. */
  readonly resolve?: GeneratorResolveFn;
  /**
   * The live generator for a body's `generator` block (`null`: the template has none, as C++
   * dropped an unknown one). Default: a `RawGenerator`.
   */
  readonly build?: (json: JsonObject, ref: GeneratorRef, templateId: string) => ShapeGenerator | null;
  /**
   * Whether `g` counts as a JS-form generator for the cloud stamp rule (spec 04 §9.2). Placeholders
   * never count (§7.4). Default: the marker test on `g.toJSON().script`.
   */
  readonly isJsForm?: (g: ShapeGenerator) => boolean;
}

/** The resolve hook in effect. */
export function resolveHook(h: GeneratorHooks | undefined): GeneratorResolveFn {
  return h?.resolve ?? classifyOnly;
}

/** Whether `g` is a JS-form generator under `h`. */
export function isJsForm(h: GeneratorHooks | undefined, g: ShapeGenerator): boolean {
  if (h?.isJsForm !== undefined) return h.isJsForm(g);
  return classifyGenerator(g.toJSON()).kind === 'js';
}

/** A generator kept as its stored JSON (see the file comment). */
export class RawGenerator extends ShapeGenerator {
  readonly behavior: GeneratorBehavior;
  private json_: JsonObject;

  constructor(json: JsonObject, ref: GeneratorRef = classifyGenerator(json)) {
    super();
    this.json_ = deepFreeze(cloneJson(json));
    this.behavior = ref.kind === 'native' ? 'onParamChange' : 'generateAlways';
  }

  interpretText(): boolean {
    return this.json_['interprettext'] === true;
  }

  interpretedText(): string {
    const t = this.json_['text'];
    return typeof t === 'string' ? t : '';
  }

  override setInterpretedText(text: string): void {
    this.json_ = deepFreeze({ ...cloneJson(this.json_), text });
  }

  embedReferences(): readonly string[] {
    const refs = this.json_['embedrefs'];
    if (!Array.isArray(refs)) return [];
    return [...new Set(refs.filter((r): r is string => typeof r === 'string'))].sort();
  }

  generate(): void {
    /* a raw generator generates nothing: the stored members are drawn as read */
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the contract's signature
  setDimension(_ds: DataStore): void {
    /* no minimum size */
  }

  clone(): RawGenerator {
    return new RawGenerator(this.json_);
  }

  toJSON(): JsonObject {
    return this.json_;
  }
}

/** The generator for `json` under `h` (see `GeneratorHooks.build`). */
export function buildGenerator(
  h: GeneratorHooks | undefined,
  json: JsonObject,
  ref: GeneratorRef,
  templateId: string,
): ShapeGenerator | null {
  if (h?.build !== undefined) return h.build(json, ref, templateId);
  return new RawGenerator(json, ref);
}
