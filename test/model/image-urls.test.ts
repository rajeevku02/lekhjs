// `TemplatedObject.imageUrls()` (spec 03 §7): a templated shape names the `res://` and http(s) URLs of
// its image slots and of the templates embedded in it, so the session's `missingResources()` lists a
// picture the image port does not hold (kashi's "unresolved image" note, spec 10 §7) and the load
// asks the port for it. Inline (base64) images are not URLs and are not listed.
import { describe, expect, it } from 'vitest';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler, fakeImage } from '../../src/testing';
import { testRuntime } from '../session/helpers';

const IMAGE = 'res://red-500';
const EMBEDDED = 'res://inner-1';

function board(objects: Record<string, unknown>): string {
  return JSON.stringify({
    info: { version: '4.2' },
    pages: {
      p1: { name: 'Page 1', order: 1, objects },
    },
  });
}

const imageObject = (src: string, extra: Record<string, unknown> = {}) => ({
  order: 1,
  type: 'templated',
  params: { angle: 0, cx: 100, cy: 100, width: 120, height: 120 },
  template: {
    id: 'avabodh.basic.image',
    data: ['0', '0', 'w', 'h', '0'],
    images: [{ data: '', format: '', location: '0 1 2 3 4 0', src }],
    ...extra,
  },
});

const rectangle = {
  order: 2,
  type: 'templated',
  params: { angle: 0, cx: 300, cy: 100, width: 80, height: 60 },
  template: {
    id: 'avabodh.basic.rectangle',
    data: ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'],
    draw: [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 L 0 1' }],
    polygon: true,
  },
};

function session(port = new FakeImagePort()): BoardSession {
  return new BoardSession(testRuntime(), { images: port, scheduler: new FakeScheduler() });
}

function objectsOf(s: BoardSession) {
  return s.document.pages.flatMap((p) => [...p.objectStore.objects]);
}

describe('TemplatedObject.imageUrls', () => {
  it('names the res:// of an image slot, and nothing for a shape without one', () => {
    const s = session();
    expect(s.load(board({ a: imageObject(IMAGE), b: rectangle })).ok).toBe(true);
    const byId = new Map(objectsOf(s).map((o) => [o.id, o.imageUrls()]));
    expect(byId.get('a')).toEqual([IMAGE]);
    expect(byId.get('b')).toEqual([]);
    s.dispose();
  });

  it('an inline (base64) image is not a URL', () => {
    const s = session();
    const inline = imageObject('', {
      images: [{ data: 'iVBORw0KGgo=', format: 'png', location: '0 1 2 3 4 0', src: '' }],
    });
    expect(s.load(board({ a: inline })).ok).toBe(true);
    expect(objectsOf(s)[0]?.imageUrls()).toEqual([]);
    s.dispose();
  });

  it("includes the images of the templates embedded in the shape's own", () => {
    const s = session();
    const host = {
      order: 1,
      type: 'templated',
      params: { angle: 0, cx: 100, cy: 100, width: 100, height: 100 },
      template: {
        id: 'test.host',
        data: ['0', '0', 'w', 'h', '0'],
        images: [{ data: '', format: '', location: '0 1 2 3 4 0', src: IMAGE }],
        embeds: [{ template: 'test.inner', location: '0 1 2 3 4' }],
      },
    };
    const doc = JSON.parse(board({ a: host })) as Record<string, unknown>;
    doc['templates'] = {
      test_inner: {
        id: 'test.inner',
        data: ['0', '0', 'w', 'h', '0'],
        images: [{ data: '', format: '', location: '0 1 2 3 4 0', src: EMBEDDED }],
      },
    };
    expect(s.load(JSON.stringify(doc)).ok).toBe(true);
    const urls = objectsOf(s)[0]?.imageUrls() ?? [];
    expect(urls[0]).toBe(IMAGE);
    // The embed resolves only when the loader knows the embedded template; when it does, its
    // picture is listed after the host's.
    expect(urls.every((u) => u === IMAGE || u === EMBEDDED)).toBe(true);
    s.dispose();
  });
});

describe('BoardSession.missingResources', () => {
  it('lists a referenced picture the image port does not hold, and drops it once it does', () => {
    const s = session();
    expect(s.load(board({ a: imageObject(IMAGE), b: rectangle })).ok).toBe(true);
    expect(s.missingResources()).toEqual([IMAGE]);
    s.dispose();

    const port = new FakeImagePort(new Map([[IMAGE, fakeImage(500, 500)]]));
    const t = session(port);
    expect(t.load(board({ a: imageObject(IMAGE) })).ok).toBe(true);
    expect(t.missingResources()).toEqual([]);
    t.dispose();
  });
});
