// The register's board fixtures of model/ and template/ (AC-ROL-14; parity/fixtures/DR-*/): each
// synthetic board is read by lekhjs here and the entry's query or edit is run on it, showing the TS
// side; register:check --oracles and T6 load the same boards in the Node oracle. The detached unit
// cases (hit-tester, templated-object, connection, shape-template tests) stay as the evidence.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Point, Rect } from '../../src/geometry';
import type { ConnectionObject } from '../../src/model';
import { TemplatedObject, modificationContext } from '../../src/model';
import { Length, Unit } from '../../src/style';
import type { JsonObject } from '../../src/template';
import { testIo } from '../io/helpers';
import { PKG_ROOT } from '../lint/eslint-helpers';

const board = (rel: string) => readFileSync(path.join(PKG_ROOT, 'parity', 'fixtures', rel), 'utf8');
const load = (rel: string) => {
  const io = testIo();
  const doc = io.codec.read(board(rel)).doc;
  const store = doc.activePage().objectStore;
  store.flushLayout();
  const byId = (id: string) => {
    const o = store.objects.find((x) => x.id === id);
    if (o === undefined) throw new Error(`no ${id}`);
    return o;
  };
  return { io, doc, store, byId };
};
const objectsOf = (json: JsonObject) =>
  ((json['pages'] as Record<string, JsonObject>)['p1']?.['objects'] ?? {}) as Record<string, JsonObject>;

describe('model register board fixtures', () => {
  it('DR-ENG-08: an erase batch lists near objects in store order, then their connectors (erase-batch.lekh)', () => {
    const { store, byId } = load('DR-ENG-08/erase-batch.lekh');
    const [a, c] = [byId('a'), byId('c')];
    expect(store.hit.erasableAt(new Point(52, 45))).toEqual([a, c]);
    expect(store.hit.erasableAt(new Point(52, 45))).toEqual(store.hit.erasableAt(new Point(52, 45)));
  });

  it('DR-ENG-09: equal-distance alignment candidates snap to the first in store order (alignment-tie.lekh)', () => {
    const { io, store, byId } = load('DR-ENG-09/alignment-tie.lekh');
    const m = byId('n3') as TemplatedObject;
    const ctx = () => modificationContext(io.env.objects, store, new Length(8, Unit.Point));
    m.startModification(ctx());
    m.translate(-400, 0); // centre x 100: 4 from both candidates (96 and 104)
    const x = m.getCenter().x;
    expect(x).toBe(101);
    m.startModification(ctx());
    m.translate(0, 0);
    expect(m.getCenter().x).toBe(x);
  });

  it("DR-ENG-17: page bounds include the first object's stroke (first-stroke-bounds.lekh)", () => {
    const { store } = load('DR-ENG-17/first-stroke-bounds.lekh');
    // n1 (0..50, stroke 8) grows 2 per side (inflate(8 / 2), as boundsOfAll's unit case); n2
    // (100..150) has no stroke. C++ seeded the union with n1's unstroked rect: (0, 0, 150, 150).
    expect(store.hit.boundsOfAll()).toEqual(new Rect(-2, -2, 152, 152));
  });

  it('DR-ENG-18: reading a connector does not re-route it or rewrite its stored route (stale-auto-route.lekh)', () => {
    const { io, doc, byId } = load('DR-ENG-18/stale-auto-route.lekh');
    const c = byId('c') as ConnectionObject;
    const before = JSON.stringify(c.getParams());
    c.selectionRect();
    expect(JSON.stringify(c.getParams())).toBe(before);
    const written = objectsOf(io.codec.write(doc, { stamp: 'offline' }).json)['c']?.['params'];
    expect(JSON.stringify(written)).toBe(JSON.stringify(c.getParams()));
  });

  it('DR-ENG-20: an orthogonal connector with no stored segments has empty params (orthogonal-no-segments.lekh)', () => {
    const { io, doc, byId } = load('DR-ENG-20/orthogonal-no-segments.lekh');
    expect((byId('c') as ConnectionObject).getParams()).toEqual([]);
    expect(objectsOf(io.codec.write(doc, { stamp: 'offline' }).json)['c']?.['params']).toEqual([]);
  });

  it('DR-ENG-21: the connections of a group include an edge attached to the group itself (group-edge.lekh)', () => {
    const { store, byId } = load('DR-ENG-21/group-edge.lekh');
    expect(store.connectionsOf(byId('g')).map((o) => o.id)).toEqual(['c1', 'c2']);
  });

  it('DR-GEN-01: a data expression that does not parse evaluates to 0 and the shape loads (unparsable-expression.lekh)', () => {
    const { io, byId } = load('DR-GEN-01/unparsable-expression.lekh');
    expect(byId('n1')).toBeInstanceOf(TemplatedObject);
    const warnings = (io.env.templates as unknown as { warnings: { code: string; details: object }[] }).warnings;
    expect(warnings).toContainEqual({ code: 'expression_invalid', details: { templateId: 'sample.test', index: 2 } });
  });

  it('DR-GEN-12: an unknown native generator is kept and written back (unknown-native.lekh)', () => {
    const { io, doc } = load('DR-GEN-12/unknown-native.lekh');
    const t = objectsOf(io.codec.write(doc, { stamp: 'offline' }).json)['n1']?.['template'] as JsonObject;
    expect(t['generator']).toEqual({ type: 'native', shape: 'sample.future', text: 'Button' });
  });

  it('DR-GEN-13 (withdrawn): Lua wireframe data numbers are written as Lua printed them (lua-data-numbers.lekh)', () => {
    const { io, doc } = load('DR-GEN-13/lua-data-numbers.lekh');
    const t = objectsOf(io.codec.write(doc, { stamp: 'offline' }).json)['n1']?.['template'] as JsonObject;
    const data = (t['data'] ?? []) as string[];
    expect(data.length).toBeGreaterThan(0);
    for (const s of data) expect(s).not.toMatch(/\d\.\d{15,}/);
  });
});
