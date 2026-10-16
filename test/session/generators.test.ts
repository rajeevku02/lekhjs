// Generators in a session (spec 04 §7.1, §7.3, §7.4, §9.4): conversion on every carrier
// (AC-GEN-17), in memory only for reads (AC-GEN-18, -19, AC-FMT-06), the writer's conversion frame
// once and never retried (AC-FMT-05, -24, -25), phantom pages left alone (AC-FMT-29), and the
// placeholder toast, diagnostics and `unknown_generator_seen` usage event (AC-GEN-16, AC-FMT-30).
import { describe, expect, it } from 'vitest';
import type { DiagnosticEvents } from '../../src/session';
import { BoardSession, type BoardMeta } from '../../src/session';
import { FakeImagePort, FakeScheduler, FakeTransport } from '../../src/testing';
import { LibraryItemCodec, StencilSetLoader } from '../../src/io';
import type { TemplatedObject } from '../../src/model';
import { updatetypes } from '../../src/sync';
import { isJsonObject, type JsonObject, type JsonValue } from '../../src/template';
import { BUTTON, PAGE, boardWith, buttonBody, jsText, luaButton, objectOf } from '../generators/helpers';
import { DOCID, frame } from '../sync/helpers';
import { testRuntime } from './helpers';

const JS = jsText('wireframe/button');

interface Open {
  readonly session: BoardSession;
  readonly transport: FakeTransport;
  readonly usage: DiagnosticEvents['usage'][];
  readonly unknown: DiagnosticEvents['unknown_generator'][];
  readonly toasts: string[];
}

function open(board: JsonObject, meta: Partial<BoardMeta> = {}, transport = new FakeTransport()): Open {
  const cloud = meta.kind !== 'offline';
  const session = new BoardSession(testRuntime(), {
    images: new FakeImagePort(),
    scheduler: new FakeScheduler(),
    ...(cloud ? { transport } : {}),
  });
  const usage: Open['usage'] = [];
  const unknown: Open['unknown'] = [];
  const toasts: string[] = [];
  session.diagnostics.on('usage', (e) => usage.push(e));
  session.diagnostics.on('unknown_generator', (e) => unknown.push(e));
  session.on('toast', (t) => toasts.push(t.message));
  const m: BoardMeta = cloud ? { kind: 'cloud', docid: DOCID, version: 3, ...meta } : { kind: 'offline' };
  session.dispatch({ type: 'open', raw: board, meta: m });
  return { session, transport, usage, unknown, toasts };
}

function liveGenerator(s: BoardSession, id: string, page = PAGE): JsonObject | undefined {
  const o = s.document.getPage(page)?.objectStore.getObject(id) as TemplatedObject | null;
  return o?.shapeTemplate()?.generator?.toJSON();
}

function changesOf(f: Record<string, unknown>): Record<string, JsonValue> {
  const u = f['updates'] as { type: string; changes: Record<string, JsonValue> };
  return u.changes;
}

const luaBoard = () =>
  boardWith(
    { b1: objectOf(luaButton('One'), 50, 50, 1), b2: objectOf(luaButton('Two'), 200, 50, 2) },
    { templates: { avabodh_wireframe_button: luaButton('Doc') } },
  );

describe('the writer’s conversion frame (AC-FMT-05)', () => {
  it('a writer open sends one stamped changeattr: doc templates first, then objects in order', () => {
    const o = open(luaBoard(), { permission: 'write' });
    const frames = o.transport.frames();
    expect(frames.length).toBe(1);
    const f = frames[0] ?? {};
    expect((f['updates'] as { type: string }).type).toBe(updatetypes.changeAttr);
    // No conditions (the envelope's `conditions` is empty).
    const conditions = (f['updates'] as { conditions?: object }).conditions ?? {};
    expect(Object.keys(conditions)).toEqual([]);
    // The doc template is in the (first and only) chunk; the frame's keys are written sorted.
    const keys = Object.keys(changesOf(f)).sort();
    expect(keys).toEqual([
      'doc.info.version',
      `doc.pages.${PAGE}.objects.b1.template`,
      `doc.pages.${PAGE}.objects.b2.template`,
      'doc.templates.avabodh_wireframe_button',
    ]);
    const c = changesOf(f);
    expect(c['doc.info.version']).toBe('5.0');
    for (const k of keys.filter((x) => x !== 'doc.info.version'))
      expect(((c[k] as JsonObject)['generator'] as JsonObject)['script']).toBe(JS);
    expect(o.session.sync.isStamped()).toBe(true);
    // The conversion frame is not an undo step.
    expect(o.session.editor.undo.canUndo()).toBe(false);
  });

  it('a board with no Lua sends nothing', () => {
    const o = open(boardWith({ b1: objectOf(buttonBody({ script: JS, text: 'x', interprettext: true })) }), {
      permission: 'write',
    });
    expect(o.transport.sent).toEqual([]);
  });
});

describe('read-only sessions and permission changes (AC-FMT-06, AC-FMT-24)', () => {
  it.each(['read', 'comment', undefined] as const)('permission %s: converted in memory, no frame', (permission) => {
    const o = open(luaBoard(), permission === undefined ? {} : { permission });
    expect(liveGenerator(o.session, 'b1')?.['script']).toBe(JS);
    expect(o.transport.sent).toEqual([]);
    expect(o.session.sync.isStamped()).toBe(false);
  });

  it('raised to write: the conversion frame goes once, at that moment', () => {
    const o = open(luaBoard(), { permission: 'read' });
    o.session.dispatch({ type: 'permissionChanged', permission: 'write' });
    expect(o.transport.sent.length).toBe(1);
    o.session.dispatch({ type: 'permissionChanged', permission: 'read' });
    o.session.dispatch({ type: 'permissionChanged', permission: 'write' });
    expect(o.transport.sent.length).toBe(1);
  });
});

describe('no retry (AC-FMT-25)', () => {
  it('a chunk the transport drops is not sent again in that session; the next writer open converts', () => {
    const closed = new FakeTransport('closed');
    const o = open(luaBoard(), { permission: 'write' }, closed);
    expect(closed.sent).toEqual([]);
    closed.setState('open');
    o.session.dispatch({ type: 'transportState', state: { state: 'open', at: 0 } });
    o.session.dispatch({ type: 'permissionChanged', permission: 'write' });
    expect(closed.sent).toEqual([]);
    // The stored board still holds Lua: the next writer open converts it.
    const next = open(luaBoard(), { permission: 'write' });
    expect(next.transport.sent.length).toBe(1);
  });

  it('a load frame (a reload) is an open: a writer converts what it brought', () => {
    const o = open(boardWith({}), { permission: 'write' });
    expect(o.transport.sent).toEqual([]);
    o.transport.deliver(frame(updatetypes.load, { doc: luaBoard() }, 9));
    expect(o.transport.sent.length).toBe(1);
  });
});

describe('phantom pages (AC-FMT-29)', () => {
  it('a board whose only page is a phantom is stored unchanged by a writer open', () => {
    const board = {
      ...boardWith({}),
      pages: { ghost: { objects: { g1: objectOf(luaButton('Ghost')) } } },
    };
    const o = open(board, { permission: 'write' });
    expect(o.session.document.pages.map((p) => p.name)).toEqual(['Recovered']);
    expect(liveGenerator(o.session, 'g1', 'ghost')?.['script']).toBe(JS);
    expect(o.transport.sent).toEqual([]);
  });

  it('two phantom pages are "Recovered" and "Recovered 2"; only the real page converts', () => {
    const board = boardWith(
      { b1: objectOf(luaButton('Real')) },
      { extraPages: { p2: { objects: { x: objectOf(luaButton()) } }, p3: { objects: {} } } },
    );
    const o = open(board, { permission: 'write' });
    expect(o.session.document.pages.map((p) => p.name)).toEqual(['Page 1', 'Recovered', 'Recovered 2']);
    const keys = Object.keys(changesOf(o.transport.frames()[0] ?? {})).sort();
    expect(keys).toEqual(['doc.info.version', `doc.pages.${PAGE}.objects.b1.template`].sort());
  });
});

describe('placeholders in a session (AC-GEN-16, AC-FMT-30)', () => {
  const unknownBoard = () =>
    boardWith({
      u1: objectOf({ ...luaButton('a'), id: 'avabodh.wireframe.gone' }),
      u2: objectOf(buttonBody({ type: 'native', shape: 'bpmn.nope' })),
      u3: objectOf(buttonBody({ script: JS, text: 'x' }, { id: 'acme.widget' })),
    });

  it('one usage event per open with counts and reasons, one toast, a diagnostic per shape', () => {
    const o = open(unknownBoard(), { permission: 'write' });
    expect(o.usage).toEqual([
      {
        name: 'unknown_generator_seen',
        count: 3,
        reasons: ['js_unknown_id', 'lua_unknown_id', 'unknown_native_shape'],
      },
    ]);
    expect(JSON.stringify(o.usage)).not.toContain('avabodh');
    expect(o.toasts).toEqual([
      "Some shapes on this board can't be shown by this version of Lekh. They are kept unchanged.",
    ]);
    expect(o.unknown.map((u) => [u.objectId, u.reason])).toEqual([
      ['u1', 'lua_unknown_id'],
      ['u2', 'unknown_native_shape'],
      ['u3', 'js_unknown_id'],
    ]);
    // A placeholder alone never converts or stamps the board.
    expect(o.transport.sent).toEqual([]);
    expect(o.session.sync.isStamped()).toBe(false);
    // A reload in the same open does not report again.
    o.transport.deliver(frame(updatetypes.load, { doc: unknownBoard() }, 9));
    expect(o.usage.length).toBe(1);
    expect(o.toasts.length).toBe(1);
  });

  it('never without a placeholder', () => {
    const o = open(luaBoard(), { permission: 'write' });
    expect(o.usage).toEqual([]);
    expect(o.toasts).toEqual([]);
    expect(o.unknown).toEqual([]);
  });

  it('the first placeholder a frame brings reports then', () => {
    const o = open(luaBoard(), { permission: 'read' });
    o.transport.deliver(
      frame(updatetypes.addObjects, { [`doc.pages.${PAGE}.objects.n1`]: objectOf({ ...luaButton(), id: 'x.y' }) }, 8),
    );
    expect(o.usage).toEqual([{ name: 'unknown_generator_seen', count: 1, reasons: ['lua_unknown_id'] }]);
    expect(o.toasts.length).toBe(1);
  });
});

describe('every carrier converts (AC-GEN-17)', () => {
  const isJs = (g: JsonObject | undefined) => g?.['script'] === JS;

  it('offline open, without marking the document changed (AC-GEN-18); the save writes JS', () => {
    const o = open(luaBoard(), { kind: 'offline' });
    expect(isJs(liveGenerator(o.session, 'b1'))).toBe(true);
    expect(o.session.editor.undo.canUndo()).toBe(false);
    const saved = o.session.serialize({ stamp: 'offline' });
    expect(saved).toContain(JSON.stringify(JS).slice(1, -1));
    expect(saved).not.toContain('function generate(a,b)');
    expect((JSON.parse(saved) as { info: { version: string } }).info.version).toBe('5.0');
  });

  it('realtime: addobjects (objects and doc.templates), changeattr …template, an arrowhead', () => {
    const o = open(boardWith({ b1: objectOf(luaButton()) }), { permission: 'read' });
    o.transport.deliver(
      frame(
        updatetypes.addObjects,
        {
          'doc.templates.acme_lua': { ...luaButton('T'), id: BUTTON },
          [`doc.pages.${PAGE}.objects.n1`]: objectOf(luaButton('New')),
        },
        8,
      ),
    );
    expect(isJs(liveGenerator(o.session, 'n1'))).toBe(true);
    expect(isJs((o.session.document.get(BUTTON)?.json['generator'] ?? undefined) as JsonObject | undefined)).toBe(true);
    o.transport.deliver(
      frame(updatetypes.changeAttr, { [`doc.pages.${PAGE}.objects.b1.template`]: luaButton('Changed') }, 9),
    );
    const g = liveGenerator(o.session, 'b1');
    expect(isJs(g)).toBe(true);
    expect(g?.['text']).toBe('Changed');
    const arrowed = { ...objectOf(buttonBody({ script: JS, text: 'a' })), arrows: { start: luaButton('Head') } };
    o.transport.deliver(frame(updatetypes.addObjects, { [`doc.pages.${PAGE}.objects.n2`]: arrowed }, 10));
    const n2 = o.session.document.getPage(PAGE)?.objectStore.getObject('n2') as TemplatedObject | null;
    const written = n2 === null ? undefined : o.session.codec.writeObject(n2);
    const arrows = written?.['arrows'];
    const head = isJsonObject(arrows) ? arrows['start'] : undefined;
    expect(isJs((head as JsonObject | undefined)?.['generator'] as JsonObject | undefined)).toBe(true);
    // A read-only session sends nothing for what it converted.
    expect(o.transport.sent).toEqual([]);
  });

  it('a writer converts the Lua an old peer’s frame brought, stamped', () => {
    const o = open(boardWith({}), { permission: 'write' });
    o.transport.deliver(
      frame(updatetypes.addObjects, { [`doc.pages.${PAGE}.objects.n1`]: objectOf(luaButton('Old')) }, 8),
    );
    const f = o.transport.frames();
    expect(f.length).toBe(1);
    expect(Object.keys(changesOf(f[0] ?? {})).sort()).toEqual(
      ['doc.info.version', `doc.pages.${PAGE}.objects.n1.template`].sort(),
    );
  });

  it('a stencil file and a user library item; reading an item never rewrites it (AC-GEN-19)', () => {
    const o = open(boardWith({}), { kind: 'offline' });
    const lib = { library: [{ id: 'my.lib', name: 'Mine', objects: [objectOf(luaButton('Lib'))] }] };
    const cats = StencilSetLoader.loadValue(lib, o.session.overlay);
    const item = cats[0]?.items[0]?.object?.['template'] as JsonObject | undefined;
    expect(isJs(item?.['generator'] as JsonObject | undefined)).toBe(true);
    expect(isJs(o.session.overlay.get(BUTTON)?.json['generator'] as JsonObject | undefined)).toBe(true);
    const items = new LibraryItemCodec(o.session.codec);
    const blob = { library: [{ id: 'user.lib', name: 'U', objects: [objectOf(luaButton('User'))] }] };
    const before = JSON.stringify(blob);
    const read = items.readItem(blob.library[0]?.objects[0] ?? null);
    const t = (read.object as TemplatedObject).shapeTemplate();
    expect(isJs(t?.generator?.toJSON())).toBe(true);
    items.ingest(blob, o.session.overlay);
    expect(JSON.stringify(blob)).toBe(before);
    // Saving an item from TS writes JS (AC-GEN-24).
    const saved = items.writeItem(read.object);
    expect(isJs((saved['template'] as JsonObject)['generator'] as JsonObject)).toBe(true);
  });

  it('paste of a Lua payload (another app’s clipboard): JS in memory, and the addobjects frame is stamped', () => {
    const o = open(boardWith({}), { permission: 'write' });
    const ok = o.session.clipboard.load({ templates: [], object: objectOf(luaButton('Pasted')) });
    expect(ok).toBe(true);
    o.session.registerCommand('paste', (ctx) => {
      ctx.clipboard.paste();
    });
    o.session.dispatch({ type: 'command', origin: 'ui', command: { kind: 'custom', name: 'paste' } });
    const objs = o.session.document.getPage(PAGE)?.objectStore.objects ?? [];
    expect(objs.length).toBe(1);
    const g = (objs[0] as TemplatedObject).shapeTemplate()?.generator?.toJSON();
    expect(isJs(g)).toBe(true);
    const frames = o.transport.frames();
    expect(frames.length).toBe(1);
    expect(changesOf(frames[0] ?? {})['doc.info.version']).toBe('5.0');
  });
});
