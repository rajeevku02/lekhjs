// The difference-register fixtures of io/ (spec 03 §16; parity/register/DR-ENG-*.yaml): one
// minimal synthetic case per entry, showing the TS behaviour. B13 (DR-ENG-04), B14 (DR-ENG-19),
// B18d (DR-ENG-02) and B18e (DR-ENG-07) are the io/ bug fixes of spec 03 §15.
import { describe, expect, it } from 'vitest';
import type { TemplatedObject } from '../../src/model';
import type { JsonObject } from '../../src/template';
import { testIo } from './helpers';

const info = { version: '4.2', title: 't' };
const box = (order: number, template: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: 'templated',
  order,
  params: { cx: 0, cy: 0, width: 40, height: 20, angle: 0 },
  template: { data: ['-w/2', '-h/2', 'w/2', 'h/2', '0'], draw: ['M 0 1 L 2 3'], ...template },
  ...extra,
});
const page = (objects: unknown) => ({ info, pages: { p: { name: 'P', order: 1, objects } } });

describe('DR-ENG-01: \\u escapes load (C++ failed the load)', () => {
  it('a text with \\u escapes loads', () => {
    const text = JSON.stringify(
      page({ a: box(1, { id: 'x', texts: [{ location: '0 1 2 3 4', text: 'TEXT' }] }) }),
    ).replace('TEXT', '\\u00e9t\\u00e9');
    const o = testIo().codec.read(text).doc.activePage().objectStore.objects[0] as TemplatedObject;
    expect(o.shapeTemplate()?.textData[0]?.text).toBe('été');
  });
});

describe('DR-ENG-02 (B18d): a duplicated key — the last value wins, nothing leaks', () => {
  it('JSON.parse semantics on the fast path and in the lenient fallback', () => {
    const base = JSON.stringify(page({ a: box(1, { id: 'x' }) }));
    const dup = base.replace('"cx":0', '"cx":10,"cx":20');
    const read = (t: string) =>
      (testIo().codec.read(t).doc.activePage().objectStore.objects[0] as TemplatedObject).ds.cx();
    expect(read(dup)).toBe(20);
    // The same with a `nan` elsewhere, so the lenient reader parses it.
    expect(read(dup.replace('"cy":0', '"cy":nan'))).toBe(20);
  });
});

describe('DR-ENG-03: an integer member written as 2.0 reads as 2 (C++: absent)', () => {
  it('order, index, flags and colours accept integer-valued numbers', () => {
    const text = JSON.stringify(page({ a: box(1, { id: 'x' }) }))
      .replace('"order":1,"params"', '"order":2.0,"params"')
      .replace('"id":"x"', '"id":"x","flags":7.0');
    const o = testIo().codec.read(text).doc.activePage().objectStore.objects[0] as TemplatedObject;
    expect(o.order).toBe(2);
    expect(o.shapeTemplate()?.getFlags()).toBe(7);
  });

  it('a fractional value is still not an integer', () => {
    const text = JSON.stringify(page({ a: box(1, { id: 'x', flags: 7.5 }) }));
    const o = testIo().codec.read(text).doc.activePage().objectStore.objects[0] as TemplatedObject;
    expect(o.shapeTemplate()?.getFlags()).toBe(0);
  });
});

describe('DR-ENG-04 (B13): integers are not truncated to 32 bits; colours stay signed 32-bit', () => {
  it('a large order keeps its value', () => {
    const big = 2 ** 40 + 3;
    const io = testIo();
    const doc = io.codec.read(JSON.stringify(page({ a: box(big, { id: 'x' }), b: box(5, { id: 'x' }) }))).doc;
    const objs = doc.activePage().objectStore.objects;
    expect(objs.map((o) => o.order)).toEqual([5, big]);
    const out = io.codec.write(doc, { stamp: 'offline' }).json;
    const written = (out['pages'] as Record<string, JsonObject>)['p']?.['objects'] as Record<string, JsonObject>;
    expect(written['a']?.['order']).toBe(big);
  });

  it('a colour written unsigned reads as its signed 32-bit value', () => {
    const style = { strokepaint: { type: 2, color: 4294901760 } };
    const io = testIo();
    const o = io.codec.read(JSON.stringify(page({ a: box(1, { id: 'x', style }) }))).doc.activePage().objectStore
      .objects[0] as TemplatedObject;
    const c = o.getDrawingProfile().effectiveStrokePaint().solidColor;
    expect([c.alpha, c.red, c.green, c.blue]).toEqual([255, 255, 0, 0]);
    expect(c.toInt()).toBe(4294901760 | 0);
  });
});

describe('DR-ENG-06: non-finite numbers are written as 0', () => {
  it('NaN and Infinity in geometry write as 0 and the text is valid JSON', () => {
    const io = testIo();
    const doc = io.codec.read(JSON.stringify(page({ a: box(1, { id: 'x' }) }))).doc;
    const o = doc.activePage().objectStore.objects[0] as TemplatedObject;
    o.ds.setCy(NaN);
    o.ds.setCx(-Infinity);
    const out = io.codec.write(doc, { stamp: 'offline' });
    const params = (JSON.parse(out.text) as { pages: { p: { objects: { a: { params: JsonObject } } } } }).pages.p
      .objects.a.params;
    expect([params['cx'], params['cy']]).toEqual([0, 0]);
    expect(out.nonFinite).toBe(2);
  });
});

describe('DR-ENG-07 (B18e): object keys are escaped on write', () => {
  it('an id with a quote and a backslash writes as valid JSON and reads back the same', () => {
    const id = 'a"b\\c';
    const io = testIo();
    const doc = io.codec.read(JSON.stringify(page({ [id]: box(1, { id: 'x' }) }))).doc;
    const text = io.codec.write(doc, { stamp: 'offline' }).text;
    expect(text).toContain('"a\\"b\\\\c":');
    const back = testIo().codec.read(text).doc.activePage().objectStore.objects[0];
    expect(back?.id).toBe(id);
  });
});

describe('DR-ENG-19 (B14): colliding embed and help ids are written deterministically', () => {
  // `a.b_c` and `a_b.c` both write under `a_b_c`; sorted by UTF-8 bytes, `a.b_c` ('.' < '_') wins.
  const embedder = (order: number, embedId: string) =>
    box(order, { id: `host.${String(order)}`, embeds: [{ name: embedId, location: '0 1 2 3 4' }] });
  const defs = {
    one: { id: 'a.b_c', data: ['0', '0'], draw: ['M 0 1'], default: { width: 11, height: 11, angle: 0 } },
    two: { id: 'a_b.c', data: ['0', '0'], draw: ['M 0 1'], default: { width: 22, height: 22, angle: 0 } },
  };

  it.each([
    ['a_b.c first', ['a_b.c', 'a.b_c']],
    ['a.b_c first', ['a.b_c', 'a_b.c']],
  ])('embeds: the first id in byte order wins (%s on the page)', (_name, order) => {
    const io = testIo();
    const doc = io.codec.read(
      JSON.stringify({
        ...page({ x: embedder(1, order[0] as string), y: embedder(2, order[1] as string) }),
        templates: defs,
      }),
    ).doc;
    const out = io.codec.write(doc, { stamp: 'offline' }).json;
    const templates = out['templates'] as Record<string, JsonObject>;
    expect(Object.keys(templates)).toEqual(['a_b_c']);
    expect(templates['a_b_c']?.['id']).toBe('a.b_c');
  });

  it('help: the first id in byte order wins', () => {
    const io = testIo();
    const doc = io.codec.read(JSON.stringify(page({ x: box(1, { id: 'h_i.j' }), y: box(2, { id: 'h.i_j' }) }))).doc;
    const out = io.codec.write(doc, { stamp: 'offline', help: (tid) => `help for ${tid}` }).json;
    expect(out['help']).toEqual({ h_i_j: { id: 'h.i_j', text: 'help for h.i_j' } });
  });
});
