// The oracle's case grid (spec 04 §13): for each generator template of `v4/wireframe.json`, its
// default parameters with each parameter varied one at a time over its values, each crossed with
// the template's default text and a fixed set of texts (empty, malformed, multi-line, markup).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { JsonObject, JsonValue } from '../../../src/template';
import { STENCILS_V4 } from './lua-oracle';

export type Params = Readonly<Record<string, number | string | boolean | null>>;

export interface OracleCase {
  readonly templateId: string;
  readonly params: Params;
  readonly text: string;
  /** A short label: which parameter was varied, and the text index. */
  readonly label: string;
}

/** The texts every template is run with, besides its own default. */
export const TEXTS: readonly string[] = Object.freeze([
  '',
  'A',
  'Hello world',
  'line one\nline two\nline three',
  '*Selected\n-Disabled\n*-Both\n\\*Escaped',
  '[icon_star] Start icon, end text\nEnd icon [icon_check]\nPlain, with, commas',
  'a\\nb, c\\\\d',
  '  indented\n    more\n back',
  '2022/13/45',
  'x,y,z\r\nCRLF line',
  '{10c, 20r, 30} col A, col B\nr1a, r1b\n# note',
  'é ünïcode 漢字',
]);

/** A sample icon id for an icon-valued parameter. */
const ICON = 'avabodh.wireframe.icon_check';

/** Every generator template body of the `v4` wireframe set, by id. */
export function wireframeTemplates(): ReadonlyMap<string, JsonObject> {
  const file = JSON.parse(readFileSync(path.join(STENCILS_V4, 'wireframe.json'), 'utf8')) as JsonValue;
  const out = new Map<string, JsonObject>();
  const visit = (v: JsonValue | undefined): void => {
    if (Array.isArray(v)) for (const x of v as JsonValue[]) visit(x);
    else if (v !== null && typeof v === 'object') {
      const o = v as JsonObject;
      if (typeof o['id'] === 'string' && o['generator'] !== undefined && !out.has(o['id'])) out.set(o['id'], o);
      for (const k of Object.keys(o)) visit(o[k]);
    }
  };
  visit(file);
  return out;
}

type Value = number | string | boolean | null;

function asValue(v: JsonValue | undefined): Value {
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : null;
}

/** A parameter's default and the values it is varied over. */
function paramValues(decl: JsonValue | undefined): { value: Value; values: Value[] } {
  if (decl === null || typeof decl !== 'object' || Array.isArray(decl)) {
    const value = asValue(decl);
    return { value, values: typeof value === 'boolean' ? [true, false] : [value] };
  }
  const o = decl as JsonObject;
  const value = asValue(o['value']);
  const ed = (o['editor'] ?? {}) as JsonObject;
  const values: Value[] = [value];
  const options = ed['options'];
  if (Array.isArray(options)) for (const x of options as JsonValue[]) values.push(asValue(x));
  if (typeof ed['optional'] === 'string') values.push(null);
  if (typeof ed['min'] === 'number') values.push(ed['min']);
  if (typeof ed['max'] === 'number') values.push(ed['max']);
  if (typeof value === 'boolean') values.push(!value);
  if (value === null && !Array.isArray(options)) values.push(ICON, '');
  return { value, values: [...new Set(values)] };
}

/** The cases for one template id. */
export function casesFor(templateId: string, body: JsonObject): OracleCase[] {
  const decls = (body['params'] ?? {}) as JsonObject;
  const base: Record<string, Value> = {};
  const vary: [string, Value[]][] = [];
  for (const name of Object.keys(decls)) {
    const { value, values } = paramValues(decls[name]);
    base[name] = value;
    vary.push([name, values.filter((v) => v !== value)]);
  }
  const gen = (body['generator'] ?? {}) as JsonObject;
  const texts = [typeof gen['text'] === 'string' ? gen['text'] : '', ...TEXTS];
  const out: OracleCase[] = [];
  const add = (params: Params, label: string) => {
    texts.forEach((text, i) => {
      out.push({ templateId, params, text, label: `${label} text#${String(i)}` });
    });
  };
  add(base, 'defaults');
  for (const [name, values] of vary) {
    for (const v of values) add({ ...base, [name]: v }, `${name}=${JSON.stringify(v)}`);
  }
  return out;
}
