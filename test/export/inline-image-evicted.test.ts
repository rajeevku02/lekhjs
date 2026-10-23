// Owner round EX2 (Work 01M4X7TCHFB862XGT68GPY071C), export suite case EXP-15 in a slow run: an
// inline (base64) image on a page not on screen was exported blank once the session's image cache
// had evicted it (60 s unused, IMAGE_TTL_MS), with no warning. `preparing` pinned and waited only
// for URL images (`ImageRefs.page`), so an evicted inline image was never decoded again and
// `drawForExport` found nothing to draw. C++ keeps an inline image's bitmap on the element for the
// life of the board, so it is always exported (ShapeTemplate.cpp:676-682). The inline keys of the
// selected pages are now prepared like URLs: pinned for the job, and the absent ones asked of the
// host's image port (BrowserImagePort.ensure decodes a `data:` URI as it fetches a URL).
import { describe, expect, it } from 'vitest';
import { exportImageUrls, planExport } from '../../src/export';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { testRuntime } from '../session/helpers';
import { ControlledImagePort, env, recordingSink, run, solidImage } from './helpers';

const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAkCAIAAABAJy5dAAAAN0lEQVR4nO3OAQkAMAwDsPo3vcto4YEISC6Z0h8ICQkJjekPhISEhMb0B0JCQkJj+gMhIaHfQw+A/bmbsTDW+wAAAAAASUVORK5CYII=';

const BOARD = JSON.stringify({
  info: { version: '5.0' },
  pages: {
    p1: {
      name: 'Images',
      order: 1,
      canvassizetype: 'infinite',
      objects: {
        img1: {
          type: 'templated',
          name: 'Image',
          order: 100,
          params: { cx: 100, cy: 80, width: 160, height: 120, angle: 0 },
          template: {
            id: 'avabodh.basic.image',
            texts: '',
            images: [{ location: '0 1 2 3 4 0', data: RED_PNG, format: 'png' }],
            data: ['0', '0', 'w', 'h', '0'],
            draw: [],
          },
        },
      },
    },
  },
});

function loaded(): { s: BoardSession; sched: FakeScheduler; key: string } {
  const sched = new FakeScheduler();
  const s = new BoardSession(testRuntime({ clock: sched }), { images: new FakeImagePort(), scheduler: sched });
  const r = s.load(BOARD);
  if (!r.ok) throw new Error(r.message);
  const keys = s.document.pages[0]?.objectStore.objects.flatMap((o) => [...o.inlineImageKeys()]) ?? [];
  expect(keys).toHaveLength(1);
  return { s, sched, key: keys[0] as string };
}

describe('EX2: an evicted inline image is prepared for export like a URL', () => {
  it('the inline key is one of the images the export prepares', () => {
    const { s, key } = loaded();
    const plans = planExport(s, { format: 'png', region: 'drawing', padding: 0, scale: 1, includeBackground: false });
    expect(exportImageUrls(s, plans)).toEqual([key]);
  });

  it('after eviction the export asks the port for it again and draws it, pinned for the job', async () => {
    const { s, sched, key } = loaded();
    // Decoded at load (decodeInline), then 61 s without a paint: swept out of the cache.
    sched.flushTimers();
    await new Promise((r) => setTimeout(r, 0));
    s.dispatch({ type: 'imageLoaded', url: key, image: solidImage(48, 36) });
    expect(s.hasImage(key)).toBe(true);
    sched.advance(61_000);
    s.imageCache.sweep();
    expect(s.hasImage(key)).toBe(false);

    let pinned = false;
    const images = new ControlledImagePort((asked) => {
      pinned = s.imageCache.isPinned(key);
      for (const u of asked) s.dispatch({ type: 'imageLoaded', url: u, image: solidImage(48, 36) });
      return Promise.resolve({ loaded: [...asked], missing: [] });
    });
    const { sink, rec } = recordingSink();
    const r = await run(s, { format: 'svg', region: 'drawing' }, env({ images, sink }));
    expect(r.status).toBe('done');
    expect(images.ensured).toEqual([[key]]);
    expect(pinned).toBe(true);
    expect(r.status === 'done' && r.warnings).toEqual([]);
    const svg = Buffer.from(rec.file(rec.names[0] ?? '')).toString('utf8');
    expect(svg.match(/<image /g)).toHaveLength(1);
    expect(s.imageCache.isPinned(key)).toBe(false);
  });

  it('an inline image the port cannot decode counts as missing (one warning), as a URL does', async () => {
    const { s, key } = loaded();
    s.imageCache.sweep();
    const images = new ControlledImagePort((asked) => Promise.resolve({ loaded: [], missing: [...asked] }));
    const r = await run(s, { format: 'svg', region: 'drawing' }, env({ images }));
    expect(s.hasImage(key)).toBe(false);
    expect(r.status === 'done' && r.warnings).toEqual([{ code: 'export_image_missing', count: 1 }]);
  });
});
