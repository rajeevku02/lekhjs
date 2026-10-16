// FormatVersion (spec 04 §9.1, AC-FMT-01) and FormatStamp (§9.2, spec 03 §10.6): the reader's
// range and typed errors, and the writer's stamp from the `stamp` argument alone — offline always
// 5.0, cloud by content only — with concurrent writers of different policies independent
// (AC-ENG-20, AC-FMT-03, the cloud rule of AC-FMT-04/-23).
import { describe, expect, it } from 'vitest';
import { FormatStamp, FormatVersion, LoadError, documentUsesTitle } from '../../src/io';
import type { JsonObject } from '../../src/template';
import { testIo } from './helpers';

const MISSING = Symbol('missing');

function doc(objects: Record<string, unknown>, version: unknown = '4.2'): string {
  const info = version === MISSING ? { title: 't' } : { version, title: 't' };
  return JSON.stringify({ info, pages: { p1: { name: 'P', order: 1, objects } } });
}

const rect = (extra: Record<string, unknown> = {}) => ({
  type: 'templated',
  order: 100,
  params: { cx: 0, cy: 0, width: 40, height: 20, angle: 0 },
  template: { id: 'test.rect', data: ['-w/2', '-h/2', 'w/2', 'h/2'], draw: ['M 0 1 L 2 3'], ...extra },
});

const titled = () =>
  rect({
    texts: [
      { location: '0 1 2 3', text: 'body' },
      { external: 'bottom', text: 'Title' },
    ],
  });
const jsGenerated = () =>
  rect({
    id: 'avabodh.wireframe.button',
    generator: { script: '/*lekh-js:1:wireframe/button*/', text: 'OK', interprettext: false },
  });
const luaGenerated = () => rect({ id: 'avabodh.wireframe.button', generator: { script: 'return {}', text: 'OK' } });

function loadErr(text: string): string {
  try {
    testIo().codec.read(text);
  } catch (e) {
    return e instanceof LoadError ? e.code : 'other';
  }
  return 'ok';
}

describe('FormatVersion (AC-FMT-01)', () => {
  it.each(['2.0', '4', '4.2', '4.3', '4.3.1', '5', '5.0'])('accepts %s', (v) => {
    expect(loadErr(doc({}, v))).toBe('ok');
  });

  it('accepts the JSON number 4.2', () => {
    expect(loadErr(doc({}, 4.2))).toBe('ok');
    expect(testIo().codec.read(doc({}, 4.2)).version).toBe('4.2');
  });

  it.each(['5.1', '5.0.1', '6.0'])('rejects %s with format_too_new', (v) => {
    expect(loadErr(doc({}, v))).toBe('format_too_new');
  });

  it.each([[MISSING], [''], [' 5.0'], ['5.0-ts'], ['1.9'], [null], [true]])('rejects %s with format_invalid', (v) => {
    expect(loadErr(doc({}, v))).toBe('format_invalid');
  });

  it('a document without info is format_invalid', () => {
    expect(loadErr(JSON.stringify({ pages: {} }))).toBe('format_invalid');
  });

  it('compares component by component, missing components 0', () => {
    const v = (s: string) => FormatVersion.of(s);
    expect(v('5').equals(v('5.0.0'))).toBe(true);
    expect(v('4.3.1').greaterThan(v('4.3'))).toBe(true);
    expect(v('4.10').greaterThan(v('4.9'))).toBe(true);
    expect(v('2.0').lessThan(v('2.0.1'))).toBe(true);
    expect(FormatVersion.parse(4.2)?.toString()).toBe('4.2');
    expect(FormatVersion.parse('-1')).toBeNull();
  });

  it('carries the error texts of spec 04 §9.1', () => {
    expect(new LoadError('format_too_new').message).toBe(
      'This board was made with a newer version of Lekh. Please update the app to open it.',
    );
    expect(new LoadError('format_invalid').message).toBe(
      'Unable to open this board. The file is damaged or not a Lekh file.',
    );
    expect(new LoadError('object_parse').message).toMatch(/malfromed/);
  });
});

describe('FormatStamp (AC-ENG-20)', () => {
  const versionOf = (text: string, stamp: 'offline' | 'cloud') => {
    const io = testIo();
    const out = io.codec.write(io.codec.read(text).doc, { stamp });
    expect((out.json['info'] as JsonObject)['version']).toBe(out.version);
    return out.version;
  };

  it('offline always writes 5.0 (AC-FMT-03)', () => {
    expect(versionOf(doc({}), 'offline')).toBe('5.0');
    expect(versionOf(doc({ a: rect() }), 'offline')).toBe('5.0');
    expect(versionOf(doc({ a: titled() }), 'offline')).toBe('5.0');
    expect(versionOf(doc({ a: jsGenerated() }), 'offline')).toBe('5.0');
  });

  it('cloud writes by content: 4.2, 4.3 with a title, 5.0 with a JS generator', () => {
    expect(versionOf(doc({ a: rect() }), 'cloud')).toBe('4.2');
    expect(versionOf(doc({ a: titled() }), 'cloud')).toBe('4.3');
    expect(versionOf(doc({ a: jsGenerated() }), 'cloud')).toBe('5.0');
    expect(versionOf(doc({ a: jsGenerated(), b: titled() }), 'cloud')).toBe('5.0');
    // A title inside a group counts (any group depth).
    const group = {
      type: 'avabodh.basic.group',
      order: 5,
      params: { cx: 0, cy: 0, width: 40, height: 20, angle: 0, orig_width: 40, orig_height: 20 },
      objects: {
        m1: {
          orig_cx: 0,
          orig_cy: 0,
          orig_width: 40,
          orig_height: 20,
          orig_angle: 0,
          xfactor: 0,
          yfactor: 0,
          index: 0,
          object: titled(),
        },
      },
    };
    expect(versionOf(doc({ g: group }), 'cloud')).toBe('4.3');
  });

  it('the cloud rule reads neither the file version nor anything but content (AC-FMT-23)', () => {
    expect(versionOf(doc({ a: rect() }, '5.0'), 'cloud')).toBe('4.2');
    expect(versionOf(doc({ a: titled() }, '5.0'), 'cloud')).toBe('4.3');
  });

  it('a Lua generator does not count; a converting resolve hook makes it JS', () => {
    expect(versionOf(doc({ a: luaGenerated() }), 'cloud')).toBe('4.2');
    const io = testIo({
      generators: {
        resolve: (json) => {
          const gen = json['generator'] as JsonObject | undefined;
          if (gen === undefined) return { json, generator: null, converted: false };
          const out = { ...json, generator: { ...gen, script: '/*lekh-js:1:wireframe/button*/' } };
          return { json: out, generator: { kind: 'js', key: 'wireframe/button' }, converted: true };
        },
      },
    });
    const res = io.codec.read(doc({ a: luaGenerated() }));
    expect(res.convertedLua).toBe(true);
    expect(io.codec.write(res.doc, { stamp: 'cloud' }).version).toBe('5.0');
  });

  it('a placeholder never counts as JS (the isJsForm hook)', () => {
    const io = testIo({ generators: { isJsForm: () => false } });
    expect(io.codec.write(io.codec.read(doc({ a: jsGenerated() })).doc, { stamp: 'cloud' }).version).toBe('4.2');
  });

  it('two sessions writing interleaved with different policies do not affect each other', () => {
    const a = testIo();
    const b = testIo();
    const da = a.codec.read(doc({ x: titled() })).doc;
    const db = b.codec.read(doc({ y: rect() })).doc;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(a.codec.write(da, { stamp: i % 2 === 0 ? 'cloud' : 'offline' }).version);
      seen.push(b.codec.write(db, { stamp: i % 2 === 0 ? 'offline' : 'cloud' }).version);
    }
    expect(seen).toEqual(['4.3', '5.0', '5.0', '4.2', '4.3', '5.0', '5.0', '4.2']);
    // One codec, alternating policies.
    expect([a.codec.write(da, { stamp: 'offline' }).version, a.codec.write(da, { stamp: 'cloud' }).version]).toEqual([
      '5.0',
      '4.3',
    ]);
  });

  it('versionFor and documentUsesTitle', () => {
    expect(FormatStamp.versionFor('offline', { hasJsGenerators: false, usesTitle: false })).toBe('5.0');
    expect(FormatStamp.versionFor('cloud', { hasJsGenerators: false, usesTitle: false })).toBe('4.2');
    expect(FormatStamp.versionFor('cloud', { hasJsGenerators: false, usesTitle: true })).toBe('4.3');
    expect(FormatStamp.versionFor('cloud', { hasJsGenerators: true, usesTitle: false })).toBe('5.0');
    expect(documentUsesTitle(testIo().codec.read(doc({ a: titled() })).doc)).toBe(true);
    expect(documentUsesTitle(testIo().codec.read(doc({ a: rect() })).doc)).toBe(false);
  });
});
