// The native generators against the C++ core (spec 04 §6, task G5): every BPMN and `table-v1`
// stencil template under a grid of parameter values (test/fixtures/native/native-cases.lekh),
// loaded and written by TS, equals what the C++ core wrote for the same board
// (test/fixtures/golden/native, from parity/tools/native-golden/regen.mjs) object by object, and
// the written board carries the same BPMN symbol definitions in `templates`.
//
// Numbers agree to 1e-4 relative, and so do the numbers inside `data` strings (C++ formatted
// `float` arithmetic, TS doubles); everything else is exact, the expression text included.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JsonObject, JsonValue } from '../../src/template';
import { PKG_ROOT } from '../lint/eslint-helpers';
import { testIo } from '../io/helpers';

type Obj = Record<string, JsonValue>;

const BOARD = readFileSync(path.join(PKG_ROOT, 'test', 'fixtures', 'native', 'native-cases.lekh'), 'utf8');
const GOLDEN = JSON.parse(
  readFileSync(path.join(PKG_ROOT, 'test', 'fixtures', 'golden', 'native', 'native-cases.json'), 'utf8'),
) as JsonObject;

const NUM = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g;

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Arrays the C++ writer filled from a `std::set`. */
const SETS = new Set(['embedrefs', 'nonoverridables']);

/** The paths where `a` (TS) and `b` (C++) differ. */
function diff(a: JsonValue | undefined, b: JsonValue | undefined, at: string, out: string[], key = ''): string[] {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!close(a, b)) out.push(`${at}: ${String(a)} != ${String(b)}`);
  } else if (typeof a === 'string' && typeof b === 'string' && (key === 'data' || key === 'location')) {
    const na = (a.match(NUM) ?? []).map(Number);
    const nb = (b.match(NUM) ?? []).map(Number);
    if (a.replace(NUM, '#') !== b.replace(NUM, '#') || na.some((n, i) => !close(n, nb[i] ?? NaN)))
      out.push(`${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    const aa = SETS.has(key) ? [...(a as JsonValue[])].map(String).sort() : (a as JsonValue[]);
    const bb = SETS.has(key) ? [...(b as JsonValue[])].map(String).sort() : (b as JsonValue[]);
    if (aa.length !== bb.length) out.push(`${at}: length ${String(aa.length)} != ${String(bb.length)}`);
    else aa.forEach((x, i) => diff(x, bb[i], `${at}[${String(i)}]`, out, key));
  } else if (
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) out.push(`${at}: keys ${ka.join()} != ${kb.join()}`);
    else for (const k of ka) diff((a as Obj)[k], (b as Obj)[k], `${at}.${k}`, out, k);
  } else if (a !== b) {
    out.push(`${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  }
  return out;
}

function objectsOf(doc: JsonObject): Record<string, Obj> {
  const page = Object.values(doc['pages'] as Record<string, Obj>)[0] as Obj;
  return page['objects'] as Record<string, Obj>;
}

describe('native generators against the C++ core (spec 04 §6)', () => {
  const io = testIo();
  const ts = io.codec.write(io.codec.read(BOARD).doc, { stamp: 'cloud' }).json;
  const tsObjects = objectsOf(ts);
  const cppObjects = objectsOf(GOLDEN);
  const ids = Object.keys(cppObjects).sort();

  it('covers every case and every native shape', () => {
    expect(ids.length).toBeGreaterThan(250);
    expect(Object.keys(tsObjects).sort()).toEqual(ids);
    const shapes = new Set(
      ids.map((id) => ((cppObjects[id]?.['template'] as Obj)['generator'] as Obj)['shape'] as string),
    );
    expect([...shapes].sort()).toEqual([
      'bpmn.activity',
      'bpmn.choreography',
      'bpmn.conversation',
      'bpmn.dataobject',
      'bpmn.event',
      'bpmn.gateway',
      'table-v1',
    ]);
  });

  it.each(ids.map((id) => [cppObjects[id]?.['name'] as string, id]))('%s', (_name, id) => {
    const t = tsObjects[id];
    const c = cppObjects[id];
    expect(diff(t?.['template'], c?.['template'], 'template', [])).toEqual([]);
    expect(diff(t?.['params'], c?.['params'], 'params', [])).toEqual([]);
  });

  it('writes every BPMN symbol definition into doc.templates, as C++ did', () => {
    const tsT = (ts['templates'] ?? {}) as Obj;
    const cppT = (GOLDEN['templates'] ?? {}) as Obj;
    expect(Object.keys(tsT).sort()).toEqual(Object.keys(cppT).sort());
    expect(Object.keys(cppT).length).toBeGreaterThanOrEqual(28);
    for (const k of Object.keys(cppT)) expect(diff(tsT[k], cppT[k], k, [])).toEqual([]);
  });
});
