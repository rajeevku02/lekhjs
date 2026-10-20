// Images that failed with HTTP 4xx are not fetched again in the session (owner decision
// 2026-10-20, Work 01M4X7TCHFB862XGT68GPY071C, round IF1: "don't refetch images that failed with
// 4xx"). Before IF1 the export job asked the image port for every image not decoded yet, so a board
// whose image 404s fetched it again on every export (P1: PNG export on S-dec/d1, d3 over 1.10).
// Network errors, timeouts and 5xx keep today's retries; a new session tries again; the user's own
// just-inserted image is never made gone by a 4xx that raced its upload.
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import type { ExportImagePort } from '../../src/export';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { ImageCache } from '../../src/render';
import { env, pixelsOf, recordingSink, run } from '../export/helpers';
import { testRuntime } from './helpers';

const URL = 'res://if1-image';

function board(): string {
  return JSON.stringify({
    info: { version: '4.2' },
    attributes: { grid: { present: false }, scaling: { scale: 1, unit: 'point' } },
    pages: {
      p1: {
        name: 'Page 1',
        order: 0,
        canvassizetype: 'infinite',
        size: { width: 0, height: 0, unit: 'point' },
        objects: {
          o1: {
            type: 'templated',
            order: 1,
            params: { cx: 200, cy: 150, width: 240, height: 180, angle: 0 },
            template: {
              id: 'avabodh.basic.image',
              texts: '',
              images: [{ location: '0 1 2 3 4 0', src: URL }],
              data: ['0', '0', 'w', 'h', '0'],
              draw: [],
            },
          },
        },
      },
    },
  });
}

/**
 * The host's port as `BrowserImagePort` behaves: every request or ensure is a fetch, and its
 * failure comes back as an `imageFailed` event with the HTTP status (none for a network error).
 */
class FetchingPort extends FakeImagePort implements ExportImagePort {
  readonly fetches: string[] = [];
  session: BoardSession | null = null;
  private readonly status: number | undefined;
  constructor(status: number | undefined) {
    super();
    this.status = status;
  }
  override request(urls: readonly string[]): void {
    super.request(urls);
    for (const u of urls) this.fetch(u);
  }
  override ensure(urls: readonly string[]): Promise<{ loaded: string[]; missing: string[] }> {
    for (const u of urls) this.fetch(u);
    return Promise.resolve({ loaded: [], missing: [...urls] });
  }
  private fetch(url: string): void {
    this.fetches.push(url);
    const ev =
      this.status === undefined
        ? ({ type: 'imageFailed', url, reason: 'http' } as const)
        : ({ type: 'imageFailed', url, reason: 'http', status: this.status } as const);
    this.session?.dispatch(ev);
  }
}

function open(status: number | undefined): { s: BoardSession; port: FetchingPort; sched: FakeScheduler } {
  const sched = new FakeScheduler();
  const port = new FetchingPort(status);
  const s = new BoardSession(testRuntime({ clock: sched }), { images: port, scheduler: sched });
  port.session = s;
  s.dispatch({ type: 'open', raw: board(), meta: { kind: 'offline' } });
  s.dispatch({
    type: 'command',
    origin: 'ui',
    command: { kind: 'view', canvasW: 400, canvasH: 300, zoom: 1, tx: 0, ty: 0 },
  });
  sched.flushTimers(); // the deferred load request goes out (ImageRequests' setTimeout 0)
  return { s, port, sched };
}

const exportPng = (s: BoardSession, port: FetchingPort) => {
  const { sink, rec } = recordingSink();
  return run(s, { format: 'png' }, env({ images: port, sink })).then((r) => ({ r, rec }));
};

describe('an image that answered 4xx is not fetched again in the session (IF1)', () => {
  it('a 404 is fetched once across load, two exports, redraws and the 60 s re-request', async () => {
    const { s, port, sched } = open(404);
    expect(port.fetches).toEqual([URL]);
    expect(s.imageCache.state(URL)).toBe('failed');
    const a = await exportPng(s, port);
    const b = await exportPng(s, port);
    // Still one placeholder warning per export, with no wait and no fetch.
    for (const { r } of [a, b]) {
      expect(r.status === 'done' && r.warnings).toEqual([{ code: 'export_image_missing', count: 1 }]);
    }
    // Redraws and the TTL sweep: a gone image is never re-requested.
    const ctx = createCanvas(400, 300).getContext('2d');
    for (let i = 0; i < 3; i++) {
      s.paint('drawing', ctx);
      sched.advance(61_000);
      sched.flushTimers();
    }
    // A remote change touching the object (an event that re-requests its images) asks for nothing.
    s.dispatch({ type: 'open', raw: board(), meta: { kind: 'offline' } });
    sched.flushTimers();
    expect(port.fetches).toEqual([URL]);
    expect(s.imageGone(URL)).toBe(true);
  });

  it('every 4xx counts, not only 404', async () => {
    for (const status of [400, 401, 403, 410, 499]) {
      const { s, port } = open(status);
      await exportPng(s, port);
      expect(port.fetches).toEqual([URL]);
    }
  });

  it('5xx and network errors are still retried by each export', async () => {
    for (const status of [500, 503, undefined]) {
      const { s, port } = open(status);
      await exportPng(s, port);
      await exportPng(s, port);
      expect(port.fetches).toEqual([URL, URL, URL]);
      expect(s.imageGone(URL)).toBe(false);
    }
  });

  it('the export draws the 4xx image as the plain failed-image rectangle (no "Loading…")', async () => {
    const { s, port } = open(404);
    const { r, rec } = await exportPng(s, port);
    expect(r.status).toBe('done');
    const px = await pixelsOf(rec.file(rec.names[0] ?? ''));
    // The page is the image's frame (240 × 180 plus its 2 pt border): white inside, nothing else.
    let grey = 0;
    for (let y = 6; y < px.height - 6; y++) {
      for (let x = 6; x < px.width - 6; x++) {
        const i = (y * px.width + x) * 4;
        const [rr, g, bb, a] = [px.data[i], px.data[i + 1], px.data[i + 2], px.data[i + 3]];
        if (!(rr === 255 && g === 255 && bb === 255 && (a ?? 0) > 240)) grey++;
      }
    }
    expect(px.width).toBeGreaterThan(200);
    expect(grey).toBe(0);
  });

  it('a new session tries again', async () => {
    const first = open(404);
    await exportPng(first.s, first.port);
    expect(first.port.fetches).toEqual([URL]);
    first.s.dispose();
    const second = open(404);
    expect(second.port.fetches).toEqual([URL]);
    await exportPng(second.s, second.port);
    expect(second.port.fetches).toEqual([URL]);
  });

  it("the session's own inserted image is not made gone by a 4xx (upload race)", () => {
    const sched = new FakeScheduler();
    const cache = new ImageCache({ clock: sched, scheduler: sched });
    cache.trust(URL);
    cache.markPending([URL]);
    cache.fail(URL, 'http', 404);
    expect(cache.isGone(URL)).toBe(false);
    expect(cache.missing([URL])).toEqual([URL]);
    // Anyone else's image is.
    cache.fail('res://other', 'http', 404);
    expect(cache.isGone('res://other')).toBe(true);
    expect(cache.missing(['res://other'])).toEqual([]);
    // A decode failure is never a 4xx, whatever status came with it.
    cache.fail('res://bad', 'decode', 404);
    expect(cache.isGone('res://bad')).toBe(false);
  });
});
