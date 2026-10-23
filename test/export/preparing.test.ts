// AC-EXP-38 (unit half): `preparing` waits for the images the selected pages draw, pins them for
// the whole job and unpins them in every end state; an image still missing after the wait is
// drawn as the placeholder and gives one `export_image_missing` warning; nothing is evicted
// during a long job.
import { describe, expect, it } from 'vitest';
import { IMAGE_WAIT_MS, exportImageUrls, planExport } from '../../src/export';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { CORE_FIXTURES, readText } from '../io/helpers';
import { testRuntime } from '../session/helpers';
import path from 'node:path';
import { ControlledImagePort, env, recordingSink, run, solidImage } from './helpers';

const FIXTURE = 'objects/image-and-text.lekh';

function headless(): { s: BoardSession; sched: FakeScheduler } {
  const sched = new FakeScheduler();
  const rt = testRuntime({ clock: sched });
  const s = new BoardSession(rt, { images: new FakeImagePort(), scheduler: sched });
  const r = s.load(readText(path.join(CORE_FIXTURES, FIXTURE)));
  if (!r.ok) throw new Error(r.message);
  // The fixture's inline image decoded, as at load on a host: these cases are about its URL images
  // (an evicted inline image is prepared too: inline-image-evicted.test.ts).
  for (const p of s.document.pages) {
    for (const o of p.objectStore.objects) {
      for (const key of o.inlineImageKeys()) s.dispatch({ type: 'imageLoaded', url: key, image: solidImage(8, 8) });
    }
  }
  return { s, sched };
}

describe('preparing: wait, pin, placeholder (AC-EXP-38)', () => {
  it('waits for undecoded images with the 15 s timeout and exports every reachable one', async () => {
    const { s } = headless();
    const urls = exportImageUrls(
      s,
      planExport(s, { format: 'png', region: 'full', padding: 0, scale: 1, includeBackground: false }),
    );
    // Two URL images, then the inline image's key (decoded above, so never asked for).
    expect(urls).toHaveLength(3);
    expect(urls[2]?.startsWith('data:')).toBe(true);
    const [reachable, unreachable] = urls as [string, string];
    let pinnedDuringWait = false;
    const images = new ControlledImagePort((asked, timeoutMs) => {
      expect(timeoutMs).toBe(IMAGE_WAIT_MS);
      pinnedDuringWait = s.imageCache.isPinned(reachable) && s.imageCache.isPinned(unreachable);
      // The host's port decodes and dispatches what it can reach (BrowserImagePort.ensure).
      s.dispatch({ type: 'imageLoaded', url: reachable, image: solidImage(20, 20) });
      return Promise.resolve({ loaded: [reachable], missing: asked.filter((u) => u !== reachable) });
    });
    const e = env({ images });
    const r = await run(s, { format: 'png' }, e);
    expect(r.status).toBe('done');
    expect(images.ensured).toEqual([urls.slice(0, 2)]); // the inline image is decoded already
    expect(pinnedDuringWait).toBe(true);
    if (r.status === 'done') expect(r.warnings).toEqual([{ code: 'export_image_missing', count: 1 }]);
    expect(e.logs).toContain('export_image_missing {"count":1}');
    // Unpinned after the job, in the session cache and the port.
    expect(s.imageCache.isPinned(reachable)).toBe(false);
    expect(images.pinned()).toBe(0);
  });

  it('asks only for images not decoded yet; no warning when all arrive', async () => {
    const { s } = headless();
    const urls = exportImageUrls(
      s,
      planExport(s, { format: 'svg', region: 'full', padding: 0, scale: 1, includeBackground: false }),
    );
    const [first, second] = urls as [string, string];
    s.dispatch({ type: 'imageLoaded', url: first, image: solidImage(8, 8) });
    const images = new ControlledImagePort((asked) => {
      for (const u of asked) s.dispatch({ type: 'imageLoaded', url: u, image: solidImage(8, 8) });
      return Promise.resolve({ loaded: [...asked], missing: [] });
    });
    const { sink, rec } = recordingSink();
    const r = await run(s, { format: 'svg' }, env({ images, sink }));
    expect(images.ensured).toEqual([[second]]);
    expect(r.status === 'done' && r.warnings).toEqual([]);
    const svg = Buffer.from(rec.file(rec.names[0] ?? '')).toString('utf8');
    expect(svg.match(/<image /g)).toHaveLength(3); // the two URL images and the inline one
    expect(svg).toContain('xlink:href="data:image/png;base64,iVBORw0KGgo');
  });

  it('a missing image is drawn as the placeholder', async () => {
    const { s } = headless();
    const { sink, rec } = recordingSink();
    const r = await run(
      s,
      { format: 'svg' },
      env({ sink, images: new ControlledImagePort((u) => Promise.resolve({ loaded: [], missing: [...u] })) }),
    );
    expect(r.status === 'done' && r.warnings).toEqual([{ code: 'export_image_missing', count: 2 }]);
    const svg = Buffer.from(rec.file(rec.names[0] ?? '')).toString('utf8');
    expect(svg.match(/<image /g)).toHaveLength(1); // only the decoded inline image
    // ShapeImageElement's placeholder: a filled quad where the image would be.
    expect(svg.match(/<path [^>]*fill="rgb\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('nothing is evicted during a 2-minute job; the TTL runs again after it', async () => {
    const { s, sched } = headless();
    const urls = exportImageUrls(
      s,
      planExport(s, { format: 'png', region: 'full', padding: 0, scale: 1, includeBackground: false }),
    );
    for (const u of urls) s.dispatch({ type: 'imageLoaded', url: u, image: solidImage(8, 8) });
    let heldThrough = false;
    const sink = (): Promise<void> => {
      sched.advance(120_000);
      heldThrough = urls.every((u) => s.imageCache.has(u));
      return Promise.resolve();
    };
    const r = await run(s, { format: 'png' }, env({ sink }));
    expect(r.status).toBe('done');
    expect(heldThrough).toBe(true);
    sched.advance(61_000);
    expect(urls.some((u) => s.imageCache.has(u))).toBe(false);
  });

  it('unpinned when the job is cancelled during the wait, and when it fails', async () => {
    const { s } = headless();
    const ac = new AbortController();
    const images = new ControlledImagePort(() => {
      ac.abort();
      return new Promise(() => undefined); // never answers: the wait is abandoned on abort
    });
    const r = await run(s, { format: 'png' }, env({ images }), ac.signal);
    expect(r).toEqual({ status: 'cancelled' });
    expect(images.pinned()).toBe(0);
    const urls = exportImageUrls(
      s,
      planExport(s, { format: 'png', region: 'full', padding: 0, scale: 1, includeBackground: false }),
    );
    expect(urls.some((u) => s.imageCache.isPinned(u))).toBe(false);

    const failing = new ControlledImagePort((u) => Promise.resolve({ loaded: [], missing: [...u] }));
    const f = await run(
      s,
      { format: 'png' },
      env({ images: failing, sink: () => Promise.reject(new RangeError('oom')) }),
    );
    expect(f.status === 'failed' && f.error.code).toBe('export_out_of_memory');
    expect(failing.pinned()).toBe(0);
    expect(urls.some((u) => s.imageCache.isPinned(u))).toBe(false);
  });
});
