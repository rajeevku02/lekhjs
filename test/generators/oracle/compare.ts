// The structural comparison of a Lua script's output with its TS port's (spec 04 §13): entries in
// order; draw paths, locations and index lists by token; styles and other members by value; and
// the data expressions by evaluating them, in order, on a grid of boxes with a 1e-6 tolerance (the
// text differs by design: Lua's `%.14g` against JS's shortest round trip, DR-GEN-13). `minW`,
// `minH`, `disabled` and `alignpoints` are compared too.
import { Size } from '../../../src/geometry';
import {
  DataExpressionParser,
  DataStore,
  type ExpressionScope,
  type JsonObject,
  type JsonValue,
} from '../../../src/template';

/** The boxes the data is evaluated on. */
export const GRID: readonly (readonly [number, number])[] = Object.freeze([
  [100, 40],
  [240, 160],
  [37, 300],
  [1, 1],
]);

const TOL = 1e-6;

export interface Comparable {
  readonly template: JsonObject;
  readonly minW: number;
  readonly minH: number;
  readonly disabled?: boolean;
}

function list(v: JsonValue | undefined): JsonValue[] {
  return Array.isArray(v) ? (v as JsonValue[]).slice() : [];
}

function tokens(v: JsonValue | undefined): string {
  return typeof v === 'string' ? v.trim().split(/\s+/).join(' ') : JSON.stringify(v ?? null);
}

function near(a: number, b: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === b) return true;
  return Math.abs(a - b) <= TOL * Math.max(1, Math.abs(a), Math.abs(b));
}

function stable(v: JsonValue | undefined): string {
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `[${(v as JsonValue[]).map(stable).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, JsonValue>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${k}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** A draw / text / image / embed entry as a comparable string (strings → `{path}` as C++ read them). */
function entryKey(kind: 'draw' | 'texts' | 'images' | 'embeds', v: JsonValue): string {
  if (kind === 'draw' && typeof v === 'string') return stable({ path: tokens(v) });
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return stable(v);
  const o = { ...(v as Record<string, JsonValue>) };
  if (kind === 'draw' && 'path' in o) o['path'] = tokens(o['path']);
  if ('location' in o) o['location'] = tokens(o['location']);
  if (kind === 'embeds') {
    if (o['inheritstyle'] === undefined) o['inheritstyle'] = true;
    if (o['param'] === '') delete o['param'];
    if (o['mode'] === '') delete o['mode'];
  }
  return stable(o);
}

/** Evaluates `data` in order for a `w × h` box (`tw`/`th` measure text slot i with `measure`). */
export function evaluate(
  data: readonly string[],
  w: number,
  h: number,
  params: Readonly<Record<string, number | string | boolean | null>>,
  texts: readonly string[],
  measure: (s: string) => { w: number; h: number },
): number[] {
  const parser = new DataExpressionParser();
  const ds = new DataStore();
  ds.setWidth(w);
  ds.setHeight(h);
  ds.values = [];
  const scope: ExpressionScope = {
    paramValue: (name) => {
      const v = params[name];
      return typeof v === 'number' ? v : undefined;
    },
    textSize: (i) => {
      const t = texts[i];
      if (t === undefined) return null;
      const m = measure(t);
      return new Size(m.w, m.h);
    },
    strokeWidth: () => 1,
  };
  for (const s of data) {
    const e = parser.compile(s);
    ds.values.push(e === null ? Number.NaN : e.value(ds, scope));
  }
  return ds.values;
}

/** The differences between the Lua result and the TS result (empty when they match). */
export function compareOutputs(
  lua: Comparable,
  ts: Comparable,
  params: Readonly<Record<string, number | string | boolean | null>>,
  measure: (s: string) => { w: number; h: number },
): string[] {
  const diffs: string[] = [];
  const lt = lua.template;
  const tt = ts.template;
  const ldata = list(lt['data']).map((d) => (typeof d === 'string' ? d : ''));
  const tdata = list(tt['data']).map((d) => (typeof d === 'string' ? d : ''));
  if (ldata.length !== tdata.length) diffs.push(`data: ${String(ldata.length)} entries vs ${String(tdata.length)}`);
  const textsOf = (t: JsonObject) =>
    list(t['texts']).map((x) =>
      x !== null && typeof x === 'object' && !Array.isArray(x) && typeof (x as JsonObject)['text'] === 'string'
        ? ((x as JsonObject)['text'] as string)
        : '',
    );
  if (diffs.length === 0) {
    for (const [w, h] of GRID) {
      const a = evaluate(ldata, w, h, params, textsOf(lt), measure);
      const b = evaluate(tdata, w, h, params, textsOf(tt), measure);
      const bad = a.findIndex((v, i) => !near(v, b[i] ?? Number.NaN));
      if (bad >= 0) {
        diffs.push(
          `data[${String(bad)}] at ${String(w)}x${String(h)}: ${String(a[bad])} (${ldata[bad] ?? ''}) vs ${String(b[bad])} (${tdata[bad] ?? ''})`,
        );
        break;
      }
    }
  }
  for (const kind of ['draw', 'texts', 'images', 'embeds'] as const) {
    const a = list(lt[kind]).map((v) => entryKey(kind, v));
    const b = list(tt[kind]).map((v) => entryKey(kind, v));
    if (a.length !== b.length) {
      diffs.push(`${kind}: ${String(a.length)} entries vs ${String(b.length)}`);
      continue;
    }
    a.forEach((x, i) => {
      if (x !== b[i]) diffs.push(`${kind}[${String(i)}]: ${x} vs ${b[i] ?? ''}`);
    });
  }
  const lc = list(lt['containers']).map(tokens);
  const tc = list(tt['containers']).map(tokens);
  if (stable(lc) !== stable(tc)) diffs.push(`containers: ${stable(lc)} vs ${stable(tc)}`);
  // `alignpoints` (tabs, vtabs): parseTemplateData reads it from the script's JSON.
  if (tokens(lt['alignpoints']) !== tokens(tt['alignpoints'])) {
    diffs.push(`alignpoints: ${tokens(lt['alignpoints'])} vs ${tokens(tt['alignpoints'])}`);
  }
  if (!near(lua.minW, ts.minW)) diffs.push(`minW: ${String(lua.minW)} vs ${String(ts.minW)}`);
  if (!near(lua.minH, ts.minH)) diffs.push(`minH: ${String(lua.minH)} vs ${String(ts.minH)}`);
  if ((lua.disabled ?? null) !== (ts.disabled ?? null)) {
    diffs.push(`disabled: ${String(lua.disabled)} vs ${String(ts.disabled)}`);
  }
  return diffs;
}
