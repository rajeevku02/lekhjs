// The legacy XML reader (spec 03 §10.5, AC-ENG-22): the hand-written fixture of every XML object
// kind loads to the same objects as the C++ oracle (test/fixtures/golden/io, from
// parity/tools/io-golden), compared object by object on the JSON each core writes. Ids and orders
// are minted (C++ from the host's uuids and a steady clock), so objects are matched by position
// and connector ends by the position of the object they name. A text object's box is its measured
// text, which the two text stacks measure differently, so its width and height are not compared;
// and an image's data is compared as present, since C++ re-encoded it through the platform.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LoadError, XmlDocumentReader, XmlTokenizer, unescapeXml } from '../../src/io';
import { ConnectionObject, TemplatedObject } from '../../src/model';
import type { JsonValue, JsonObject } from '../../src/template';
import { PKG_ROOT } from '../lint/eslint-helpers';
import { IO_FIXTURES, LIVE_NAMES, allObjects, readText, testIo, typesIn } from './helpers';
import { LEGACY_TYPE_NAMES } from '../../src/io';

const GOLDEN = path.join(PKG_ROOT, 'test', 'fixtures', 'golden', 'io');

type Obj = Record<string, JsonValue>;

/** A page's objects in stacking order, with ids replaced by positions. */
function normalise(doc: JsonObject): Obj[] {
  const pages = doc['pages'] as Record<string, Obj>;
  const page = Object.values(pages)[0] as Obj;
  const entries = Object.entries(page['objects'] as Record<string, Obj>).sort(
    (a, b) => (a[1]['order'] as number) - (b[1]['order'] as number),
  );
  const pos = new Map(entries.map(([id], i) => [id, i]));
  return entries.map(([, o]) => {
    const c: Obj = { ...o };
    delete c['order'];
    if (typeof c['source'] === 'string') c['source'] = pos.get(c['source']) ?? -1;
    if (typeof c['target'] === 'string') c['target'] = pos.get(c['target']) ?? -1;
    const tmpl = c['template'] as Obj | undefined;
    // C++ decoded a legacy image and re-encoded it through the platform; TS keeps the stored bytes.
    if (tmpl !== undefined && Array.isArray(tmpl['images'])) {
      c['template'] = {
        ...tmpl,
        images: (tmpl['images'] as Obj[]).map((im) => ({ ...im, data: im['data'] === '' ? '' : '<png>' })),
      };
    }
    if (tmpl?.['id'] === 'avabodh.basic.text') {
      const params = { ...(c['params'] as Obj) };
      delete params['width'];
      delete params['height'];
      c['params'] = params;
    }
    return c;
  });
}

const NUM = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g;

/** Numbers agree to 1e-4 relative (float32 in C++, double in TS). */
function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** The paths where `a` and `b` differ; numbers (and numbers inside `data` strings) with tolerance. */
function diff(a: JsonValue | undefined, b: JsonValue | undefined, at: string, out: string[], key = ''): string[] {
  if (typeof a === 'number' && typeof b === 'number') {
    if (!close(a, b)) out.push(`${at}: ${String(a)} != ${String(b)}`);
  } else if (typeof a === 'string' && typeof b === 'string' && key === 'data') {
    const na = (a.match(NUM) ?? []).map(Number);
    const nb = (b.match(NUM) ?? []).map(Number);
    if (a.replace(NUM, '#') !== b.replace(NUM, '#') || na.some((n, i) => !close(n, nb[i] ?? NaN)))
      out.push(`${at}: ${a} != ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${at}: length ${String(a.length)} != ${String(b.length)}`);
    else (a as JsonValue[]).forEach((x, i) => diff(x, (b as JsonValue[])[i], `${at}[${String(i)}]`, out, key));
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

describe('XML reader against the C++ oracle (AC-ENG-22)', () => {
  const xml = readText(path.join(IO_FIXTURES, 'legacy-objects.xml'));
  const golden = JSON.parse(readText(path.join(GOLDEN, 'legacy-objects.json'))) as JsonObject;

  it('sniffs XML and loads every object kind', () => {
    expect(XmlDocumentReader.isXml(xml)).toBe(true);
    const res = testIo().codec.read(xml);
    expect(res.format).toBe('xml');
    expect(res.version).toBe('1.0');
    expect(res.doc.info.title).toBe('XML legacy objects');
    expect(res.doc.pages).toHaveLength(1);
    expect(res.currentStyle?.effectiveStrokeWidth()).toBe(1.5);
  });

  it('loads to the same objects as the C++ core', () => {
    const io = testIo();
    const out = io.codec.write(io.codec.read(xml).doc, { stamp: 'cloud' });
    const ts = normalise(out.json);
    const cpp = normalise(golden);
    expect(ts).toHaveLength(cpp.length);
    ts.forEach((o, i) => {
      expect(diff(o, cpp[i], `object ${String(i)}`, [])).toEqual([]);
    });
    // The page background, as C++ wrote it.
    const page = (j: JsonObject) => Object.values(j['pages'] as Record<string, Obj>)[0] as Obj;
    expect(page(out.json)['background']).toEqual(page(golden)['background']);
  });

  it('holds and writes no legacy type (AC-ENG-35, XML path)', () => {
    const io = testIo();
    const res = io.codec.read(xml);
    for (const o of allObjects(res.doc)) expect(LIVE_NAMES).toContain(o.name());
    const out = io.codec.write(res.doc, { stamp: 'offline' });
    expect(typesIn(out.json).filter((t) => LEGACY_TYPE_NAMES.includes(t))).toEqual([]);
  });

  it('converts a curve connector, which the C++ converter could not (it returned a freed pointer)', () => {
    const res = testIo().codec.read(readText(path.join(IO_FIXTURES, 'ts-only-curve-connection.xml')));
    const objs = res.doc.activePage().objectStore.objects;
    expect(objs.map((o) => o.name())).toEqual(['Templated', 'Templated', 'Connection']);
    const con = objs[2] as ConnectionObject;
    expect(con.first).toBe(objs[0]);
    expect(con.second).toBe(objs[1]);
    expect(con.getType()).toBe(0);
    const p = con.getParams();
    expect(p[0]?.['angle1']).toBeCloseTo(0.5);
    expect(p[1]?.['angle1']).toBeCloseTo(-0.7);
    expect(p[0]?.['cdist1']).toBeCloseTo(0.22);
    expect(p[1]?.['cdist1']).toBeCloseTo(1.5 * 0.22);
    expect(con.arrows.end()).not.toBeNull();
    expect(con.arrows.start()).toBeNull();
  });

  it('a connector with a missing end is dropped', () => {
    const text = xml.replace('<Source>1</Source><Target>4</Target>', '<Source>1</Source><Target>99</Target>');
    const objs = testIo().codec.read(text).doc.activePage().objectStore.objects;
    expect(objs.some((o) => o instanceof ConnectionObject)).toBe(false);
    expect(objs.filter((o) => o instanceof TemplatedObject)).toHaveLength(10);
  });

  it('a malformed document fails with xml_parse', () => {
    for (const bad of [
      '<LekhDiagram>',
      '<?xml version="1.0"?><LekhDiagram/>',
      xml.replace('<Radius>30</Radius>', ''),
    ]) {
      expect(() => testIo().codec.read(bad)).toThrow(LoadError);
      try {
        testIo().codec.read(bad);
      } catch (e) {
        expect((e as LoadError).code).toBe('xml_parse');
      }
    }
  });

  it('refuses a version it is not compatible with', () => {
    const v2 = xml.replace(
      '<Version>1.0</Version><Compatibility>1.0</Compatibility>',
      '<Version>2.0</Version><Compatibility>2.0</Compatibility>',
    );
    expect(() => testIo().codec.read(v2)).toThrow(LoadError);
    const compat = xml.replace(
      '<Version>1.0</Version><Compatibility>1.0</Compatibility>',
      '<Version>2.0</Version><Compatibility>1.5,1.0</Compatibility>',
    );
    expect(testIo().codec.read(compat).version).toBe('2.0');
  });
});

describe('XmlTokenizer', () => {
  it('reads scalars as C++ atof / atoi / parseBool did', () => {
    const t = new XmlTokenizer(
      '<A> 12.5x</A><B>-7.9</B><C>abc</C><D>0</D><E>false</E><F> 0</F><G>&lt;a&amp;b&gt;&quot;&apos;</G>',
    );
    expect(t.double('A')).toBe(12.5);
    expect(t.int('B')).toBe(-7);
    expect(t.int('C')).toBe(0);
    expect(t.bool('D')).toBe(false);
    expect(t.bool('E')).toBe(false);
    expect(t.bool('F')).toBe(true);
    expect(t.string('G')).toBe('<a&b>"\'');
  });

  it('puts a token back when it does not match', () => {
    const t = new XmlTokenizer('<A>1</A>');
    expect(t.double('B')).toBeNull();
    expect(t.double('A')).toBe(1);
  });

  it('unescapes in the C++ order (&amp; last)', () => {
    expect(unescapeXml('&amp;lt;')).toBe('&lt;');
  });
});
