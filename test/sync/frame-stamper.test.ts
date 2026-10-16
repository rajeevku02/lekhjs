// The realtime format stamp (spec 04 §9.3-§9.4): the AC-FMT lekhjs rows. Outgoing frames that
// introduce a JS-form generator on a board below 5.0 carry `doc.info.version: "5.0"` in the same
// `changeattr`/`addobjects` frame, once (AC-FMT-07); placeholders never stamp (AC-FMT-30); the
// conversion frame is chunked by 200 template keys and 512 KB, `doc.templates.*` first, every chunk
// stamped, a template over 512 KB alone (AC-FMT-05).
import { describe, expect, it } from 'vitest';
import { utf8Length } from '../../src/sync';
import {
  CONVERSION_MAX_BYTES,
  CONVERSION_MAX_TEMPLATES,
  FORMAT_STAMP_KEY,
  FrameCodec,
  FrameStamper,
  SyncSession,
  docTemplateKey,
  objectTemplateKey,
  updatetypes,
  type ConversionEntry,
} from '../../src/sync';
import { classifyGenerator, type JsonObject, type JsonValue, type TemplateJson } from '../../src/template';
import { testIo } from '../io/helpers';
import { DOCID, FakeTransport, ManualClock, ManualScheduler, P, board, fixtureJson } from './helpers';

const JS = '/*lekh-js:1:wireframe/button*/function generate(p,t,h){}';
const LUA = 'function generate(a,b) end';
const wireframe = (script: string): JsonObject => ({
  id: 'avabodh.wireframe.button',
  data: ['-w/2', '-h/2', 'w/2', 'h/2'],
  draw: ['M 0 1 L 2 3'],
  generator: { script, text: 'Search', interprettext: true },
});
const shapeWith = (template: JsonObject): JsonObject => ({
  type: 'templated',
  order: 5,
  params: { cx: 10, cy: 10, width: 40, height: 20, angle: 0 },
  template,
});
const prefix = `doc.pages.${P}.objects.`;

describe('FrameStamper.stamp (AC-FMT-07)', () => {
  it('stamps the first frame that writes a JS-form generator, then never again', () => {
    const s = new FrameStamper('4.2');
    const first = s.stamp(updatetypes.addObjects, { [`${prefix}N`]: shapeWith(wireframe(JS)) });
    expect(first[FORMAT_STAMP_KEY]).toBe('5.0');
    expect(s.docFormat).toBe('5.0');
    const second = s.stamp(updatetypes.addObjects, { [`${prefix}M`]: shapeWith(wireframe(JS)) });
    expect(FORMAT_STAMP_KEY in second).toBe(false);
  });

  it.each([
    ['addobjects with a wireframe object', updatetypes.addObjects, { [`${prefix}N`]: shapeWith(wireframe(JS)) }, true],
    ['addobjects with a doc.templates entry', updatetypes.addObjects, { 'doc.templates.w': wireframe(JS) }, true],
    ['changeattr …template', updatetypes.changeAttr, { [`${prefix}N.template`]: wireframe(JS) }, true],
    ['convertobjects', updatetypes.convertObjects, { [`${prefix}N`]: shapeWith(wireframe(JS)) }, true],
    [
      'a group member holding one',
      updatetypes.addObjects,
      { [`${prefix}G`]: { type: 'avabodh.basic.group', objects: { m: { object: shapeWith(wireframe(JS)) } } } },
      true,
    ],
    ['changeattr params only', updatetypes.changeAttr, { [`${prefix}N.params.cx`]: 3 }, false],
    [
      'changestyle (never)',
      updatetypes.changeStyle,
      { [`${prefix}N.template.style.x`]: wireframe(JS) as JsonValue },
      false,
    ],
    ['a Lua generator', updatetypes.addObjects, { [`${prefix}N`]: shapeWith(wireframe(LUA)) }, false],
  ])('%s → stamped: %s', (_n, type, changes, stamped) => {
    const s = new FrameStamper('4.2');
    expect(FORMAT_STAMP_KEY in s.stamp(type, changes)).toBe(stamped);
  });

  it('a placeholder (JS text under an unknown id) never stamps (AC-FMT-30)', () => {
    const known = (g: JsonObject, id: string) =>
      classifyGenerator(g).kind === 'js' && id === 'avabodh.wireframe.button';
    const s = new FrameStamper('4.2', known);
    const placeholder = { ...wireframe(JS), id: 'avabodh.wireframe.unknown' };
    expect(FORMAT_STAMP_KEY in s.stamp(updatetypes.addObjects, { [`${prefix}N`]: shapeWith(placeholder) })).toBe(false);
    expect(s.docFormat).toBe('4.2');
  });

  it('a board already at 5.0 (or one stamped by a peer) gets no stamp', () => {
    const s = new FrameStamper('5.0');
    expect(FORMAT_STAMP_KEY in s.stamp(updatetypes.addObjects, { [`${prefix}N`]: shapeWith(wireframe(JS)) })).toBe(
      false,
    );
    const t = new FrameStamper('4.2');
    t.observe('5.0');
    expect(FORMAT_STAMP_KEY in t.stamp(updatetypes.addObjects, { [`${prefix}N`]: shapeWith(wireframe(JS)) })).toBe(
      false,
    );
  });

  it('SyncSession.raise stamps through the stamper and sends one frame', () => {
    const b = board(fixtureJson('format/03-connector.lekh'));
    b.sync.raise({ type: updatetypes.addObjects, changes: { [`${prefix}N`]: shapeWith(wireframe(JS)) } });
    b.sync.raise({ type: updatetypes.addObjects, changes: { [`${prefix}M`]: shapeWith(wireframe(JS)) } });
    const frames = b.transport.frames() as { updates: { changes: Record<string, unknown> } }[];
    expect(frames).toHaveLength(2);
    expect(frames[0]?.updates.changes[FORMAT_STAMP_KEY]).toBe('5.0');
    expect(frames[1]?.updates.changes[FORMAT_STAMP_KEY]).toBeUndefined();
  });
});

describe('conversion chunks (AC-FMT-05)', () => {
  const envelope = (changes: Readonly<Record<string, JsonValue>>) =>
    utf8Length(FrameCodec.encode(12, DOCID, { type: updatetypes.changeAttr, changes }));
  const entry = (i: number, size = 10): ConversionEntry => ({
    key: objectTemplateKey(P, `o${String(i).padStart(4, '0')}`),
    template: { id: 't', pad: 'é'.repeat(size) },
  });

  it('≤ 200 template keys per chunk, every chunk stamped, doc.templates.* in the first', () => {
    const s = new FrameStamper('4.2');
    const templates = [{ key: docTemplateKey('a.b.c'), template: { id: 'a.b.c' } }];
    const objects = Array.from({ length: 450 }, (_, i) => entry(i));
    const chunks = s.conversionChunks(templates, objects, envelope);
    const counts = chunks.map((c) => Object.keys(c).filter((k) => k !== FORMAT_STAMP_KEY).length);
    expect(counts).toEqual([200, 200, 51]);
    expect(Math.max(...counts)).toBeLessThanOrEqual(CONVERSION_MAX_TEMPLATES);
    for (const c of chunks) expect(c[FORMAT_STAMP_KEY]).toBe('5.0');
    expect('doc.templates.a_b_c' in (chunks[0] as object)).toBe(true);
    expect(s.docFormat).toBe('5.0');
  });

  it('≤ 512 KB of serialized frame per chunk (UTF-8 bytes), a larger template alone', () => {
    const s = new FrameStamper('4.2');
    // 'é' is two UTF-8 bytes: ~100 KB entries, then one of ~600 KB.
    const objects = [...Array.from({ length: 12 }, (_, i) => entry(i, 50_000)), entry(99, 300_000), entry(100, 10)];
    const chunks = s.conversionChunks([], objects, envelope);
    for (const c of chunks) {
      const keys = Object.keys(c).filter((k) => k !== FORMAT_STAMP_KEY);
      if (keys.length > 1) expect(envelope(c)).toBeLessThanOrEqual(CONVERSION_MAX_BYTES);
    }
    const big = chunks.find((c) => objectTemplateKey(P, 'o0099') in c);
    expect(Object.keys(big ?? {}).filter((k) => k !== FORMAT_STAMP_KEY)).toEqual([objectTemplateKey(P, 'o0099')]);
    const keys = chunks.flatMap((c) => Object.keys(c).filter((k) => k !== FORMAT_STAMP_KEY));
    expect(keys).toEqual(objects.map((e) => e.key));
  });

  it('the conversion frame of a writer’s open: changeattr, no conditions, the converted templates', () => {
    const toJs = (json: TemplateJson) => {
      const g = json['generator'] as JsonObject | undefined;
      if (g === undefined || classifyGenerator(g).kind !== 'lua' || json['id'] !== 'avabodh.wireframe.button') {
        return { json, generator: g === undefined ? null : classifyGenerator(g), converted: false };
      }
      const out = { ...json, generator: { ...g, script: JS } };
      return { json: out, generator: classifyGenerator(out.generator), converted: true };
    };
    const io = testIo({ generators: { resolve: toJs } });
    const raw = fixtureJson('format/03-connector.lekh') as Record<string, JsonValue>;
    const page = (raw['pages'] as Record<string, Record<string, Record<string, JsonValue>>>)[P] as Record<
      string,
      Record<string, JsonValue>
    >;
    page['objects'] = { ...page['objects'], W: shapeWith(wireframe(LUA)), J: shapeWith(wireframe(JS)) };
    raw['templates'] = { avabodh_wireframe_button: wireframe(LUA) };
    const read = io.codec.readValue(raw);
    expect(read.convertedLua).toBe(true);
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const sync = new SyncSession({
      host: { document: () => read.doc, codec: io.codec, replaceDocument: () => undefined },
      clock,
      scheduler: new ManualScheduler(clock),
      docid: DOCID,
      version: 9,
      transport,
    });
    expect(sync.sendConversion(raw)).toBe(1);
    const f = transport.frames()[0] as {
      updates: { type: string; changes: Record<string, JsonObject>; conditions: object };
    };
    expect(f.updates.type).toBe('changeattr');
    expect(f.updates.conditions).toEqual({});
    expect(Object.keys(f.updates.changes).sort()).toEqual(
      ['doc.info.version', 'doc.templates.avabodh_wireframe_button', objectTemplateKey(P, 'W')].sort(),
    );
    const t = f.updates.changes[objectTemplateKey(P, 'W')] as { generator: { script: string } };
    expect(t.generator.script.startsWith('/*lekh-js:1:')).toBe(true);
    expect(sync.isStamped()).toBe(true);
    // A transport that is down: nothing is sent and nothing is retried (AC-FMT-25, unit half).
    transport.state = 'closed';
    expect(sync.sendConversion(raw)).toBe(0);
    expect(transport.sent).toHaveLength(1);
  });

  it('nothing to convert → no frame', () => {
    const b = board(fixtureJson('format/03-connector.lekh'));
    expect(b.sync.conversionFrames(fixtureJson('format/03-connector.lekh'))).toEqual([]);
    expect(b.sync.stamper.docFormat).toBe('4.2');
  });
});
