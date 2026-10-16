// Legacy object types (spec 03 §10.4): a JSON board with each of the eight types loads, converts
// and round-trips to the same templated objects (AC-ENG-21); by every load path — file, cloud
// `load`, paste, library item, and XML (xml.test.ts) — no object of a legacy type is held and
// `serialize()` writes none (AC-ENG-35, OQ-14).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_TYPE_NAMES, LibraryItemCodec } from '../../src/io';
import type { TemplatedObject } from '../../src/model';
import { ConnectionObject, UnrecognizedObject, type LekhDocument, type LekhObject } from '../../src/model';
import type { JsonValue, JsonObject } from '../../src/template';
import { IO_FIXTURES, LIVE_NAMES, allObjects, readText, testIo, typesIn } from './helpers';

const TEXT = readText(path.join(IO_FIXTURES, 'legacy-json-types.lekh'));
const FILE = JSON.parse(TEXT) as JsonObject;
const OBJECTS = Object.values(FILE['pages'] as Record<string, JsonObject>)[0]?.['objects'] as Record<
  string,
  JsonObject
>;
const id = (n: number) => `c1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Asserts that `objs` holds only live kinds and that writing them names no legacy type. */
function expectNoLegacy(objs: readonly LekhObject[], written: JsonValue): void {
  for (const o of objs) expect(LIVE_NAMES).toContain(o.name());
  expect(typesIn(written).filter((t) => LEGACY_TYPE_NAMES.includes(t))).toEqual([]);
}

/** What a converted object is, for comparing two loads. */
function shape(o: LekhObject): Record<string, unknown> {
  if (o instanceof ConnectionObject) {
    return {
      kind: 'connector',
      type: o.getType(),
      params: o.getParams(),
      ends: [o.first?.id, o.second?.id],
      arrows: [o.arrows.start()?.id() ?? null, o.arrows.end()?.id() ?? null],
      stroke: o.drawingProfile.effectiveStrokeWidth(),
    };
  }
  const t = o as TemplatedObject;
  const st = t.shapeTemplate();
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    kind: o.name(),
    template: st?.id() ?? null,
    box: [r(t.ds.cx()), r(t.ds.cy()), r(t.ds.width()), r(t.ds.height()), r(t.ds.angle())],
    texts: st?.textData.map((x) => x.text) ?? [],
    data: st?.dataExpStrs ?? [],
    stroke: t.getDrawingProfile().effectiveStrokeWidth(),
    strokePaint: t.getDrawingProfile().effectiveStrokePaint().solidColor.toInt(),
    fill: t.getDrawingProfile().effectiveFillPaint().type,
    fontSize: t.getDrawingProfile().effectiveFontSize(),
    arrows: [t.arrows.start()?.id() ?? null, t.arrows.end()?.id() ?? null],
  };
}

const byOrder = (doc: LekhDocument) => doc.activePage().objectStore.objects.slice();

describe('JSON legacy types load and convert (AC-ENG-21)', () => {
  const io = testIo();
  const res = io.codec.read(TEXT);
  const objs = byOrder(res.doc);
  const get = (n: number) => objs.find((o) => o.id === id(n));

  it('every object loads, in its stored order, with its id', () => {
    expect(objs.map((o) => o.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id));
    expect(objs.map((o) => o.order)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    expect(res.warnings).toContainEqual({ code: 'legacy_converted', count: 9 });
  });

  it('circle → ellipse template in its integer-truncated selection box', () => {
    const o = get(1) as TemplatedObject;
    expect(o.shapeTemplate()?.id()).toBe('avabodh.basic.ellipse');
    // C++ CircleObject::getSelectionRectangle: (int)(cx - r - 1), (int)(2r + 2).
    expect([o.ds.cx(), o.ds.cy(), o.ds.width(), o.ds.height()]).toEqual([100, 80, 62, 62]);
    expect(o.shapeTemplate()?.textData[0]?.text).toBe('Circle');
    expect(o.getDrawingProfile().effectiveStrokeWidth()).toBe(3);
  });

  it('ellipse, text and image → their catalog templates', () => {
    const e = get(2) as TemplatedObject;
    expect(e.shapeTemplate()?.id()).toBe('avabodh.basic.ellipse');
    expect([e.ds.width(), e.ds.height(), e.ds.angle()]).toEqual([120, 60, 0.3]);
    const t = get(7) as TemplatedObject;
    expect(t.shapeTemplate()?.id()).toBe('avabodh.basic.text');
    expect(t.shapeTemplate()?.textData[0]?.text).toBe('Free text');
    expect(t.ds.angle()).toBe(0.5);
    expect(t.getDrawingProfile().effectiveFontSize()).toBe(18);
    const im = get(8) as TemplatedObject;
    expect(im.shapeTemplate()?.id()).toBe('avabodh.basic.image');
    expect(im.shapeTemplate()?.imageData[0]?.base64).toBe(OBJECTS[id(8)]?.['data']);
    expect([im.ds.width(), im.ds.height(), im.ds.angle()]).toEqual([64, 48, 0.25]);
  });

  it('polygon → polygon template, with the old boolean arrows as catalog arrowheads', () => {
    const closed = get(3) as TemplatedObject;
    expect(closed.shapeTemplate()?.id()).toBe('avabodh.basic.polygon');
    expect(closed.shapeTemplate()?.closed).toBe(true);
    const open = get(4) as TemplatedObject;
    expect(open.arrows.start()?.id()).toBe('avabodh.arrow.ar');
    expect(open.arrows.end()?.id()).toBe('avabodh.arrow.str');
  });

  it('freeform → a free-hand stroke (never closed), keeping its style', () => {
    const f = get(5);
    expect(f).toBeInstanceOf(UnrecognizedObject);
    expect((f as UnrecognizedObject).closed).toBe(false);
    expect((f as UnrecognizedObject).drawingProfile.effectiveStrokeWidth()).toBe(4);
  });

  it('curve → curve template, snapped like a new object, with its arrow', () => {
    const c = get(6) as TemplatedObject;
    expect(c.shapeTemplate()?.id()).toBe('avabodh.basic.curve');
    expect(c.arrows.end()?.id()).toBe('avabodh.arrow.ar');
  });

  it('curveconnection → an automatic curve connector between its ends', () => {
    const c = get(9) as ConnectionObject;
    expect(c).toBeInstanceOf(ConnectionObject);
    expect(c.first?.id).toBe(id(1));
    expect(c.second?.id).toBe(id(3));
    expect(c.getType()).toBe(0);
    const p = c.getParams();
    expect(p[0]?.['angle1']).toBeCloseTo(0.5);
    expect(p[1]?.['cdist1']).toBeCloseTo(1.5 * 0.22);
    expect(c.arrows.end()?.id()).toBe('avabodh.arrow.str');
    expect(c.drawingProfile.effectiveStrokeWidth()).toBe(2.5);
    // As C++: a curve connector's legacy labels are not carried.
    expect(c.textInfos()).toHaveLength(0);
  });

  it('a current connector between converted objects keeps its ends', () => {
    const c = get(10) as ConnectionObject;
    expect([c.first?.id, c.second?.id]).toEqual([id(2), id(7)]);
  });

  it('round-trips through save/load to the same templated objects', () => {
    const first = io.codec.write(res.doc, { stamp: 'offline' });
    const again = testIo().codec.read(first.text);
    expect(byOrder(again.doc).map(shape)).toEqual(objs.map(shape));
    expect(again.warnings.find((w) => w.code === 'legacy_converted')).toBeUndefined();
    const second = testIo().codec.write(again.doc, { stamp: 'offline' });
    expect(JSON.parse(testIo().codec.write(testIo().codec.read(second.text).doc, { stamp: 'offline' }).text)).toEqual(
      JSON.parse(second.text),
    );
  });
});

describe('no legacy type is held or written, by every load path (AC-ENG-35)', () => {
  it('file', () => {
    const io = testIo();
    const doc = io.codec.read(TEXT).doc;
    expectNoLegacy(allObjects(doc), io.codec.write(doc, { stamp: 'offline' }).json);
  });

  it('cloud load (an already-parsed document)', () => {
    const io = testIo();
    const doc = io.codec.readValue(JSON.parse(TEXT) as JsonValue).doc;
    expect(byOrder(doc)).toHaveLength(10);
    expectNoLegacy(allObjects(doc), io.codec.write(doc, { stamp: 'cloud' }).json);
  });

  it.each(Object.keys(OBJECTS))('paste of a multi object holding %s', (key) => {
    const io = testIo();
    const item = OBJECTS[key] as JsonObject;
    const multi = {
      type: 'multi',
      params: { cx: 0, cy: 0, width: 10, height: 10, angle: 0 },
      objects: { [key]: item },
    };
    const { object } = io.codec.readObject(multi);
    const inner = (object as unknown as { objects(): { object: LekhObject }[] }).objects().map((i) => i.object);
    // A lone connector has no ends in the payload and is dropped, as C++ dropped it.
    const isConnector = typeof item['type'] === 'string' && item['type'].endsWith('connection');
    expect(inner).toHaveLength(isConnector ? 0 : 1);
    expectNoLegacy([object, ...inner], io.codec.writeObject(object));
  });

  it('paste of every type at once, connectors fixed up inside the payload', () => {
    const io = testIo();
    const multi = { type: 'multi', params: { cx: 0, cy: 0, width: 10, height: 10, angle: 0 }, objects: OBJECTS };
    const { object } = io.codec.readObject(multi);
    const inner = (object as unknown as { objects(): { object: LekhObject }[] }).objects().map((i) => i.object);
    expect(inner).toHaveLength(10);
    expectNoLegacy([object, ...inner], io.codec.writeObject(object));
  });

  it.each(Object.keys(OBJECTS).filter((k) => !(OBJECTS[k]?.['type'] as string).endsWith('connection')))(
    'library item %s',
    (key) => {
      const io = testIo();
      const lib = new LibraryItemCodec(io.codec);
      const item = OBJECTS[key] as JsonObject;
      const read = lib.readItem(item);
      expectNoLegacy([read.object], lib.writeItem(read.object));
      // The library blob: legacy items are converted for the panel, the stored blob is untouched.
      const blob = { library: [{ id: 'my.lib', name: 'Mine', objects: [item] }] };
      const before = JSON.stringify(blob);
      const norm = lib.normalize(blob);
      expect(JSON.stringify(blob)).toBe(before);
      expect(typesIn(norm as JsonValue).filter((t) => LEGACY_TYPE_NAMES.includes(t))).toEqual([]);
      // The catalog keeps templated items; a free-hand stroke has no template to key it by.
      const categs = lib.ingest(blob, io.overlay);
      expect(categs[0]?.items.length).toBe(item['type'] === 'avabodh.basic.freeform' ? 0 : 1);
    },
  );

  it('the realtime addobjects path (readObjects), with ends on the page', () => {
    const io = testIo();
    const doc = io.codec.read(TEXT).doc;
    const page = doc.activePage();
    const frame = {
      n1: OBJECTS[id(1)] as JsonObject,
      n9: { ...(OBJECTS[id(9)] as JsonObject), source: 'n1', target: id(3) },
    };
    const { objects } = io.codec.readObjects(frame, doc, (oid) => page.getObject(oid) ?? undefined);
    expect(objects.map((o) => o.name())).toEqual(['Templated', 'Connection']);
    const con = objects[1] as ConnectionObject;
    expect(con.first).toBe(objects[0]);
    expect(con.second).toBe(page.getObject(id(3)));
    expectNoLegacy(
      objects,
      objects.map((o) => io.codec.writeObject(o)),
    );
  });
});
