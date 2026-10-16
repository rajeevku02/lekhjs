// `LuaToJsConverter` and the generators it builds (spec 04 §5, §7): the classification order, the
// exact JSON before and after (AC-GEN-12), the written form (AC-GEN-11), placeholders preserving
// the body (AC-GEN-16), a failing first generation (AC-GEN-22), generation only from `load()`
// (AC-GEN-07) and no evaluation of the script text (AC-GEN-09).
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Canvas2DLike } from '../../src/base';
import {
  GeneratorRegistry,
  GeneratorScriptTable,
  LuaToJsConverter,
  StoredNativeGenerator,
  UnknownGeneratorPlaceholder,
  WireframeGenerator,
} from '../../src/generators';
import { converterHooks } from '../../src/io';
import type { TemplatedObject } from '../../src/model';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { cloneJson, type JsonObject, type WireframeModule } from '../../src/template';
import { CORE_FIXTURES, testIo } from '../io/helpers';
import { testRuntime } from '../session/helpers';
import { testEnv } from '../template/helpers';
import { BUTTON, PAGE, boardWith, buttonBody, jsText, luaButton, luaSource, objectOf } from './helpers';

const conv = new LuaToJsConverter(GeneratorRegistry.builtin());
const JS = jsText('wireframe/button');

describe('classification (spec 04 §7.2)', () => {
  it.each([
    ['native, known shape', { type: 'native', shape: 'bpmn.event' }, BUTTON, { kind: 'native', key: 'bpmn.event' }],
    [
      'native, unknown shape',
      { type: 'native', shape: 'bpmn.nope' },
      BUTTON,
      { kind: 'unknown', key: '', reason: 'unknown_native_shape' },
    ],
    [
      'native, empty shape',
      { type: 'native', shape: '' },
      BUTTON,
      { kind: 'unknown', key: '', reason: 'unknown_native_shape' },
    ],
    ['another type', { type: 'python', script: 'x' }, BUTTON, { kind: 'unknown', key: '', reason: 'unknown_type' }],
    ['Lua, known id', { script: 'function generate(a,b) end' }, BUTTON, { kind: 'lua', key: 'wireframe/button' }],
    [
      'Lua type name, known id',
      { type: 'LuaShapeGenerator', script: 'x' },
      BUTTON,
      { kind: 'lua', key: 'wireframe/button' },
    ],
    [
      'scriptfile, known id',
      { scriptfile: 'wireframe/button_min.lua', script: '' },
      BUTTON,
      { kind: 'lua', key: 'wireframe/button' },
    ],
    [
      'Lua, unknown id',
      { script: 'x' },
      'avabodh.wireframe.nope',
      { kind: 'unknown', key: '', reason: 'lua_unknown_id' },
    ],
    ['JS, known id', { script: JS }, BUTTON, { kind: 'js', key: 'wireframe/button' }],
    ['JS, unknown id', { script: JS }, 'acme.button', { kind: 'unknown', key: '', reason: 'js_unknown_id' }],
    // Dispatch is by id: a JS text naming another module still runs the id's module.
    [
      'JS of another key, known id',
      { script: '/*lekh-js:1:wireframe/menu*/x' },
      BUTTON,
      { kind: 'js', key: 'wireframe/button' },
    ],
  ])('%s', (_name, gen, id, expected) => {
    expect(conv.classify(gen as JsonObject, id)).toEqual(expected);
  });

  it('a template with no generator object has none', () => {
    const json = { id: BUTTON, data: [] };
    expect(conv.resolve(json)).toEqual({ json, generator: null, converted: false });
    expect(conv.resolve({ id: BUTTON, generator: 'x' }).generator).toBeNull();
  });
});

describe('Lua → JS, exact JSON (spec 04 §7.2)', () => {
  it('a stored board object: only `script` changes', () => {
    const before = luaButton('Search');
    const frozen = JSON.stringify(before);
    const r = conv.resolve(before);
    expect(JSON.stringify(before)).toBe(frozen);
    expect(r.converted).toBe(true);
    expect(r.generator).toEqual({ kind: 'js', key: 'wireframe/button' });
    expect(r.json).toEqual({ ...before, generator: { script: JS, text: 'Search', interprettext: true } });
    expect(Object.keys(r.json)).toEqual(Object.keys(before));
  });

  it('a v4 stencil entry: `scriptfile` and the empty `script` go, key order is the serializer’s', () => {
    const gen = {
      scriptfile: 'wireframe/button_min.lua',
      script: '',
      text: 'Button',
      interprettext: true,
      embedrefs: ['avabodh.wireframe.icon_a', 'avabodh.wireframe.icon_b'],
    };
    const r = conv.resolve(buttonBody(gen));
    const out = r.json['generator'] as JsonObject;
    expect(out).toEqual({ script: JS, text: 'Button', interprettext: true, embedrefs: gen.embedrefs });
    expect(Object.keys(out)).toEqual(['script', 'text', 'interprettext', 'embedrefs']);
  });

  it('an old version of a known script converts by id (no hash check); JS is left as it is', () => {
    expect(conv.resolve(buttonBody({ script: 'function generate() return {} end', text: 'x' })).converted).toBe(true);
    const js = buttonBody({ script: '/*lekh-js:1:wireframe/button*/old', text: 'x' });
    const r = conv.resolve(js);
    expect(r.converted).toBe(false);
    expect(r.json).toBe(js);
  });

  it('every text in scripts.generated.json starts with its marker (AC-GEN-23)', () => {
    const t = GeneratorScriptTable.builtin();
    expect(t.keys().length).toBeGreaterThan(0);
    for (const k of t.keys()) expect(t.get(k)?.startsWith(`/*lekh-js:1:${k}*/`)).toBe(true);
  });
});

describe('iphone-wireframe.lekh (AC-GEN-12)', () => {
  const file = path.join(CORE_FIXTURES, 'boards', 'iphone-wireframe.lekh');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as JsonObject;
  const buttons: [string, JsonObject][] = [];
  for (const page of Object.values(raw['pages'] as Record<string, JsonObject>)) {
    for (const [id, o] of Object.entries((page['objects'] ?? {}) as Record<string, JsonObject>)) {
      const t = o['template'] as JsonObject | undefined;
      if (t?.['id'] === BUTTON) buttons.push([id, t]);
    }
  }

  it('both buttons convert to the after-JSON, every other member unchanged', () => {
    expect(buttons.length).toBe(2);
    for (const [, t] of buttons) {
      const gen = t['generator'] as JsonObject;
      expect(gen['script']).toBe(luaSource('wireframe/button_min.lua'));
      const r = conv.resolve(t);
      expect(r.json).toEqual({
        ...t,
        generator: { script: JS, text: gen['text'], interprettext: gen['interprettext'] },
      });
    }
  });

  it('a read converts in memory; the write carries the JS form and no Lua', () => {
    const io = testIo();
    const read = io.codec.read(readFileSync(file, 'utf8'));
    expect(read.convertedLua).toBe(true);
    const out = io.codec.write(read.doc, { stamp: 'offline' });
    expect(out.text).not.toContain('function generate(a,b)');
    expect(out.text.split(JSON.stringify(JS).slice(1, -1)).length - 1).toBe(2);
  });
});

describe('the written form (AC-GEN-11)', () => {
  it('{script, text, interprettext[, embedrefs]}, canonical text, no generated members', () => {
    const io = testIo();
    const t = io.codec.templates.parse(
      luaButton('Go', {
        texts: [{ location: 'default', text: 'stale' }],
        draw: ['M 0 1 L 2 3'],
        embeds: [{ name: 'x', location: '0 1 2 3 4' }],
        containers: ['M 0 1'],
        images: '',
      }),
    );
    if (t === null) throw new Error('no template');
    t.load();
    expect(t.generator).toBeInstanceOf(WireframeGenerator);
    const out = io.codec.templates.serialize(t);
    expect(out['generator']).toEqual({ script: JS, text: 'Go', interprettext: true });
    for (const k of ['texts', 'draw', 'images', 'embeds', 'containers']) expect(out).not.toHaveProperty(k);
    expect(out['data']).toEqual(['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2']);
    const withRefs = io.codec.templates.parse(
      buttonBody({ script: 'x', text: '', interprettext: false, embedrefs: ['b', 'a', 'b'] }),
    );
    if (withRefs === null) throw new Error('no template');
    expect(io.codec.templates.serialize(withRefs)['generator']).toEqual({
      script: JS,
      text: '',
      interprettext: false,
      embedrefs: ['a', 'b'],
    });
  });

  it('the module draws the shape: the generated members are live, minimum size enforced', () => {
    const io = testIo();
    const doc = io.codec.read(JSON.stringify(boardWith({ b1: objectOf(luaButton('A long label'), 0, 0) }))).doc;
    const obj = doc.getPage(PAGE)?.objectStore.getObject('b1') as TemplatedObject;
    const t = obj.shapeTemplate();
    if (t === null) throw new Error('no template');
    expect(t.pathData.map((p) => p.drawCmds)).toEqual(['M 0 1 L 2 3 L 4 5 L 6 7 Z']);
    expect(t.textData.map((x) => x.text)).toEqual(['A long label']);
    const g = t.generator as WireframeGenerator;
    expect(g.minSize().w).toBeGreaterThan(80);
    obj.generateData();
    expect(obj.ds.width()).toBe(g.minSize().w);
  });
});

describe('placeholders (AC-GEN-16, DR-GEN-12)', () => {
  const variants: [string, JsonObject][] = [
    ['lua_unknown_id', { ...luaButton('x'), id: 'avabodh.wireframe.gone' }],
    ['js_unknown_id', buttonBody({ script: JS, text: 'x', interprettext: true }, { id: 'acme.widget' })],
    ['unknown_type', buttonBody({ type: 'python', script: 'print(1)', text: 'x' })],
    [
      'unknown_native_shape',
      buttonBody(
        { type: 'native', shape: 'bpmn.unknown', text: 'x' },
        { texts: [{ location: 'default', text: 'kept' }] },
      ),
    ],
  ];

  it.each(variants)('%s: drawn as the placeholder, the body written back as read after a move', (reason, body) => {
    const io = testIo();
    const board = boardWith({ o1: objectOf(body, 50, 60) });
    const read = io.codec.read(JSON.stringify(board));
    const obj = read.doc.getPage(PAGE)?.objectStore.getObject('o1') as TemplatedObject;
    const t = obj.shapeTemplate();
    if (t === null) throw new Error('no template');
    expect(t.generator).toBeInstanceOf(UnknownGeneratorPlaceholder);
    expect(t.generator?.preserved()?.reason).toBe(reason);
    expect(t.textData.map((x) => x.text)).toEqual(['Unsupported shape']);
    expect(t.interpretText()).toBe(false);
    // A move (through the session, as the UI does) rewrites only the object's params.
    const session = new BoardSession(testRuntime(), { images: new FakeImagePort(), scheduler: new FakeScheduler() });
    session.load(board, { kind: 'offline' });
    session.dispatch({ type: 'command', origin: 'ui', command: { kind: 'move', ids: ['o1'], dx: 15, dy: -5 } });
    const saved = JSON.parse(session.serialize({ stamp: 'offline' })) as JsonObject;
    const so = ((saved['pages'] as Record<string, JsonObject>)[PAGE]?.['objects'] as Record<string, JsonObject>)['o1'];
    // The writer orders keys as C++ did; the content is the body as read, member for member.
    expect(so?.['template']).toEqual(body);
    expect((so?.['params'] as JsonObject)['cx']).toBe(65);
    session.dispose();
    // A placeholder is never JS-form: the cloud rule stays below 5.0.
    expect(io.codec.write(read.doc, { stamp: 'cloud' }).version).toBe('4.2');
  });

  it('a known native shape whose port is not registered yet keeps its stored drawing', () => {
    const io = testIo();
    const t = io.codec.templates.parse(
      buttonBody({ type: 'native', shape: 'table-v1', text: '' }, { texts: [{ location: 'default', text: 'cell' }] }),
    );
    expect(t?.generator).toBeInstanceOf(StoredNativeGenerator);
    t?.load();
    expect(t?.textData.map((x) => x.text)).toEqual(['cell']);
  });
});

describe('a failing first generation (AC-GEN-22, DR-GEN-10)', () => {
  const flaky: WireframeModule = {
    key: 'wireframe/button',
    generate({ params, text }) {
      if (params['state'] === 'boom') throw new Error('kaput');
      return {
        data: ['-w/2', '-h/2', 'w/2', 'h/2'],
        draw: [{ path: 'M 0 1 L 2 1 L 2 3 Z' }],
        texts: [{ location: 'default', text }],
        images: [],
        embeds: [],
        containers: [],
        minW: 0,
        minH: 0,
      };
    },
  };
  const registry = new GeneratorRegistry({
    modules: [flaky],
    scripts: new GeneratorScriptTable({ 'wireframe/button': '/*lekh-js:1:wireframe/button*/x' }),
  });

  it('draws the placeholder and warns; a later success replaces it; a later failure keeps the output', () => {
    const io = testIo({ generators: converterHooks(new LuaToJsConverter(registry)) });
    const env = testEnv();
    const codec = io.codec.templates.withEnv(env);
    const t = codec.parse(luaButton('Hi', { params: { state: 'boom' } }));
    if (t === null) throw new Error('no template');
    t.load();
    expect(env.warnings.map((w) => w.code)).toEqual(['generator_failed']);
    expect(env.warnings[0]?.details).toMatchObject({ templateId: BUTTON, message: 'kaput' });
    expect(t.textData.map((x) => x.text)).toEqual(['Unsupported shape']);
    const p = t.params.find((x) => x.name === 'state');
    if (p === undefined) throw new Error('no param');
    p.value = 'normal';
    t.load();
    expect(t.textData.map((x) => x.text)).toEqual(['Hi']);
    p.value = 'boom';
    t.load();
    expect(t.textData.map((x) => x.text)).toEqual(['Hi']);
    expect(env.warnings.length).toBe(2);
  });
});

describe('generation only in load() (AC-GEN-07)', () => {
  it('100 layout + paint passes over a board of wireframe shapes generate nothing', () => {
    const objects: Record<string, JsonObject> = {};
    for (let i = 0; i < 12; i++)
      objects[`b${String(i)}`] = objectOf(luaButton(`B${String(i)}`), 40 + i * 90, 40, i + 1);
    const session = new BoardSession(testRuntime(), { images: new FakeImagePort(), scheduler: new FakeScheduler() });
    session.load(boardWith(objects), { kind: 'offline' });
    const ctx = createCanvas(320, 240).getContext('2d') as unknown as Canvas2DLike;
    const spy = vi.spyOn(WireframeGenerator.prototype, 'generate');
    try {
      for (let i = 0; i < 100; i++) {
        for (const p of session.document.pages) p.objectStore.markAllDirty();
        session.layoutAll();
        session.paint('drawing', ctx);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      session.dispose();
    }
  });
});

describe('the script text is never evaluated (AC-GEN-09)', () => {
  it('a side-effecting payload in a known or unknown id has no effect', () => {
    const g = globalThis as { __lekhPwned?: number };
    delete g.__lekhPwned;
    const payload =
      '/*lekh-js:1:wireframe/button*/globalThis.__lekhPwned=1;function generate(){globalThis.__lekhPwned=2}';
    const io = testIo();
    const board = boardWith({
      a: objectOf(buttonBody({ script: payload, text: 'x' })),
      b: objectOf(buttonBody({ script: payload, text: 'x' }, { id: 'acme.evil' })),
      c: objectOf(buttonBody({ script: 'os.exit(1)', text: 'x' })),
    });
    const read = io.codec.read(JSON.stringify(board));
    for (const o of read.doc.getPage(PAGE)?.objectStore.objects ?? []) (o as TemplatedObject).generateData();
    io.codec.write(read.doc, { stamp: 'offline' });
    expect(g.__lekhPwned).toBeUndefined();
  });

  it('src/ calls no eval, Function, import() or Worker', () => {
    const root = path.resolve(import.meta.dirname, '../../src');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) {
          const code = readFileSync(p, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
          if (/\beval\s*\(|new\s+Function\b|\bFunction\s*\(|\bimport\s*\(|new\s+Worker\b/.test(code))
            hits.push(path.relative(root, p));
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});

it('a converted body is a fresh object: cloning the input stays possible', () => {
  const before = luaButton();
  const r = conv.resolve(before);
  expect(r.json).not.toBe(before);
  expect(cloneJson(r.json)).toEqual(r.json);
});
