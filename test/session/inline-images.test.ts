// Inline (base64) images of an offline board are decoded at load (spec 03 §7, OQ-66): the session
// schedules them by their `data:` cache key and decodes them through `ImagePort.decodeInline`, not
// `request`, so they draw instead of the placeholder (found by the image comparison, W11: every
// inline image of the sample drew as the placeholder on the TS board).
import { describe, expect, it } from 'vitest';
import { inlineImageKey } from '../../src/template';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { harness, testRuntime } from './helpers';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

function board(angle: number) {
  return {
    attributes: { grid: { present: false }, scaling: { scale: 1, unit: 'point' } },
    info: { author: '', description: '', platform: '1', title: '', version: '4.2' },
    pages: {
      '10000000-0000-4000-8000-000000000001': {
        name: 'Page 1',
        order: 1,
        canvassizetype: 'infinite',
        canvasname: 'Infinite',
        size: { width: 0, height: 0, unit: 'point' },
        objects: {
          '20000000-0000-4000-8000-000000000001': {
            type: 'templated',
            order: 1,
            params: { angle, cx: 100, cy: 100, width: 80, height: 60 },
            template: {
              id: 'avabodh.basic.image',
              texts: '',
              images: [{ location: '0 1 2 3 4 0', data: PNG, format: 'PNG' }],
              data: ['0', '0', 'w', 'h', '0'],
              draw: [],
            },
          },
        },
      },
    },
  };
}

describe('inline images at load', () => {
  it('are decoded through decodeInline and land in the cache under their data: key', async () => {
    for (const angle of [0, 1.5708]) {
      const h = harness({ board: board(angle) });
      const key = inlineImageKey(PNG, 'PNG');
      h.scheduler.flushTimers();
      // Not fetched as a URL …
      expect(h.images.requested).not.toContain(key);
      await Promise.resolve();
      await Promise.resolve();
      // … but decoded and cached.
      expect(h.session.imageCache.get(key)).toBeDefined();
    }
  });

  it('a decoder that refuses (kashi) fails the key: the placeholder stays, nothing is fetched', async () => {
    const runtime = testRuntime();
    const scheduler = new FakeScheduler();
    const images = new FakeImagePort(new Map(), { inline: false });
    const session = new BoardSession(runtime, { images, scheduler });
    session.dispatch({ type: 'open', raw: board(0), meta: { kind: 'offline' } });
    scheduler.flushTimers();
    await Promise.resolve();
    await Promise.resolve();
    const key = inlineImageKey(PNG, 'PNG');
    expect(images.requested).not.toContain(key);
    expect(session.imageCache.get(key)).toBeUndefined();
    expect(session.imageCache.failure(key)?.reason).toBe('decode');
  });
});
