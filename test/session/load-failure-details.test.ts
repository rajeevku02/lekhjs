// What a failed load tells its host (round BR1, board load failure reports): the `LoadError`
// code, its fixed text and content-free details — where the reader stopped (`page_index`,
// `object_index`, the reader's `reason`) — on `load`, on a failed `open`, and on a cloud board's
// rejected `load` frame. Never board content.
import { describe, expect, it } from 'vitest';
import { BoardSession } from '../../src/session';
import { updatetypes } from '../../src/sync';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { frame, harness, testRuntime } from './helpers';

// Page 1 (byte order) holds an untyped entry with no template (skipped, entry 0) and an object
// whose `type` is not a string (entry 1): `object_parse`.
const BAD_OBJECT = JSON.stringify({
  info: { version: '4.2' },
  pages: {
    p1: { objects: {} },
    p2: { objects: { a: { x: 1 }, b: { type: 7, label: 'secret text' } } },
  },
});

const session = (): BoardSession =>
  BoardSession.empty(testRuntime(), { images: new FakeImagePort(), scheduler: new FakeScheduler() });

describe('load failure details', () => {
  it('a failed load names the page and the object where parsing stopped', () => {
    const r = session().load(BAD_OBJECT);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('object_parse');
    expect(r.details).toEqual({ page_index: 1, object_index: 1 });
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it("the reader's own reason is kept beside the indexes", () => {
    const doc = JSON.stringify({ info: { version: '4.2' }, pages: { p1: { objects: 3 } } });
    const r = session().load(doc);
    expect(r).toMatchObject({
      ok: false,
      code: 'object_parse',
      details: { reason: 'objects_not_a_list', page_index: 0 },
    });
  });

  it('a failure with no details has none', () => {
    const r = session().load('{"info":{"version":"9.0"},"pages":{}}');
    expect(r).toMatchObject({ ok: false, code: 'format_too_new' });
    if (!r.ok) expect(r.details).toBeUndefined();
  });

  it("a failed open's error event carries the details", () => {
    const s = session();
    const errors: unknown[] = [];
    s.on('error', (e) => errors.push(e));
    s.dispatch({ type: 'open', raw: BAD_OBJECT, meta: { kind: 'offline' } });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'object_parse', eventType: 'open', details: { page_index: 1, object_index: 1 } }),
    ]);
  });

  it("a cloud board's load frame that does not read: frame_rejected with the load error", () => {
    const h = harness({ cloud: true });
    const errors: unknown[] = [];
    h.session.on('error', (e) => errors.push(e));
    const syncErrors: { code: string; reason: string; load?: { code: string; details?: unknown } }[] = [];
    h.session.sync.on('syncError', (e) => syncErrors.push(e));
    h.dispatch({ type: 'remoteFrame', text: frame(updatetypes.load, { doc: JSON.parse(BAD_OBJECT) as never }, 8) });
    expect(syncErrors).toHaveLength(1);
    expect(syncErrors[0]?.code).toBe('frame_rejected');
    expect(syncErrors[0]?.reason).toBe(updatetypes.load);
    expect(syncErrors[0]?.load?.code).toBe('object_parse');
    expect(syncErrors[0]?.load?.details).toEqual({ page_index: 1, object_index: 1 });
    const e = errors as { code: string; eventType: string; load?: { code: string } }[];
    expect(e).toHaveLength(1);
    expect(e[0]?.code).toBe('frame_rejected');
    expect(e[0]?.eventType).toBe('remoteFrame');
    expect(e[0]?.load?.code).toBe('object_parse');
    expect(JSON.stringify(errors)).not.toContain('secret');
  });

  it('any other rejected frame carries no load error', () => {
    const h = harness({ cloud: true });
    const errors: { load?: unknown }[] = [];
    h.session.on('error', (e) => errors.push(e));
    h.dispatch({
      type: 'remoteFrame',
      text: frame(updatetypes.changeConnectionParams, { 'doc.pages.nopage.objects.X.ctype': 7 }, 8),
    });
    for (const e of errors) expect(e.load).toBeUndefined();
  });
});
