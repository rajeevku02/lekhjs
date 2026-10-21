// The register's board fixtures of io/ (AC-ROL-14; parity/fixtures/DR-ENG-*/): each synthetic board
// is read and written by lekhjs here and shows the TS side of its entry; register:check --oracles and
// T6 load the same boards in the Node oracle, where the C++ side shows. The inline cases of
// test/io/register.test.ts stay as the unit evidence.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TemplatedObject } from '../../src/model';
import type { JsonObject } from '../../src/template';
import { PKG_ROOT } from '../lint/eslint-helpers';
import { testIo } from './helpers';

const board = (rel: string) => readFileSync(path.join(PKG_ROOT, 'parity', 'fixtures', rel), 'utf8');
const objectsOf = (json: JsonObject) =>
  ((json['pages'] as Record<string, JsonObject>)['p1']?.['objects'] ?? {}) as Record<string, JsonObject>;

describe('io register board fixtures', () => {
  it('DR-ENG-01: a text with a \\u escape loads (u-escape.lekh)', () => {
    const doc = testIo().codec.read(board('DR-ENG-01/u-escape.lekh')).doc;
    const o = doc.activePage().objectStore.objects[0] as TemplatedObject;
    expect(o.shapeTemplate()?.textData[0]?.text).toBe('alpha note');
  });

  it('DR-ENG-02: of a duplicated key the last value wins (duplicate-key.lekh)', () => {
    const io = testIo();
    const doc = io.codec.read(board('DR-ENG-02/duplicate-key.lekh')).doc;
    const o = doc.activePage().objectStore.objects[0] as TemplatedObject;
    expect(o.ds.cx()).toBe(150);
    const params = objectsOf(io.codec.write(doc, { stamp: 'offline' }).json)['n1']?.['params'] as JsonObject;
    expect(params['cx']).toBe(150);
  });

  it('DR-ENG-03: order 2.0 and flags 31.0 read as integers (integer-with-fraction.lekh)', () => {
    const doc = testIo().codec.read(board('DR-ENG-03/integer-with-fraction.lekh')).doc;
    const objs = doc.activePage().objectStore.objects as TemplatedObject[];
    expect(objs.map((o) => [o.id, o.order])).toEqual([
      ['n1', 1],
      ['n2', 2],
    ]);
    expect(objs.map((o) => o.shapeTemplate()?.getFlags())).toEqual([31, 31]);
  });

  it('DR-ENG-04: an order past 32 bits keeps its value (large-order.lekh)', () => {
    const io = testIo();
    const doc = io.codec.read(board('DR-ENG-04/large-order.lekh')).doc;
    expect(doc.activePage().objectStore.objects.map((o) => [o.id, o.order])).toEqual([
      ['n2', 5],
      ['n1', 2 ** 40 + 3],
    ]);
    expect(objectsOf(io.codec.write(doc, { stamp: 'offline' }).json)['n1']?.['order']).toBe(2 ** 40 + 3);
  });

  it('DR-ENG-06: a number that reads as non-finite is written as 0 (non-finite.lekh)', () => {
    const io = testIo();
    const doc = io.codec.read(board('DR-ENG-06/non-finite.lekh')).doc;
    const out = io.codec.write(doc, { stamp: 'offline' });
    const params = objectsOf(JSON.parse(out.text) as JsonObject)['n1']?.['params'] as JsonObject;
    expect(params['angle']).toBe(0);
    expect(out.nonFinite).toBeGreaterThan(0);
  });

  it('DR-ENG-07: a key with a quote and a backslash is escaped on write (quoted-key.lekh)', () => {
    const io = testIo();
    const doc = io.codec.read(board('DR-ENG-07/quoted-key.lekh')).doc;
    const text = io.codec.write(doc, { stamp: 'offline' }).text;
    expect(text).toContain('"n\\"1\\\\x":');
    expect(testIo().codec.read(text).doc.activePage().objectStore.objects[0]?.id).toBe('n"1\\x');
  });

  it('DR-ENG-19: colliding embed ids are written sorted, the first wins (colliding-embed-ids.lekh)', () => {
    const io = testIo();
    const doc = io.codec.read(board('DR-ENG-19/colliding-embed-ids.lekh')).doc;
    const templates = io.codec.write(doc, { stamp: 'offline' }).json['templates'] as Record<string, JsonObject>;
    expect(Object.keys(templates)).toEqual(['alpha_beta_gamma']);
    expect(templates['alpha_beta_gamma']?.['id']).toBe('alpha.beta_gamma');
  });
});
