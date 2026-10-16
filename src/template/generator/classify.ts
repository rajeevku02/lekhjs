// How a stored `generator` block is classified, and the resolve hook the catalog runs on every
// template it builds (spec 04 §3, §7). The classification is the JSON contract of
// `ShapeGenerator::getGenerator` (`L/shapegen/ShapeGenerator.cpp`):
//   - no `type`, or `type: "LuaShapeGenerator"`: a script generator. Its text is in `script`, or,
//     when `script` is empty, in the resource `scriptfile`. JS text carries the marker
//     `/*lekh-js:1:<key>*/` (spec 04 §5.5); anything else (an empty script included) is Lua;
//   - `type: "native"` with a non-empty `shape`: a native generator;
//   - anything else: unknown (C++ dropped it; TS keeps a placeholder, DR-GEN-12).
// Converting Lua to JS and building the generator are `generators/`' job (`LuaToJsConverter`),
// injected as a `GeneratorResolveFn`; the script text is never evaluated (AC-GEN-09).
import { isJsonObject, stringField, type JsonObject, type TemplateJson } from '../json';

export type GeneratorKind = 'js' | 'lua' | 'native' | 'unknown';

export interface GeneratorRef {
  readonly kind: GeneratorKind;
  /** `js`: the marker key; `native`: the `shape`; `lua`/`unknown`: ''. */
  readonly key: string;
}

/** The marker every JS generator text starts with: `/*lekh-js:1:<key>*\/`. */
export const JS_GENERATOR_MARKER = /^\/\*lekh-js:1:([^*]+)\*\//;

export function classifyGenerator(gen: JsonObject): GeneratorRef {
  const type = stringField(gen, 'type');
  if (type === undefined || type === 'LuaShapeGenerator') {
    const script = stringField(gen, 'script') ?? '';
    const m = JS_GENERATOR_MARKER.exec(script);
    if (m !== null) return { kind: 'js', key: m[1] ?? '' };
    // C++ built a Lua generator here even with no script and no scriptfile.
    return { kind: 'lua', key: '' };
  }
  if (type === 'native') {
    const shape = stringField(gen, 'shape') ?? '';
    if (shape !== '') return { kind: 'native', key: shape };
  }
  return { kind: 'unknown', key: '' };
}

export interface GeneratorResolution {
  /** The template body to keep: converted (Lua → JS) when `converted`, else the input. */
  readonly json: TemplateJson;
  /** The classification of `json.generator` after conversion; `null` without a generator. */
  readonly generator: GeneratorRef | null;
  readonly converted: boolean;
}

/** Classifies (and, in `generators/`, converts) one template body. Must not mutate its input. */
export type GeneratorResolveFn = (json: TemplateJson) => GeneratorResolution;

/** Classification only, no conversion: the resolve hook when `generators/` is not wired in. */
export const classifyOnly: GeneratorResolveFn = (json) => {
  const gen = json['generator'];
  return { json, generator: isJsonObject(gen) ? classifyGenerator(gen) : null, converted: false };
};
