// The backend-first Lua form (Work 01M4X7TCHFB862XGT68GPY071C BF1; kashi `MCP_GENERATOR_FORM=lua`):
// a `GeneratorRegistry` over the Lua pack with `preserveLua`, handed to a session with
// `SessionOptions.generators` (and a catalog built over it), keeps every wireframe generator in Lua,
// so neither the cloud stamp nor the delta compiler's `FrameStamper` raises a board to 5.0, and an
// installed C++ app keeps opening what the MCP writes. A stored shape keeps its OWN Lua text, as C++
// `LuaShapeGenerator::script_` did; a `scriptfile` stencil takes the pack's text, as C++
// `Platform::getResource` gave it. `newContentFont: false` leaves new semantic content without the
// Noto Sans stamp, as the C++ MCP did. The default (no options) is unchanged: Lua converts to JS.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GeneratorRegistry, GeneratorScriptTable, LuaToJsConverter, buildCatalog } from '../../src/generators';
import { compile, generate } from '../../src/semantic';
import { BoardSession, type SessionOptions } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { JS_GENERATOR_MARKER, type JsonObject, type JsonValue, type LibraryFileJson } from '../../src/template';
import { STENCILS } from '../io/helpers';
import { PKG_ROOT } from '../lint/eslint-helpers';
import { testRuntime } from '../session/helpers';
import { PAGE, boardWith, buttonBody, luaButton, luaSource, objectOf } from './helpers';
import { luaPack } from './oracle/lua-oracle';

const STAMP = 'doc.info.version';
const CALENDAR = 'avabodh.wireframe.calendar';
const WIREFRAME_V4 = path.join(PKG_ROOT, '..', 'lekhboard', 'stencils', 'v4', 'wireframe.json');
const WIREFRAME_V5 = path.join(PKG_ROOT, '..', 'lekhboard', 'stencils', 'v5', 'wireframe.json');

/** The pack as kashi hands it over: `wireframe/<name>_min.lua` → module key `wireframe/<name>`. */
function luaRegistry(preserveLua = true): GeneratorRegistry {
  const texts: Record<string, string> = {};
  for (const [k, v] of Object.entries(luaPack())) texts[k.replace(/_min\.lua$/, '')] = v;
  return new GeneratorRegistry({ scripts: new GeneratorScriptTable(texts), preserveLua });
}

const LUA = luaRegistry();

function stencilFiles(): LibraryFileJson[] {
  const out: LibraryFileJson[] = [];
  for (const dir of ['builtin', 'core']) {
    const d = path.join(STENCILS, dir);
    for (const f of readdirSync(d).sort()) {
      if (!f.endsWith('.json') || f === 'libnames.json') continue;
      out.push(JSON.parse(readFileSync(path.join(d, f), 'utf8')) as LibraryFileJson);
    }
  }
  return out;
}

const LUA_CATALOG = buildCatalog(stencilFiles(), LUA);
const runtime = testRuntime();

function session(lua: boolean): BoardSession {
  const base: SessionOptions = { images: new FakeImagePort(), scheduler: new FakeScheduler() };
  return new BoardSession(
    runtime,
    lua ? { ...base, generators: LUA, catalog: LUA_CATALOG, newContentFont: false } : base,
  );
}

/** The v4 wireframe bodies (Lua `scriptfile` form), as kashi's stencil index hands them over. */
function wireframeBodies(file_ = WIREFRAME_V4): JsonObject[] {
  const file = JSON.parse(readFileSync(file_, 'utf8')) as { templates?: JsonObject[] };
  return file.templates ?? [];
}

const isJs = (script: unknown): boolean => typeof script === 'string' && JS_GENERATOR_MARKER.test(script);

/** Every template with a generator in a serialized document. */
function generators(doc: JsonObject): JsonObject[] {
  const out: JsonObject[] = [];
  const walk = (v: JsonValue | undefined): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') {
      const o = v as JsonObject;
      if (o['generator'] !== undefined && typeof o['generator'] === 'object') out.push(o['generator'] as JsonObject);
      for (const k of Object.keys(o)) walk(o[k]);
    }
  };
  walk(doc);
  return out;
}

/** An older Lua copy than the pack's: what a board stored years ago still carries. */
const OLD_LUA = `${luaSource('wireframe/button_min.lua')}\n-- an older copy\n`;

interface Frame {
  type: string;
  changes: Record<string, JsonValue>;
}

function compileOn(lua: boolean, board: JsonObject, ops: JsonValue[]): Frame[] {
  const s = session(lua);
  expect(s.load(board).ok).toBe(true);
  s.addTemplates(wireframeBodies());
  const answer = compile(s, { version: 1, page: PAGE, ops }) as JsonObject;
  s.dispose();
  expect(answer['ok'], JSON.stringify(answer).slice(0, 300)).toBe(true);
  return (answer['frames'] ?? []) as unknown as Frame[];
}

/** Every generator block and every `fontfamily` a frame list writes. */
function written(frames: Frame[]): { gens: JsonObject[]; fonts: JsonValue[] } {
  const gens: JsonObject[] = [];
  const fonts: JsonValue[] = [];
  const walk = (v: JsonValue | undefined): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') {
      const o = v as JsonObject;
      if (o['generator'] !== undefined && typeof o['generator'] === 'object') gens.push(o['generator'] as JsonObject);
      if (o['fontfamily'] !== undefined) fonts.push(o['fontfamily']);
      for (const k of Object.keys(o)) walk(o[k]);
    }
  };
  for (const f of frames) {
    for (const [k, v] of Object.entries(f.changes)) {
      if (k.endsWith('.fontfamily')) fonts.push(v);
      walk(v);
    }
  }
  return { gens, fonts };
}

describe('the Lua-form converter (preserveLua)', () => {
  const conv = new LuaToJsConverter(LUA);

  it('a stored Lua block keeps its own text, is not converted, and classifies as lua', () => {
    const r = conv.resolve(buttonBody({ type: 'LuaShapeGenerator', script: OLD_LUA, text: 'OK', interprettext: true }));
    expect(r.converted).toBe(false);
    expect(r.generator).toEqual({ kind: 'lua', key: 'wireframe/button' });
    expect(r.json['generator']).toEqual({ script: OLD_LUA, text: 'OK', interprettext: true });
  });

  it('a scriptfile stencil takes the pack text, never JS', () => {
    const r = conv.resolve(buttonBody({ scriptfile: 'wireframe/button_min.lua', text: 'OK' }));
    expect(r.converted).toBe(false);
    expect((r.json['generator'] as JsonObject)['script']).toBe(luaSource('wireframe/button_min.lua'));
    expect((r.json['generator'] as JsonObject)['scriptfile']).toBeUndefined();
  });

  it('a JS (v5 stencil) block under a Lua registry takes the pack text', () => {
    const js = GeneratorRegistry.builtin().scriptText('wireframe/button') ?? '';
    const r = conv.resolve(buttonBody({ script: js, text: 'OK', interprettext: true }));
    expect(r.converted).toBe(false);
    expect(r.generator).toEqual({ kind: 'lua', key: 'wireframe/button' });
    expect((r.json['generator'] as JsonObject)['script']).toBe(luaSource('wireframe/button_min.lua'));
  });

  it('without preserveLua a stored Lua block takes the pack text', () => {
    const r = new LuaToJsConverter(luaRegistry(false)).resolve(buttonBody({ script: OLD_LUA, text: 'OK' }));
    expect((r.json['generator'] as JsonObject)['script']).toBe(luaSource('wireframe/button_min.lua'));
  });

  it('the shipped registry still converts Lua to JS (js mode unchanged)', () => {
    const r = new LuaToJsConverter(GeneratorRegistry.builtin()).resolve(luaButton());
    expect(r.converted).toBe(true);
    expect(isJs((r.json['generator'] as JsonObject)['script'])).toBe(true);
  });
});

describe('a Lua-form session writes what a C++ client opens', () => {
  it('load + cloud serialize: 4.2, the stored Lua byte-identical, no JS', () => {
    const board = boardWith({ b1: objectOf(buttonBody({ script: OLD_LUA, text: 'OK', interprettext: true })) });
    const s = session(true);
    expect(s.load(board).ok).toBe(true);
    const out = JSON.parse(s.serialize({ stamp: 'cloud' })) as JsonObject;
    s.dispose();
    expect((out['info'] as JsonObject)['version']).toBe('4.2');
    const gens = generators(out);
    expect(gens).toHaveLength(1);
    expect(gens[0]?.['script']).toBe(OLD_LUA);
  });

  it('the same load in a default session converts and stamps 5.0', () => {
    const board = boardWith({ b1: objectOf(buttonBody({ script: OLD_LUA, text: 'OK', interprettext: true })) });
    const s = session(false);
    expect(s.load(board).ok).toBe(true);
    const out = JSON.parse(s.serialize({ stamp: 'cloud' })) as JsonObject;
    s.dispose();
    expect((out['info'] as JsonObject)['version']).toBe('5.0');
    expect(isJs(generators(out)[0]?.['script'])).toBe(true);
  });
});

describe.runIf(existsSync(WIREFRAME_V4))('the delta compiler in the Lua form', () => {
  const addCalendar = { op: 'add_node', ref: 'c', shape: CALENDAR, cx: 100, cy: 100 };
  const addRect = { op: 'add_node', ref: 'r', shape: 'avabodh.basic.rectangle', text: 'Hi', cx: 400, cy: 100 };
  const stored = (): JsonObject =>
    boardWith({ b1: objectOf(buttonBody({ script: OLD_LUA, text: 'OK', interprettext: true })) });

  it('add_node of a wireframe: Lua, no stamp, no Noto Sans', () => {
    const frames = compileOn(true, boardWith({}), [addCalendar, addRect]);
    for (const f of frames) expect(STAMP in f.changes).toBe(false);
    const { gens, fonts } = written(frames);
    expect(gens.length).toBeGreaterThan(0);
    for (const g of gens) expect(isJs(g['script'])).toBe(false);
    expect(gens.some((g) => g['script'] === luaSource('wireframe/calendar_min.lua'))).toBe(true);
    expect(fonts).not.toContain('Noto Sans');
  });

  it('the default form stamps 5.0, writes JS and Noto Sans (unchanged)', () => {
    const frames = compileOn(false, boardWith({}), [addCalendar, addRect]);
    expect(frames.filter((f) => STAMP in f.changes)).toHaveLength(1);
    const { gens, fonts } = written(frames);
    expect(gens.some((g) => isJs(g['script']))).toBe(true);
    expect(fonts).toContain('Noto Sans');
  });

  // `rewrites`: whether the op writes the template back (set_text does; set_style and
  // set_template_params write only their own keys in the Lua form, where nothing needs converting).
  it.each([
    ['set_text', { op: 'set_text', node: 'b1', text: 'Go' }, true],
    ['set_style', { op: 'set_style', node: 'b1', style: { fill: '#00ff00' } }, false],
    ['set_style (text)', { op: 'set_style', node: 'b1', style: { font_size: 20, text_color: '#ff0000' } }, false],
    ['set_template_params', { op: 'set_template_params', node: 'b1', params: { state: 'disabled' } }, false],
  ])('%s on a stored Lua wireframe keeps its own Lua and stamps nothing', (_name, op, rewrites) => {
    const frames = compileOn(true, stored(), [op]);
    for (const f of frames) expect(STAMP in f.changes).toBe(false);
    const gens = written(frames).gens;
    expect(gens.length > 0).toBe(rewrites);
    for (const g of gens) expect(g['script']).toBe(OLD_LUA);
    // The same op in the default form stamps 5.0 exactly when it writes the template (as JS).
    const js = compileOn(false, stored(), [op]);
    expect(js.filter((f) => STAMP in f.changes)).toHaveLength(written(js).gens.length > 0 ? 1 : 0);
  });

  it('group and ungroup with a stored Lua wireframe keep its Lua and stamp nothing', () => {
    const board = boardWith({
      b1: objectOf(buttonBody({ script: OLD_LUA, text: 'OK', interprettext: true })),
      b2: objectOf(luaButton('Two'), 300, 100, 2),
    });
    const grouped = compileOn(true, board, [{ op: 'group', ref: 'g', nodes: ['b1', 'b2'] }]);
    for (const f of grouped) expect(STAMP in f.changes).toBe(false);
    const gens = written(grouped).gens;
    expect(gens.length).toBeGreaterThan(0);
    for (const g of gens) expect(isJs(g['script'])).toBe(false);
    expect(gens.some((g) => g['script'] === OLD_LUA)).toBe(true);

    const member = (body: JsonObject, index: number, cx: number): JsonObject => ({
      index,
      orig_cx: cx,
      orig_cy: 100,
      orig_width: 80,
      orig_height: 28,
      orig_angle: 0,
      xfactor: 0,
      yfactor: 0,
      object: objectOf(body, cx, 100, index + 1),
    });
    const withGroup = boardWith({
      g1: {
        type: 'avabodh.basic.group',
        name: '',
        order: 100,
        params: { cx: 200, cy: 100, width: 280, height: 28, angle: 0, orig_width: 280, orig_height: 28 },
        objects: {
          m1: member(buttonBody({ script: OLD_LUA, text: 'OK', interprettext: true }), 0, 100),
          m2: member(luaButton('Two'), 1, 300),
        },
      },
    });
    const ungrouped = compileOn(true, withGroup, [{ op: 'ungroup', node: 'g1' }]);
    for (const f of ungrouped) expect(STAMP in f.changes).toBe(false);
    const back = written(ungrouped).gens;
    expect(back.length).toBeGreaterThan(0);
    for (const g of back) expect(isJs(g['script'])).toBe(false);
    expect(back.some((g) => g['script'] === OLD_LUA)).toBe(true);
    const js = compileOn(false, withGroup, [{ op: 'ungroup', node: 'g1' }]);
    expect(js.filter((f) => STAMP in f.changes)).toHaveLength(1);
  });
});

describe.runIf(existsSync(WIREFRAME_V4))('the generator (board_create_content) in the Lua form', () => {
  const content: JsonObject = {
    name: 'B',
    pages: [
      {
        name: 'P',
        nodes: [
          { ref: 'c', shape: CALENDAR, cx: 100, cy: 100 },
          { ref: 'r', shape: 'avabodh.basic.rectangle', text: 'Hi', cx: 400, cy: 100 },
        ],
      },
    ],
  };

  function created(lua: boolean, stencils = WIREFRAME_V4): JsonObject {
    const s = session(lua);
    s.addTemplates(wireframeBodies(stencils));
    const answer = generate(s, content);
    expect(answer['ok'], JSON.stringify(answer).slice(0, 300)).toBe(true);
    const out = JSON.parse(s.serialize({ stamp: 'cloud' })) as JsonObject;
    s.dispose();
    return out;
  }

  it('Lua form: 4.2, Lua scripts, no Noto Sans', () => {
    const doc = created(true);
    expect((doc['info'] as JsonObject)['version']).toBe('4.2');
    const gens = generators(doc);
    expect(gens.length).toBeGreaterThan(0);
    for (const g of gens) expect(isJs(g['script'])).toBe(false);
    expect(JSON.stringify(doc)).not.toContain('Noto Sans');
  });

  it.runIf(existsSync(WIREFRAME_V5))('Lua form over the v5 (JS) stencils: 4.2 and the pack Lua', () => {
    const doc = created(true, WIREFRAME_V5);
    expect((doc['info'] as JsonObject)['version']).toBe('4.2');
    const gens = generators(doc);
    expect(gens.length).toBeGreaterThan(0);
    for (const g of gens) expect(isJs(g['script'])).toBe(false);
    expect(gens.some((g) => g['script'] === luaSource('wireframe/calendar_min.lua'))).toBe(true);
  });

  it('default form: 5.0 and JS (unchanged)', () => {
    const doc = created(false);
    expect((doc['info'] as JsonObject)['version']).toBe('5.0');
    expect(generators(doc).some((g) => isJs(g['script']))).toBe(true);
  });
});
