// `LuaToJsConverter` (spec 02 §7.2; spec 04 calls it `GeneratorResolver`): classifies a template's
// `generator` block, replaces Lua with the canonical JS text of the module serving the template id,
// and builds the live generator. io/ runs it on every template body it parses (spec 04 §7.1: one
// choke point for documents, realtime frames, arrowheads, stencils, user libraries and paste).
//
// Classification, in order (spec 04 §7.2):
//   1. no `generator` object: no generator;
//   2. `type: "native"`: a known `shape` is native, anything else unknown (`unknown_native_shape`);
//   3. any other `type` but `"LuaShapeGenerator"`: unknown (`unknown_type`);
//   4. the script form: `s` is a non-empty `script`, else what the `scriptfile` names (the legacy
//      table only proves Lua was meant: dispatch stays by id);
//   5. `s` carries the JS marker: `js` when the id has a module, else unknown (`js_unknown_id`);
//   6. otherwise Lua: when the id has a module it is converted (`script` becomes the canonical
//      text, `scriptfile` and `type` go, `text` / `interprettext` / `embedrefs` stay), else unknown
//      (`lua_unknown_id`).
// There is no hash check: an old version of a known script converts by id. The input is never
// mutated, and the script text is never evaluated (AC-GEN-09).
import type {
  GeneratorRef,
  GeneratorResolution,
  JsonObject,
  JsonValue,
  ShapeGenerator,
  TemplateJson,
  UnknownGeneratorReason,
} from '../template';
import { JS_GENERATOR_MARKER, isJsonObject, stringField } from '../template';
import type { GeneratorRegistry } from './generator-registry';
import { StoredNativeGenerator, UnknownGeneratorPlaceholder } from './placeholder-generators';
import { WireframeGenerator, generatorFieldsOf } from './wireframe-generator';
import type { TemplateDataApplier } from './wireframe-output';

/** What building a generator needs from the codec. */
export interface GeneratorBuildContext {
  /** The whole template body the block was read from (a placeholder keeps it verbatim). */
  readonly template: TemplateJson;
  /** io/'s `parseTemplateData` (spec 01 C5). */
  readonly apply: TemplateDataApplier;
}

const GENERATOR_KEY_ORDER: readonly string[] = Object.freeze(['script', 'text', 'interprettext', 'embedrefs']);

function unknown(reason: UnknownGeneratorReason): GeneratorRef {
  return { kind: 'unknown', key: '', reason };
}

export class LuaToJsConverter {
  readonly registry: GeneratorRegistry;

  constructor(registry: GeneratorRegistry) {
    this.registry = registry;
  }

  /** Steps 2-6 for one stored block of template `templateId` (no conversion). */
  classify(gen: JsonObject, templateId: string): GeneratorRef {
    const type = stringField(gen, 'type');
    if (type === 'native') {
      const shape = stringField(gen, 'shape') ?? '';
      if (this.registry.isNativeShape(shape)) return { kind: 'native', key: shape };
      return unknown('unknown_native_shape');
    }
    if (type !== undefined && type !== 'LuaShapeGenerator') return unknown('unknown_type');
    const script = stringField(gen, 'script') ?? '';
    const key = this.registry.keyById.get(templateId);
    const served = this.registry.wireframe(templateId) !== undefined;
    if (JS_GENERATOR_MARKER.test(script)) {
      return served && key !== undefined ? { kind: 'js', key } : unknown('js_unknown_id');
    }
    return served && key !== undefined ? { kind: 'lua', key } : unknown('lua_unknown_id');
  }

  /** The resolve hook (`GeneratorResolveFn`): classify, and convert known Lua to JS. */
  readonly resolve = (json: TemplateJson): GeneratorResolution => {
    const gen = json['generator'];
    if (!isJsonObject(gen)) return { json, generator: null, converted: false };
    const id = stringField(json, 'id') ?? '';
    const ref = this.classify(gen, id);
    if (ref.kind !== 'lua') return { json, generator: ref, converted: false };
    const text = this.registry.scriptText(ref.key);
    if (text === undefined) return { json, generator: unknown('lua_unknown_id'), converted: false };
    return {
      json: { ...json, generator: convertBlock(gen, text) },
      generator: { kind: 'js', key: ref.key },
      converted: true,
    };
  };

  /** The live generator for a stored block (`ref` from `resolve`); `null` without one. */
  readonly build = (
    gen: JsonObject,
    ref: GeneratorRef | null,
    templateId: string,
    ctx: GeneratorBuildContext,
  ): ShapeGenerator | null => {
    const r = ref ?? this.classify(gen, templateId);
    if (r.kind === 'js' || r.kind === 'lua') {
      const module = this.registry.wireframe(templateId);
      const text = this.registry.scriptText(r.key);
      if (module !== undefined && text !== undefined) {
        return new WireframeGenerator(module, text, generatorFieldsOf(gen), ctx.apply);
      }
      return new UnknownGeneratorPlaceholder(
        gen,
        ctx.template,
        r.kind === 'js' ? 'js_unknown_id' : 'lua_unknown_id',
        ctx.apply,
      );
    }
    if (r.kind === 'native') {
      const factory = this.registry.nativeByShape.get(r.key);
      return factory !== undefined ? factory(gen) : new StoredNativeGenerator(gen);
    }
    return new UnknownGeneratorPlaceholder(gen, ctx.template, r.reason ?? 'unknown_type', ctx.apply);
  };

  /** A live generator counts as JS-form (the cloud stamp rule, spec 04 §9.2): never a placeholder. */
  readonly isJsForm = (g: ShapeGenerator): boolean => {
    if (g.preserved() !== null || g.behavior !== 'generateAlways') return false;
    const script = g.toJSON()['script'];
    return typeof script === 'string' && JS_GENERATOR_MARKER.test(script);
  };

  /** A stored block counts as JS-form (`FrameStamper`, spec 04 §9.3): the marker under a served id. */
  readonly jsFormTest = (gen: JsonObject, templateId: string): boolean => this.classify(gen, templateId).kind === 'js';
}

/** The converted block: `script` first, the serializer's order, `scriptfile` and `type` gone. */
function convertBlock(gen: JsonObject, script: string): JsonObject {
  const out: Record<string, JsonValue> = { script };
  for (const k of GENERATOR_KEY_ORDER) {
    const v = gen[k];
    if (k !== 'script' && v !== undefined) out[k] = v;
  }
  for (const k of Object.keys(gen)) {
    const v = gen[k];
    if (k === 'scriptfile' || k === 'type' || k in out || v === undefined) continue;
    out[k] = v;
  }
  return out;
}
