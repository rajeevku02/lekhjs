// Store debris (DR-FMT-03): the half-entries kashi's `$set` of a field path leaves when the object or
// page it names is not in the stored board. C++ refused the whole board for them
// (`Serializer.cpp:897-900` for a type-less object with a `template`, `:850-852` for a page without
// `objects`); lekhjs reads the half-object as a templated object and skips the half-page. The board
// fixture is synthetic (parity/fixtures/DR-FMT-03/store-debris.lekh).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonDocumentReader, LoadError } from '../../src/io';
import { ConnectionObject, LekhDocument, type TemplatedObject } from '../../src/model';
import type { JsonObject } from '../../src/template';
import { PKG_ROOT } from '../lint/eslint-helpers';
import { testIo } from './helpers';

const FIXTURE = readFileSync(path.join(PKG_ROOT, 'parity', 'fixtures', 'DR-FMT-03', 'store-debris.lekh'), 'utf8');
const info = { version: '4.2', title: 'T', author: 'A', description: 'D', platform: '1' };
const template = { id: 'avabodh.basic.rectangle', data: ['-w/2', '-h/2', 'w/2', 'h/2'], draw: ['M 0 1 L 2 3'] };
const params = { cx: 300, cy: 100, angle: 0, height: 60, width: 120 };
const rect = (order: number) => ({ type: 'templated', order, params: { ...params, cx: 100 }, template });
const read = (doc: unknown) => testIo().codec.read(JSON.stringify(doc));

describe('store debris (DR-FMT-03)', () => {
  it('the fixture board loads: the half-object is a templated shape, its connector holds, the half-pages are skipped', () => {
    const res = testIo().codec.read(FIXTURE);
    expect(res.doc.pages.map((p) => p.id)).toEqual(['p1']);
    const objs = res.doc.activePage().objectStore.objects;
    // The half-object has no order: like any object added without one (C++ `ObjectStore::add`),
    // it gets the page's next order and goes on top.
    expect(objs.map((o) => o.id)).toEqual(['n1', 'c1', 'n2']);
    expect(objs[2]?.order).toBeGreaterThan(3);
    const n2 = objs[2] as TemplatedObject;
    expect([n2.ds.cx(), n2.ds.cy(), n2.ds.width(), n2.ds.height()]).toEqual([300, 100, 120, 60]);
    expect(n2.shapeTemplate()?.id()).toBe('avabodh.basic.rectangle');
    const c1 = objs[1] as ConnectionObject;
    expect(c1).toBeInstanceOf(ConnectionObject);
    expect([c1.first?.id, c1.second?.id]).toEqual(['n1', 'n2']);
    expect(res.warnings).toEqual(
      expect.arrayContaining([
        { code: 'object_recovered', count: 1 },
        { code: 'object_skipped', count: 1 },
        { code: 'page_skipped', count: 2 },
      ]),
    );
    expect(res.recoveredPages).toEqual([]);
  });

  it('a cloud write of it is a whole board an old C++ client reads: 4.2, typed objects, one page', () => {
    const io = testIo();
    const doc = io.codec.read(FIXTURE).doc;
    const json = io.codec.write(doc, { stamp: 'cloud' }).json;
    expect((json['info'] as JsonObject)['version']).toBe('4.2');
    const pages = json['pages'] as Record<string, JsonObject>;
    expect(Object.keys(pages)).toEqual(['p1']);
    const n2 = (pages['p1']?.['objects'] as Record<string, JsonObject>)['n2'];
    expect(n2?.['type']).toBe('templated');
    expect(n2?.['order']).toBe(doc.activePage().objectStore.objects[2]?.order);
    // Read back, nothing is left to recover.
    const again = testIo().codec.read(JSON.stringify(json));
    expect(again.warnings.map((w) => w.code)).not.toContain('object_recovered');
    expect(again.warnings.map((w) => w.code)).not.toContain('page_skipped');
    expect(again.doc.activePage().objectStore.objects).toHaveLength(3);
  });

  it('a type-less entry whose template does not parse, or that has no params, is skipped', () => {
    const res = read({
      info,
      pages: {
        p: {
          name: 'P',
          order: 1,
          objects: {
            a: rect(1),
            b: { template: { id: 'no.such.template' }, params },
            c: { template, order: 2 },
            d: { template: 'not a template', params },
          },
        },
      },
    });
    expect(res.doc.activePage().objectStore.objects.map((o) => o.id)).toEqual(['a']);
    expect(res.warnings).toContainEqual({ code: 'object_skipped', count: 3 });
  });

  it('a board whose every page is a half-page gets the one default page, as pages {} does', () => {
    const res = read({ info, pages: { p: { order: 2 }, q: { canvassizetype: 'infinite' } } });
    expect(res.doc.pages).toHaveLength(1);
    expect(res.doc.pages[0]?.objectStore.objects).toHaveLength(0);
    expect(res.warnings).toContainEqual({ code: 'page_skipped', count: 2 });
  });

  it('unchanged: a typed object that does not parse still fails the load', () => {
    expect(() => read({ info, pages: { p: { objects: { a: { type: 'templated', template } } } } })).toThrow(LoadError);
  });

  it('unchanged: a realtime addpages page without objects is refused', () => {
    const io = testIo();
    const doc = io.codec.read(JSON.stringify({ info, pages: { p: { name: 'P', order: 1, objects: {} } } })).doc;
    expect(doc).toBeInstanceOf(LekhDocument);
    expect(() => new JsonDocumentReader(io.codec.env).readPage({ name: 'Q', order: 2 }, 'q', doc)).toThrow(LoadError);
  });
});
