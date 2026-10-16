// LenientJson (spec 03 §10.3) and the JSON text writer (§10.2): `nan`/`inf` literals read as 0
// (AC-ENG-23), an unescaped key fails with `json_unescaped_key` (OQ-12), nothing else is accepted;
// the writer sorts keys by UTF-8 bytes, escapes them and writes non-finite numbers as 0 (AC-ENG-30).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LoadError, compareUtf8, parseJsonText, parseLenientJson, writeJsonText } from '../../src/io';
import type { TemplatedObject } from '../../src/model';
import { PKG_ROOT } from '../lint/eslint-helpers';
import { testIo } from './helpers';

function code(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    return e instanceof LoadError ? e.code : 'other';
  }
  return 'none';
}

describe('LenientJson', () => {
  it('reads nan, -nan, inf and -inf as 0 and counts them', () => {
    const r = parseLenientJson('{"a": nan, "b": [-nan, inf, -inf, 1.5], "c": {"d": -0.25e1}}');
    expect(r.value).toEqual({ a: 0, b: [0, 0, 0, 1.5], c: { d: -2.5 } });
    expect(r.nonFinite).toBe(4);
  });

  it('is JSON.parse otherwise: last duplicate wins, \\u escapes, __proto__ is an own key', () => {
    const r = parseLenientJson('{"k": 1, "k": 2, "s": "\\u00e9\\n\\"", "__proto__": {"x": 1}}');
    const v = r.value as Record<string, unknown>;
    expect(v['k']).toBe(2);
    expect(v['s']).toBe('é\n"');
    expect(Object.prototype.hasOwnProperty.call(v, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
  });

  it('an unescaped quote in a key is json_unescaped_key; any other error json_parse', () => {
    expect(code(() => parseLenientJson('{"a"b": 1}'))).toBe('json_unescaped_key');
    expect(code(() => parseLenientJson('{"ok": 1, "a"b": nan}'))).toBe('json_unescaped_key');
    expect(code(() => parseLenientJson('{"a":"b": 1}'))).toBe('json_unescaped_key');
    expect(code(() => parseLenientJson('{"a": 1,}'))).toBe('json_parse');
    expect(code(() => parseLenientJson('{"a": NaN}'))).toBe('json_parse');
    expect(code(() => parseLenientJson('{"a": "raw\u0001control"}'))).toBe('json_parse');
    expect(code(() => parseLenientJson('{"a": 1} trailing'))).toBe('json_parse');
    expect(code(() => parseLenientJson('{"a": infinity}'))).toBe('json_parse');
  });

  it('parseJsonText tries JSON.parse first and falls back only on a SyntaxError', () => {
    expect(parseJsonText('{"a": 1}')).toEqual({ value: { a: 1 }, nonFinite: 0 });
    expect(parseJsonText('{"a": inf}')).toEqual({ value: { a: 0 }, nonFinite: 1 });
  });
});

describe('a file with nan/inf literals loads (AC-ENG-23)', () => {
  const file = JSON.stringify({
    info: { version: '4.2', title: 't', author: '', description: '', platform: '1' },
    pages: {
      p1: {
        name: 'P',
        order: 1,
        objects: {
          r1: {
            type: 'templated',
            order: 100,
            params: { cx: 'CX', cy: 10, width: 40, height: 20, angle: 'ANGLE' },
            template: { id: 'avabodh.basic.rectangle', data: ['-w/2', '-h/2', 'w/2', 'h/2'], draw: ['M 0 1 L 2 3'] },
          },
        },
      },
    },
  })
    .replace('"CX"', 'nan')
    .replace('"ANGLE"', '-inf');

  it('loads, the values are 0, and nonfinite_read is logged', () => {
    const io = testIo();
    expect(() => JSON.parse(file) as unknown).toThrow(SyntaxError);
    const res = io.codec.read(file);
    const obj = res.doc.activePage().objectStore.objects[0] as TemplatedObject;
    expect(obj.ds.cx()).toBe(0);
    expect(obj.ds.angle()).toBe(0);
    expect(res.warnings).toContainEqual({ code: 'nonfinite_read', count: 2 });
    expect(io.logs.some((l) => l.level === 'warn' && l.m === 'nonfinite_read')).toBe(true);
  });

  it('a file with an unescaped key fails with json_unescaped_key', () => {
    const bad = file.replace('"r1"', '"r"1"');
    expect(code(() => testIo().codec.read(bad))).toBe('json_unescaped_key');
  });
});

describe('writeJsonText', () => {
  it('sorts keys by UTF-8 bytes, integer-like keys included', () => {
    expect(writeJsonText({ b: 1, '10': 2, '9': 3, a: { z: 1, y: [{ d: 1, c: 2 }] } })).toBe(
      '{"10":2,"9":3,"a":{"y":[{"c":2,"d":1}],"z":1},"b":1}',
    );
  });

  it('orders astral code points after every BMP one (UTF-8 order)', () => {
    expect(['\u{1F600}', '￿', 'a'].sort(compareUtf8)).toEqual(['a', '￿', '\u{1F600}']);
  });

  it('escapes keys and writes non-finite numbers as 0 (AC-ENG-30)', () => {
    const stats = { nonFinite: 0 };
    const text = writeJsonText({ 'a"b\\c': NaN, n: [Infinity, -Infinity, -0] }, stats);
    expect(text).toBe('{"a\\"b\\\\c":0,"n":[0,0,0]}');
    expect(JSON.parse(text)).toEqual({ 'a"b\\c': 0, n: [0, 0, 0] });
    expect(stats.nonFinite).toBe(3);
  });

  it('a document with NaN geometry saves as valid JSON and logs nonfinite_write once (AC-ENG-30)', () => {
    const io = testIo();
    const doc = io.codec.read(
      JSON.stringify({ info: { version: '4.2' }, pages: { p: { name: 'P', order: 1, objects: {} } } }),
    ).doc;
    const obj = io.codec.readObject({
      type: 'templated',
      params: { cx: 0, cy: 0, width: 10, height: 10, angle: 0 },
      template: { id: 'x', data: ['0', '0'], draw: ['M 0 1'] },
    }).object as TemplatedObject;
    obj.ds.setCx(NaN);
    obj.ds.setAngle(Infinity);
    doc.activePage().objectStore.add(obj);
    const out = io.codec.write(doc, { stamp: 'offline' });
    expect(() => JSON.parse(out.text) as unknown).not.toThrow();
    expect(out.nonFinite).toBe(2);
    expect(io.logs.filter((l) => l.m === 'nonfinite_write')).toHaveLength(1);
  });
});

describe('io/ is synchronous (AC-ENG-25, io part)', () => {
  it('no async/await/Promise', () => {
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const dir = path.join(PKG_ROOT, 'src', 'io');
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((x) => x.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      expect(/\basync\b|\bawait\b|\bPromise\b/.test(strip(readFileSync(path.join(dir, f), 'utf8'))), f).toBe(false);
    }
  });
});
