// The JSON document reader (spec 03 §10.1): the page forms (AC-ENG-34), phantom pages (DR-FMT-01),
// document attributes, templates and help, the object-list forms and the connector fix-up.
import { describe, expect, it } from 'vitest';
import { LoadError } from '../../src/io';
import type { TemplatedObject } from '../../src/model';
import { BackgroundType, CanvasSizeType, ConnectionObject } from '../../src/model';
import { Unit } from '../../src/style';
import { testIo } from './helpers';

const info = { version: '4.2', title: 'T', author: 'A', description: 'D', platform: '2' };
const rect = (order: number, cx = 0, extra: Record<string, unknown> = {}) => ({
  type: 'templated',
  order,
  params: { cx, cy: 0, width: 40, height: 20, angle: 0 },
  template: { id: 'avabodh.basic.rectangle', data: ['-w/2', '-h/2', 'w/2', 'h/2'], draw: ['M 0 1 L 2 3'] },
  ...extra,
});
const read = (doc: unknown) => testIo().codec.read(JSON.stringify(doc));

describe('page forms (AC-ENG-34)', () => {
  it.each([[{}], [[]]])('pages %j loads one empty default page and writes nothing', (pages) => {
    const input = { info, pages };
    const before = JSON.stringify(input);
    const io = testIo();
    const res = io.codec.read(before);
    expect(res.doc.pages).toHaveLength(1);
    expect(res.doc.pages[0]?.name).toBe('Page 1');
    expect(res.doc.pages[0]?.objectStore.objects).toHaveLength(0);
    expect(res.recoveredPages).toEqual([]);
    // Nothing is written back: the input is unchanged and no write was logged.
    expect(JSON.stringify(input)).toBe(before);
    expect(io.logs.filter((l) => l.level !== 'debug')).toEqual([]);
  });

  it('no pages key: the single-page form, top-level objects into one page', () => {
    const res = read({
      info,
      background: { color: -256, grid: true },
      objects: [rect(0, 10), rect(0, 20)],
    });
    expect(res.doc.pages).toHaveLength(1);
    const objs = res.doc.activePage().objectStore.objects;
    expect(objs.map((o) => (o as TemplatedObject).ds.cx())).toEqual([10, 20]);
    // The array form: minted ids, order = index + 1.
    expect(objs.map((o) => o.order)).toEqual([1, 2]);
    expect(new Set(objs.map((o) => o.id)).size).toBe(2);
    expect(res.doc.grid.present).toBe(true);
    expect(res.doc.activePage().background.type).toBe(BackgroundType.Color);
  });

  it('the single-page form needs objects', () => {
    expect(() => read({ info })).toThrow(LoadError);
  });
});

describe('phantom pages (DR-FMT-01)', () => {
  it('a page holding only objects is kept as "Recovered", after the real pages, in key order', () => {
    const res = read({
      info,
      pages: {
        zz: { objects: { b: rect(5) } },
        real: { name: 'Real', order: 7, objects: {} },
        aa: { objects: { a: rect(5) } },
      },
    });
    expect(res.doc.pages.map((p) => p.name)).toEqual(['Real', 'Recovered', 'Recovered 2']);
    expect(res.doc.pages.map((p) => p.id)).toEqual(['real', 'aa', 'zz']);
    expect(res.recoveredPages).toEqual(['aa', 'zz']);
    expect(res.doc.pages[1]?.objectStore.objects).toHaveLength(1);
  });
});

describe('document attributes, page attributes, templates and help', () => {
  it('reads info, attributes and the page fields', () => {
    const res = read({
      info,
      attributes: { grid: { present: false }, scaling: { unit: 'inch', scale: 2 } },
      pages: {
        p: {
          name: 'P',
          order: 3,
          canvassizetype: 'fixed',
          canvasname: 'Letter',
          size: { width: 8.5, height: 11, unit: 'inch' },
          margin: { width: 0.5, height: 0.75, unit: 'inch' },
          background: { color: -16777216 },
          objects: {},
        },
        q: { name: 'Q', order: 1, size: { width: 0, height: 0 }, canvassizetype: 'fixed', objects: {} },
      },
    });
    const d = res.doc;
    expect([d.info.title, d.info.author, d.info.description, d.info.createdOnPlatform]).toEqual(['T', 'A', 'D', '2']);
    expect(d.grid.present).toBe(false);
    expect([d.scaling.unit, d.scaling.value]).toEqual([Unit.Inch, 2]);
    expect(d.pages.map((p) => p.id)).toEqual(['q', 'p']);
    const p = d.getPage('p');
    expect(p?.canvasSizeType).toBe(CanvasSizeType.Fixed);
    expect([p?.size.width, p?.size.height, p?.size.unit]).toEqual([8.5, 11, Unit.Inch]);
    expect(p?.margin.show).toBe(true);
    // As C++: a black background reads as none (OQ-13).
    expect(p?.background.type).toBe(BackgroundType.Default);
    // A zero size makes a fixed page auto.
    expect(d.getPage('q')?.canvasSizeType).toBe(CanvasSizeType.Auto);
  });

  it('document templates (map or list) become definitions embeds resolve against', () => {
    const body = { id: 'my.box', data: ['-w/2', '-h/2', 'w/2', 'h/2'], draw: ['M 0 1 L 2 3'] };
    for (const templates of [{ my_box: body }, [body]]) {
      const res = read({ info, templates, pages: { p: { name: 'P', order: 1, objects: {} } } });
      expect(res.doc.get('my.box')?.json['draw']).toEqual(['M 0 1 L 2 3']);
    }
    // A reference to a template the catalog does not have is skipped, as C++.
    const res = read({ info, templates: [{ id: 'nope.nothing' }], pages: {} });
    expect(res.doc.hasTemplate('nope.nothing')).toBe(false);
    expect(res.warnings).toContainEqual({ code: 'template_skipped', count: 1 });
  });

  it('help, in both forms, is reported and handed to the session', () => {
    const io = testIo();
    const res = io.codec.read(
      JSON.stringify({ info, help: { a_b: { id: 'a.b', text: 'help A' }, 'c.d': 'help C' }, pages: {} }),
    );
    expect([...res.help]).toEqual([
      ['a.b', 'help A'],
      ['c.d', 'help C'],
    ]);
    expect(io.env.help?.('a.b')).toBe('help A');
  });

  it('a malformed root style fails the load; an object that does not parse fails the load', () => {
    expect(() => read({ info, style: { dasharray: 'x' }, pages: {} })).toThrow(LoadError);
    expect(() =>
      read({ info, pages: { p: { objects: { a: { type: 'templated', template: { id: 'x' } } } } } }),
    ).toThrow(LoadError);
    expect(() => read({ info, pages: { p: { objects: { a: { type: 'no.such.type' } } } } })).toThrow(LoadError);
  });

  it('an entry with neither type nor template is skipped (the spurious-object workaround)', () => {
    const res = read({ info, pages: { p: { name: 'P', order: 1, objects: { a: rect(1), junk: { order: 3 } } } } });
    expect(res.doc.activePage().objectStore.objects.map((o) => o.id)).toEqual(['a']);
    expect(res.warnings).toContainEqual({ code: 'object_skipped', count: 1 });
  });

  it('a connector with a missing end is dropped; integer legacy ids connect', () => {
    const con = (source: unknown, target: unknown) => ({
      type: 'avabodh.basic.connection',
      order: 9,
      ctype: 1,
      source,
      target,
      params: [{ autotype: 1, step: 0, angle: 0, dx: 0, dy: 0 }],
    });
    const res = read({
      info,
      pages: {
        p: {
          name: 'P',
          order: 1,
          objects: [{ ...rect(0, 0), id: 5 }, { ...rect(0, 100), id: 6 }, con(5, 6), con(5, 'missing')],
        },
      },
    });
    const objs = res.doc.activePage().objectStore.objects;
    const cons = objs.filter((o): o is ConnectionObject => o instanceof ConnectionObject);
    expect(cons).toHaveLength(1);
    expect(cons[0]?.first).toBe(objs[0]);
    expect(cons[0]?.second).toBe(objs[1]);
    expect(res.warnings).toContainEqual({ code: 'connector_end_missing', count: 1 });
    // Written with the ends' real ids.
    const out = testIo().codec.writeObject(cons[0] as ConnectionObject);
    expect([out['source'], out['target']]).toEqual([objs[0]?.id, objs[1]?.id]);
  });

  it('a JSON array or a scalar is not a document', () => {
    expect(() => testIo().codec.read('[1]')).toThrow(LoadError);
    expect(() => testIo().codec.readValue(3)).toThrow(LoadError);
  });
});
