// Image requests at create/load (AC-ENG-09): images of off-screen objects are requested within
// one event after load, through the ImagePort, once; paint never requests.
import { describe, expect, it, vi } from 'vitest';
import { Rect } from '../../src/geometry';
import { ImageRefs, ImageRequests, Page } from '../../src/model';
import { ImageCache, ViewTransform } from '../../src/render';
import { ManualTime } from '../render/helpers';
import { BoxShape, FakeGroup, fixedClock, noopDp, paintEnv, verifyConfig } from './helpers';

function setup() {
  const time = new ManualTime();
  const cache = new ImageCache({ clock: time.clock, scheduler: time });
  const port = { request: vi.fn<(urls: readonly string[]) => void>() };
  const requests = new ImageRequests({ cache, port, scheduler: time });
  return { time, cache, port, requests };
}

describe('ImageRefs', () => {
  it('collects distinct URLs, members included, in first-seen order', () => {
    const a = new BoxShape('a', new Rect(0, 0, 1, 1));
    a.images = ['res://one', 'https://x/two', 'res://one', ''];
    const m = new BoxShape('m', new Rect(0, 0, 1, 1));
    m.images = ['res://three'];
    const g = new FakeGroup('g', [m]);
    expect(ImageRefs.collect([a, g])).toEqual(['res://one', 'https://x/two', 'res://three']);
  });
});

describe('image requests at load (AC-ENG-09)', () => {
  it('off-screen images are requested within one event, once, and never from paint', () => {
    const { time, cache, port, requests } = setup();
    const page = new Page('p', 'Page 1', { config: verifyConfig, clock: fixedClock() });
    const on = new BoxShape('on', new Rect(10, 10, 50, 50), 100);
    on.images = ['res://on'];
    const off = new BoxShape('off', new Rect(90000, 90000, 50, 50), 200);
    off.images = ['res://off', 'res://shared'];
    const off2 = new BoxShape('off2', new Rect(80000, 0, 50, 50), 300);
    off2.images = ['res://shared'];
    // The load event: objects in, then their images scheduled.
    page.objectStore.load([on, off, off2]);
    expect(requests.scheduleFor(page.objectStore.objects)).toEqual(['res://on', 'res://off', 'res://shared']);
    expect(port.request).not.toHaveBeenCalled();
    time.advance(0);
    expect(port.request).toHaveBeenCalledTimes(1);
    expect(port.request).toHaveBeenCalledWith(['res://on', 'res://off', 'res://shared']);

    // Paint (culled or not) never requests, even for what has not arrived yet.
    const view = new ViewTransform({ zoom: 1, canvasW: 800, canvasH: 600 });
    page.paint(noopDp, { env: { ...paintEnv(), images: cache }, view });
    page.paint(noopDp, { env: { ...paintEnv(), images: cache } });
    time.advance(1000);
    expect(port.request).toHaveBeenCalledTimes(1);

    // A later event asks only for what is new; in-flight URLs are not asked again.
    expect(requests.schedule(['res://off', 'res://new'])).toEqual(['res://new']);
    time.advance(0);
    expect(port.request).toHaveBeenLastCalledWith(['res://new']);
  });

  it('several schedules in one event make one request; dispose cancels it', () => {
    const { time, port, requests } = setup();
    requests.schedule(['a']);
    requests.schedule(['b']);
    expect(time.timers.size).toBe(1);
    time.advance(0);
    expect(port.request).toHaveBeenCalledWith(['a', 'b']);
    requests.schedule(['c']);
    requests.dispose();
    time.advance(0);
    expect(port.request).toHaveBeenCalledTimes(1);
    expect(requests.schedule(['d'])).toEqual([]);
  });
});
