// How io/ meets generators/ (spec 04 §7.1: one choke point). Every template body the codec parses
// (document objects, document templates, arrowheads, library items, stencil files, paste) first goes
// through `resolve` (classify, convert Lua to JS), then its `generator` block is built by `build`.
// Both come from a `LuaToJsConverter`; io/ never evaluates `generator.script` (AC-GEN-09).
//
// A session passes its converter (over the runtime's `GeneratorRegistry`). Without one the codec
// uses a converter over the shipped registry; a test may replace any single hook.
import { GeneratorRegistry, LuaToJsConverter, type GeneratorBuildContext } from '../../generators';
import type { GeneratorRef, GeneratorResolveFn, JsonObject, ShapeGenerator } from '../../template';

export interface GeneratorHooks {
  /** Classify and convert one template body before it is parsed. */
  readonly resolve?: GeneratorResolveFn;
  /** The live generator for a body's `generator` block (`null`: the template has none). */
  readonly build?: (
    json: JsonObject,
    ref: GeneratorRef | null,
    templateId: string,
    ctx: GeneratorBuildContext,
  ) => ShapeGenerator | null;
  /**
   * Whether `g` counts as a JS-form generator for the cloud stamp rule (spec 04 §9.2). Placeholders
   * never count (§7.4).
   */
  readonly isJsForm?: (g: ShapeGenerator) => boolean;
  /** Whether a stored block counts as JS-form (`FrameStamper`, spec 04 §9.3). */
  readonly jsFormTest?: (generator: JsonObject, templateId: string) => boolean;
}

/** Every hook present. */
export type CompleteGeneratorHooks = Required<GeneratorHooks>;

/** `h` with each missing hook taken from a converter over `registry` (default: the shipped one). */
export function completeHooks(h: GeneratorHooks | undefined, registry?: GeneratorRegistry): CompleteGeneratorHooks {
  if (h?.resolve !== undefined && h.build !== undefined && h.isJsForm !== undefined && h.jsFormTest !== undefined) {
    return h as CompleteGeneratorHooks;
  }
  const c = new LuaToJsConverter(registry ?? GeneratorRegistry.builtin());
  return {
    resolve: h?.resolve ?? c.resolve,
    build: h?.build ?? c.build,
    isJsForm: h?.isJsForm ?? c.isJsForm,
    jsFormTest: h?.jsFormTest ?? c.jsFormTest,
  };
}

/** The hooks of a converter (what a session passes). */
export function converterHooks(c: LuaToJsConverter): CompleteGeneratorHooks {
  return { resolve: c.resolve, build: c.build, isJsForm: c.isJsForm, jsFormTest: c.jsFormTest };
}
