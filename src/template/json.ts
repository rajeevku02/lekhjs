// The JSON shapes the template module reads: a template body (`TemplateJson`, the members of a
// stencil `templates[]` entry or an object's inline `template`), a stencil library file, and the
// recursive freeze the catalog applies to everything it shares (AC-GEN-03).
//
// Parsing a template body into a live `ShapeTemplate` is `io/TemplateDataCodec`'s job (spec 02
// §9); this module reads only what the catalog needs: the id, the class, the data strings, the
// generator block and the help text.

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** A template body as stored (`/frontend/shared/stencil-format.md`). Every member but `id` is optional. */
export type TemplateJson = JsonObject;

/** One `library[]` entry of a stencil file: a category and its objects (template ids or object JSON). */
export interface LibraryCategoryJson {
  readonly id?: string;
  readonly name?: string;
  readonly group?: string;
  readonly category?: string;
  readonly objects?: readonly JsonValue[];
}

/** A stencil library file (C++ `LibraryObjectStore::initObjects`): templates, arrowheads, categories. */
export interface LibraryFileJson {
  readonly templates?: readonly JsonValue[];
  readonly arrows?: readonly JsonValue[];
  readonly library?: readonly LibraryCategoryJson[];
}

export function isJsonObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The string member `key`, or `undefined` when absent or not a string. */
export function stringField(o: JsonObject, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' ? v : undefined;
}

/** `value` and everything reachable from it frozen (arrays, plain objects and class instances). */
export function deepFreeze<T>(value: T): T {
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v !== 'object' || v === null || seen.has(v)) continue;
    seen.add(v);
    for (const key of Reflect.ownKeys(v)) stack.push(Reflect.get(v, key));
    Object.freeze(v);
  }
  return value;
}

/** A deep copy of a JSON value (structurally; the copy is unfrozen). */
export function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
