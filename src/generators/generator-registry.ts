// `GeneratorRegistry` (spec 04 §5.2; spec 02 §7.2): the immutable map from `template.id` to the
// wireframe module that serves it, from a native `shape` to its generator, and from a module key
// to its canonical JS text (`GeneratorScriptTable`, built from `scripts.generated.json`).
//
// Dispatch is by template id only: the script text is never consulted to choose code and never
// evaluated (AC-GEN-09). One registry hangs off each `Runtime` (no module state); build the shipped
// one with `GeneratorRegistry.builtin()`, or a test one with `new GeneratorRegistry({...})`.
import type { JsonObject, ShapeGenerator, WireframeKey, WireframeModule } from '../template';
import scriptsJson from './scripts.generated.json' with { type: 'json' };
import { NATIVE_GENERATORS } from './native';
import { WIREFRAME_MODULES } from './wireframe';
import { NATIVE_SHAPES, UNUSED_SCRIPTFILE, WIREFRAME_TEMPLATES, type WireframeTemplateRow } from './wireframe-ids';

/** Builds a native generator from its stored block. */
export type NativeGeneratorFactory = (generator: JsonObject) => ShapeGenerator;

/** `module key → canonical JS text`, read-only (spec 02 `GeneratorScriptTable`). */
export class GeneratorScriptTable {
  private readonly texts_: ReadonlyMap<string, string>;

  constructor(texts: Readonly<Record<string, string>>) {
    this.texts_ = new Map(Object.entries(texts));
    Object.freeze(this);
  }

  /** The shipped table (`scripts.generated.json`). */
  static builtin(): GeneratorScriptTable {
    return new GeneratorScriptTable(scriptsJson);
  }

  get(key: string): string | undefined {
    return this.texts_.get(key);
  }

  keys(): readonly string[] {
    return [...this.texts_.keys()];
  }
}

export interface GeneratorRegistryOptions {
  /** The wireframe modules; default the ported ones. */
  readonly modules?: readonly WireframeModule[];
  /** Native factories by `shape`. Default: the seven ports (`NATIVE_GENERATORS`, spec 04 §6). */
  readonly natives?: Readonly<Record<string, NativeGeneratorFactory>>;
  /** The canonical texts; default `scripts.generated.json`. */
  readonly scripts?: GeneratorScriptTable;
  /** The id → module-key rows; default the 34 of spec 04 §5.3. */
  readonly templates?: readonly WireframeTemplateRow[];
}

export class GeneratorRegistry {
  /** `template.id` → module, for every row whose module is ported and has its canonical text. */
  readonly wireframeById: ReadonlyMap<string, WireframeModule>;
  /** Native `shape` → factory. */
  readonly nativeByShape: ReadonlyMap<string, NativeGeneratorFactory>;
  readonly scripts: GeneratorScriptTable;
  /** Every generator template id the stencils know (ported or not), → its module key. */
  readonly keyById: ReadonlyMap<string, WireframeKey>;
  private readonly legacyScriptfiles_: ReadonlyMap<string, WireframeKey | null>;

  constructor(opts: GeneratorRegistryOptions = {}) {
    const modules = new Map<string, WireframeModule>();
    for (const m of opts.modules ?? WIREFRAME_MODULES) modules.set(m.key, m);
    this.scripts = opts.scripts ?? GeneratorScriptTable.builtin();
    const rows = opts.templates ?? WIREFRAME_TEMPLATES;
    const byId = new Map<string, WireframeModule>();
    const keyById = new Map<string, WireframeKey>();
    const legacy = new Map<string, WireframeKey | null>([[UNUSED_SCRIPTFILE, null]]);
    for (const r of rows) {
      keyById.set(r.id, r.key);
      legacy.set(r.scriptfile, r.key);
      const m = modules.get(r.key);
      if (m !== undefined && this.scripts.get(r.key) !== undefined) byId.set(r.id, m);
    }
    this.wireframeById = byId;
    this.keyById = keyById;
    this.legacyScriptfiles_ = legacy;
    this.nativeByShape = new Map(Object.entries(opts.natives ?? NATIVE_GENERATORS));
    Object.freeze(this);
  }

  /** The shipped registry: the ported modules, the native generators and their texts. */
  static builtin(): GeneratorRegistry {
    return new GeneratorRegistry();
  }

  /** The module serving `templateId`, if it is ported. */
  wireframe(templateId: string): WireframeModule | undefined {
    return this.wireframeById.get(templateId);
  }

  /** The canonical JS text of a module key. */
  scriptText(key: string): string | undefined {
    return this.scripts.get(key);
  }

  /** Whether `shape` is one of the seven native generators C++ had. */
  isNativeShape(shape: string): boolean {
    return NATIVE_SHAPES.includes(shape);
  }

  /** The legacy table (spec 04 §7.2 step 4): a `scriptfile` → its module key (`null`: the unused stub). */
  scriptfileKey(scriptfile: string): WireframeKey | null | undefined {
    return this.legacyScriptfiles_.get(scriptfile);
  }
}
