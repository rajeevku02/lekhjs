// A frozen, already converted, plain-data template definition (spec 04 §3). Built once per JS
// realm from a stencil file or a document; its compiled data expressions are cached on it and
// shared, immutable, by every live template instantiated from it.
import { DataExpressionParser } from '../expr/data-expression-parser';
import type { Expression } from '../expr/expression';
import type { GeneratorRef, GeneratorResolveFn } from '../generator/classify';
import { deepFreeze, isJsonObject, stringField, type JsonObject, type TemplateJson } from '../json';
import type { CompiledData } from '../model/shape-template';

/** Which live class a body instantiates as (C++ `parseShapeTemplate`'s dispatch). */
export type TemplateClass = 'shape' | 'polygon' | 'curve' | 'path' | 'text';

export interface TemplateDef {
  readonly id: string;
  /** The canonical body after Lua → JS conversion; deep-frozen. */
  readonly json: TemplateJson;
  /** The `data` strings the expressions were compiled from (non-strings read as ''). */
  readonly data: readonly string[];
  /** One compiled expression per data string; `null` where it does not parse (DR-GEN-01). */
  readonly compiled: readonly (Expression | null)[];
  readonly klass: TemplateClass;
  readonly generator: GeneratorRef | null;
  /** True when the resolve hook converted the body (a Lua generator became JS). */
  readonly converted: boolean;
  /** The library object this definition came from (its `params`, `name`, …), or `null` for a bare template. */
  readonly object: JsonObject | null;
  /** The body's `help` text ('' for none). */
  readonly help: string;
}

/** Why a body did not become a definition, or a definition has a defect. Content-free. */
export interface CatalogIssue {
  readonly id: string;
  readonly reason: 'not_object' | 'no_id' | 'expression_invalid' | 'unknown_reference';
  /** For `expression_invalid`: the data index. */
  readonly index?: number;
}

/** C++ `parseShapeTemplate`'s class choice: by id for the four basic classes, else `polygon: true`. */
export function templateClassOf(json: TemplateJson): TemplateClass {
  switch (stringField(json, 'id')) {
    case 'avabodh.basic.polygon':
      return 'polygon';
    case 'avabodh.basic.curve':
      return 'curve';
    case 'avabodh.basic.text':
      return 'text';
    case 'avabodh.basic.path':
      return 'path';
  }
  return json['polygon'] === true ? 'polygon' : 'shape';
}

/** A by-reference body: `{ "id": … }` and nothing else (C++ `memberCount() == 1`). */
export function isReferenceOnly(json: TemplateJson): boolean {
  const keys = Object.keys(json);
  return keys.length === 1 && keys[0] === 'id';
}

/** The compiled data of `def`, as a live template reuses it (`ShapeTemplate.useCompiled`). */
export function compiledDataOf(def: TemplateDef): CompiledData {
  return { strs: def.data, exprs: def.compiled };
}

/**
 * Builds a frozen definition from one template body: resolve (classify / convert), compile the
 * data, freeze. Issues are appended to `issues`; `null` when the body cannot be a definition.
 */
export function buildTemplateDef(
  value: unknown,
  resolve: GeneratorResolveFn,
  issues: CatalogIssue[],
  object: JsonObject | null = null,
): TemplateDef | null {
  if (!isJsonObject(value)) {
    issues.push({ id: '', reason: 'not_object' });
    return null;
  }
  const id = stringField(value, 'id');
  if (id === undefined || id === '') {
    issues.push({ id: '', reason: 'no_id' });
    return null;
  }
  const res = resolve(value);
  const json = res.json;
  const rawData = json['data'];
  const data = Array.isArray(rawData) ? rawData.map((d) => (typeof d === 'string' ? d : '')) : [];
  const parser = new DataExpressionParser();
  const compiled = data.map((s) => parser.compile(s));
  compiled.forEach((e, index) => {
    if (e === null) issues.push({ id, reason: 'expression_invalid', index });
  });
  const def: TemplateDef = {
    id,
    json,
    data,
    compiled,
    klass: templateClassOf(json),
    generator: res.generator,
    converted: res.converted,
    object,
    help: stringField(json, 'help') ?? '',
  };
  return deepFreeze(def);
}
