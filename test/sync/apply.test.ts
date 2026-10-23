// Incoming frames (spec 03 §11.2): decoding, the docid check, every update type, transactional
// apply (B4, AC-ENG-13), the version rules (B2, B3), non-finite literals (AC-ENG-32) and the stamp
// key in any update type (AC-FMT-08).
import { describe, expect, it } from 'vitest';
import type { ConnectionObject, TemplatedObject } from '../../src/model';
import { FrameCodec, UpdateDecoder, updatetypes } from '../../src/sync';
import { A, B, C, DOCID, P, board, fixtureJson, frame } from './helpers';

const obj = (b: ReturnType<typeof board>, id: string) => b.doc.getPage(P)?.objectStore.getObject(id) ?? null;
const prefix = `doc.pages.${P}.objects.`;

describe('FrameCodec', () => {
  it('reads an update frame with changes in key order and the user', () => {
    const text = JSON.stringify({
      version: 3,
      docid: 'd',
      type: 'update',
      user: { id: '42', name: 'n' },
      updates: { type: 'changeattr', changes: { 'b.x': 1, 'a.x': 2, '10': 3 }, conditions: {} },
    });
    const r = FrameCodec.decode(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.frame.version).toBe(3);
    expect(r.frame.user).toEqual({ id: '42', name: 'n' });
    expect(r.frame.update?.changes.map(([k]) => k)).toEqual(['10', 'a.x', 'b.x']);
  });

  it.each([
    ['not json', '{'],
    ['no docid', JSON.stringify({ type: 'update', updates: {} })],
    ['no type', JSON.stringify({ docid: 'd' })],
    ['updates not an object', JSON.stringify({ docid: 'd', type: 'update', updates: 3 })],
    ['no changes', JSON.stringify({ docid: 'd', type: 'update', updates: { type: 'x' } })],
    ['an unescaped key', '{"docid":"d","type":"update","updates":{"type":"x","changes":{"a"b":1}}}'],
  ])('%s → frame_parse', (_n, text) => {
    expect(FrameCodec.decode(text)).toMatchObject({ ok: false, code: 'frame_parse' });
  });

  it('encodes { version, docid, type, updates: { changes, conditions, pointer?, type } } with sorted keys', () => {
    const t = FrameCodec.encode(5, 'd', { type: 'changeattr', changes: { z: 1, a: null } });
    expect(t).toBe(
      '{"docid":"d","type":"update","updates":{"changes":{"a":null,"z":1},"conditions":{},"type":"changeattr"},"version":5}',
    );
    const p = FrameCodec.encode(0, 'd', { type: 'trackpointer', changes: {}, pointers: [{ x: 1, y: 2 }] });
    expect(JSON.parse(p)).toMatchObject({ updates: { pointer: [{ x: 1, y: 2 }] } });
  });

  it('a C++ peer’s nan/inf read as 0 (lenient fallback)', () => {
    const r = FrameCodec.decode(
      '{"docid":"d","type":"update","version":1,"updates":{"type":"changeattr","changes":{"k":nan,"j":-inf}}}',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.frame.nonFinite).toBe(2);
      expect(r.frame.update?.changes).toEqual([
        ['j', 0],
        ['k', 0],
      ]);
    }
  });
});

describe('UpdateDecoder: what C++ ignored stays ignored', () => {
  const dec = (type: string, changes: Record<string, unknown>) =>
    UpdateDecoder.decode({ type, changes: Object.entries(changes) as never, conditions: [], pointers: [] });

  it('a changeattr key shorter than six segments makes the whole frame a no-op', () => {
    expect(dec(updatetypes.changeAttr, { [`${prefix}${A}.params.cx`]: 1, 'doc.x.y': 2 })).toBeNull();
  });

  it('a load with two changes, a non-doc key or a non-object value is ignored; an empty one is rejected (B3)', () => {
    expect(dec(updatetypes.load, { doc: {}, x: {} })).toBeNull();
    expect(dec(updatetypes.load, { 'doc.pages': {} })).toBeNull();
    expect(dec(updatetypes.load, { doc: 3 })).toBeNull();
    const empty = dec(updatetypes.load, {});
    expect(empty?.validate({} as never)).toBe(false);
  });

  it('an unknown type is ignored', () => {
    expect(dec('nonsense', { a: 1 })).toBeNull();
  });
});

describe('SyncSession.receive: each update type', () => {
  const json = () => fixtureJson('format/03-connector.lekh');

  it('changeattr: params, order, template', () => {
    const b = board(json());
    const tmpl = (b.io.codec.writeObject(obj(b, A) as TemplatedObject) as { template: unknown }).template as Record<
      string,
      unknown
    >;
    const out = b.sync.receive(
      frame(updatetypes.changeAttr, {
        [`${prefix}${A}.params.cx`]: 333,
        [`${prefix}${A}.params.width`]: 50,
        [`${prefix}${A}.order`]: 99,
        [`${prefix}${B}.template`]: { ...tmpl, texts: [{ location: 'default', text: 'Changed' }] },
      }),
    );
    expect(out.kind).toBe('applied');
    const a = obj(b, A) as TemplatedObject;
    expect(a.ds.cx()).toBe(333);
    expect(a.ds.width()).toBe(50);
    expect(a.order).toBe(99);
    expect((obj(b, B) as TemplatedObject).shapeTemplate()?.textData[0]?.text).toBe('Changed');
    expect(b.sync.version).toBe(7);
  });

  it('addobjects (object, template, help) and delobjects; a connector to an end in the frame resolves', () => {
    const b = board(json());
    const shape = b.io.codec.writeObject(obj(b, A) as TemplatedObject);
    const con = b.io.codec.writeObject(obj(b, C) as ConnectionObject) as Record<string, unknown>;
    const out = b.sync.receive(
      frame(updatetypes.addObjects, {
        [`${prefix}N1`]: { ...shape, order: 10 },
        [`${prefix}N2`]: { ...con, source: 'N1', target: B, order: 11 },
        'doc.templates.my_t': { id: 'my.t', data: ['0', '0', '1', '1'], draw: ['M 0 1 L 2 3'] },
        'doc.help.my_t': { id: 'my.t', text: 'hello' },
      }),
    );
    expect(out).toMatchObject({ kind: 'applied', result: { changedIds: ['N1', 'N2'] } });
    expect((obj(b, 'N2') as ConnectionObject).first?.id).toBe('N1');
    expect(b.doc.hasTemplate('my.t')).toBe(true);
    expect(b.io.env.help?.('my.t')).toBe('hello');

    b.sync.receive(frame(updatetypes.delObjects, { [`${prefix}N1`]: null, [`${prefix}gone`]: null }, 8));
    expect(obj(b, 'N1')).toBeNull();
    expect(b.sync.version).toBe(8);
  });

  it('addobjects: a shape embedding a document template that arrives in the same frame shows the embed (UF4)', () => {
    // C++ AddDelObjectsUpdateAction::apply (UpdateAction.cpp:94-107) adds the frame's
    // doc.templates.* to the document before it parses the objects (:122), so the shape's embed
    // resolves. The receiver used to parse the objects in validate, before the templates were in
    // the document: the embed was dropped until the board was reopened.
    const b = board(json());
    const shape = b.io.codec.writeObject(obj(b, A) as TemplatedObject) as Record<string, unknown>;
    const tmpl = shape['template'] as Record<string, unknown>;
    const out = b.sync.receive(
      frame(updatetypes.addObjects, {
        [`${prefix}N1`]: {
          ...shape,
          order: 10,
          template: { ...tmpl, id: 'lib.outer', embeds: [{ name: 'lib.inner.icon', location: '0 0 20 20 0' }] },
        },
        'doc.templates.lib_inner_icon': {
          id: 'lib.inner.icon',
          data: ['-w/2', '-h/2', 'w/2', 'h/2'],
          draw: ['M 0 1 L 2 3'],
        },
      }),
    );
    expect(out.kind).toBe('applied');
    expect(b.doc.hasTemplate('lib.inner.icon')).toBe(true);
    const n1 = obj(b, 'N1') as TemplatedObject;
    expect(
      n1
        .shapeTemplate()
        ?.embeds()
        .map((e) => e.template.id()),
    ).toEqual(['lib.inner.icon']);
  });

  it('delallobjects clears the page', () => {
    const b = board(json());
    const out = b.sync.receive(frame(updatetypes.delAllObjects, { [`doc.pages.${P}.objects`]: {} }));
    expect(out).toMatchObject({ kind: 'applied', result: { removedIds: [A, B, C] } });
    expect(b.doc.getPage(P)?.objectStore.size).toBe(0);
  });

  it('convertobjects deletes and adds in one frame', () => {
    const b = board(json());
    const shape = b.io.codec.writeObject(obj(b, A) as TemplatedObject);
    b.sync.receive(
      frame(updatetypes.convertObjects, { [`${prefix}${A}`]: null, [`${prefix}${C}`]: null, [`${prefix}G`]: shape }),
    );
    expect(obj(b, A)).toBeNull();
    expect(obj(b, 'G')).not.toBeNull();
  });

  it('changearrow applies but, as C++, does not take the version', () => {
    const b = board(json());
    b.sync.receive(frame(updatetypes.changeArrow, { [`${prefix}${C}.arrows.end`]: null }, 12));
    expect((obj(b, C) as ConnectionObject).arrows.end()).toBeNull();
    expect(b.sync.version).toBe(0);
  });

  it('changetemplateparams, changegrid, changescaling, changebackground', () => {
    const b = board(json());
    b.sync.receive(frame(updatetypes.changeTemplateParams, { [`${prefix}${A}.template.params`]: { k: 3 } }));
    expect((obj(b, A) as TemplatedObject).shapeTemplate()?.params.map((p) => [p.name, p.value])).toEqual([['k', 3]]);
    b.sync.receive(frame(updatetypes.changeGrid, { 'doc.attributes.grid.present': false }));
    expect(b.doc.grid.present).toBe(false);
    b.sync.receive(frame(updatetypes.changeScaling, { 'doc.attributes.scaling': { scale: 2, unit: 'inch' } }));
    expect(b.doc.scaling.value).toBe(2);
    const out = b.sync.receive(
      frame(updatetypes.changeBackground, { [`doc.pages.${P}.background`]: { color: -65536 } }),
    );
    expect(out).toMatchObject({ result: { backgroundChanged: true } });
    expect(b.doc.getPage(P)?.background.color.red).toBe(255);
  });

  it('changeconnectionparams and changeconnectiontexts', () => {
    const b = board(json());
    b.sync.receive(
      frame(updatetypes.changeConnectionParams, {
        [`${prefix}${C}.ctype`]: 0,
        [`${prefix}${C}.params`]: [{ angle: 1 }, { angle: 2 }],
      }),
    );
    const c = obj(b, C) as ConnectionObject;
    expect(c.getType()).toBe(0);
    b.sync.receive(
      frame(updatetypes.changeConnectionTexts, { [`${prefix}${C}.texts`]: [{ text: 'hi', param: 0.25 }] }),
    );
    expect(c.textInfos().map((t) => [t.text, t.param])).toEqual([['hi', 0.25]]);
  });

  it('changestyle on a template style and a plain style', () => {
    const b = board(json());
    b.sync.receive(
      frame(updatetypes.changeStyle, {
        [`${prefix}${A}.template.style.strokewidth`]: 7,
        [`${prefix}${C}.style.strokewidth`]: 3,
      }),
    );
    expect(obj(b, A)?.getDrawingProfile().effectiveStrokeWidth()).toBe(7);
    expect(obj(b, C)?.getDrawingProfile().effectiveStrokeWidth()).toBe(3);
  });

  it('addpages, delpages and changepageattr (order keeps the active page)', () => {
    const b = board(fixtureJson('format/05-multi-page.lekh'));
    const ids = b.doc.pages.map((p) => p.id);
    const first = ids[0] as string;
    b.sync.receive(frame(updatetypes.addPages, { 'doc.pages.NEW': { name: 'New', order: 50, objects: {} } }));
    expect(b.doc.getPage('NEW')?.name).toBe('New');
    b.sync.receive(
      frame(updatetypes.changePageAttr, {
        [`doc.pages.${first}.order`]: 100,
        [`doc.pages.${first}.name`]: 'Renamed',
        [`doc.pages.${first}.size`]: { width: 300, height: 200, unit: 'point' },
        [`doc.pages.${first}.canvassizetype`]: 'fixed',
      }),
    );
    const p = b.doc.getPage(first);
    expect(p?.name).toBe('Renamed');
    expect(p?.size.width).toBe(300);
    expect(b.doc.pages[b.doc.pages.length - 1]?.id).toBe(first);
    expect(b.doc.activePage().id).toBe(first);
    b.sync.receive(frame(updatetypes.delPages, { 'doc.pages.NEW': null }));
    expect(b.doc.getPage('NEW')).toBeNull();
  });

  it('a load replaces the document and takes its version (B2 reset)', () => {
    const b = board(fixtureJson('format/03-connector.lekh'), { version: 4 });
    expect(b.sync.version).toBe(4);
    const before = b.doc;
    const out = b.sync.receive(frame(updatetypes.load, { doc: fixtureJson('format/02-one-shape.lekh') }, 40));
    expect(out).toMatchObject({ kind: 'applied', result: { reloaded: true } });
    expect(b.doc).not.toBe(before);
    expect(b.sync.version).toBe(40);
  });
});

describe('transactional apply (B4, AC-ENG-13)', () => {
  it.each([
    [
      'changeattr: one object missing',
      updatetypes.changeAttr,
      { [`${prefix}${A}.params.cx`]: 1, [`${prefix}nope.params.cx`]: 2 },
    ],
    [
      'changeattr: a non-number param',
      updatetypes.changeAttr,
      { [`${prefix}${A}.params.cx`]: 1, [`${prefix}${B}.params.cy`]: 'x' },
    ],
    [
      'changeattr: a non-integer order',
      updatetypes.changeAttr,
      { [`${prefix}${A}.params.cx`]: 1, [`${prefix}${B}.order`]: 1.5 },
    ],
    [
      'addobjects: an object that does not parse',
      updatetypes.addObjects,
      { [`${prefix}N1`]: { type: 'templated', params: {} }, [`${prefix}N2`]: { type: 'nope' } },
    ],
    [
      'addobjects: a connector to nowhere',
      updatetypes.addObjects,
      { [`${prefix}N1`]: { type: 'avabodh.basic.connection', ctype: 1, source: 'x', target: 'y' } },
    ],
    ['addobjects: an unknown page', updatetypes.addObjects, { 'doc.pages.nopage.objects.N1': { type: 'templated' } }],
    ['changeconnectionparams: a bad ctype', updatetypes.changeConnectionParams, { [`${prefix}${C}.ctype`]: 7 }],
  ])('%s → nothing applied, version kept, frame_rejected', (_n, type, changes) => {
    const b = board(fixtureJson('format/03-connector.lekh'), { version: 3 });
    const before = b.text();
    const errors: string[] = [];
    b.sync.on('syncError', (e) => errors.push(e.code));
    const out = b.sync.receive(frame(type, changes));
    expect(out.kind).toBe('rejected');
    expect(b.text()).toBe(before);
    expect(b.sync.version).toBe(3);
    expect(errors).toEqual(['frame_rejected']);
    expect(b.io.logs.some((l) => l.m === 'frame_rejected')).toBe(true);
  });
});

describe('frame rules', () => {
  it('a frame for another docid is dropped (frame_docid_mismatch)', () => {
    const b = board(fixtureJson('format/03-connector.lekh'));
    expect(b.sync.receive(frame(updatetypes.changeGrid, { 'doc.attributes.grid.present': false }, 2, 'other'))).toEqual(
      {
        kind: 'dropped',
        code: 'frame_docid_mismatch',
      },
    );
    expect(b.doc.grid.present).toBe(true);
  });

  it('a server message envelope surfaces as an event', () => {
    const b = board(fixtureJson('format/03-connector.lekh'));
    const seen: string[] = [];
    b.sync.on('serverMessage', (m) => seen.push(m.code));
    b.sync.receive(
      JSON.stringify({
        docid: DOCID,
        type: 'message',
        message: { code: 'board_requires_newer_app', message: 'x', reload: true, arg: '' },
      }),
    );
    expect(seen).toEqual(['board_requires_newer_app']);
  });

  it('nan/inf from a C++ peer apply as 0 and log nonfinite_read (AC-ENG-32)', () => {
    const b = board(fixtureJson('format/03-connector.lekh'));
    const text = frame(updatetypes.changeAttr, { [`${prefix}${A}.params.cx`]: 12345 }).replace('12345', 'nan');
    expect(b.sync.receive(text).kind).toBe('applied');
    expect((obj(b, A) as TemplatedObject).ds.cx()).toBe(0);
    expect(b.io.logs.some((l) => l.m === 'nonfinite_read')).toBe(true);
  });

  it('an unescaped key drops the frame and leaves the document as it was (AC-ENG-32)', () => {
    const b = board(fixtureJson('format/03-connector.lekh'));
    const before = b.text();
    const text = frame(updatetypes.changeAttr, { [`${prefix}${A}.params.cx`]: 1 }).replace(
      `${A}.params`,
      `${A}"x.params`,
    );
    expect(b.sync.receive(text)).toEqual({ kind: 'dropped', code: 'frame_parse' });
    expect(b.text()).toBe(before);
  });

  it('doc.info.version is accepted in any update type and the rest applies (AC-FMT-08)', () => {
    const b = board(fixtureJson('format/03-connector.lekh'));
    expect(b.sync.stamper.docFormat).toBe('4.2');
    b.sync.receive(frame(updatetypes.changeAttr, { [`${prefix}${A}.params.cx`]: 77, 'doc.info.version': '5.0' }));
    expect((obj(b, A) as TemplatedObject).ds.cx()).toBe(77);
    expect(b.sync.stamper.docFormat).toBe('5.0');
    const b2 = board(fixtureJson('format/03-connector.lekh'));
    b2.sync.receive(frame(updatetypes.changeGrid, { 'doc.attributes.grid.present': false, 'doc.info.version': '5.0' }));
    expect(b2.doc.grid.present).toBe(false);
    expect(b2.sync.stamper.docFormat).toBe('5.0');
  });

  it('a stamp above this engine’s latest asks for a reload', () => {
    const b = board(fixtureJson('format/03-connector.lekh'));
    const seen: string[] = [];
    b.sync.on('formatTooNew', (e) => seen.push(e.version));
    b.sync.receive(frame(updatetypes.changeGrid, { 'doc.attributes.grid.present': false, 'doc.info.version': '6.0' }));
    expect(seen).toEqual(['6.0']);
  });

  it('trackpointer frames go to presence and keep the version', () => {
    const b = board(fixtureJson('format/03-connector.lekh'), { version: 2 });
    const text = JSON.stringify({
      version: 0,
      docid: DOCID,
      type: 'update',
      user: { id: '5', name: 'x' },
      updates: { type: 'trackpointer', changes: {}, pointer: [{ x: 1, y: 2 }] },
    });
    expect(b.sync.receive(text).kind).toBe('presence');
    expect(b.sync.presence.hasPoints()).toBe(true);
    expect(b.sync.version).toBe(2);
  });
});
