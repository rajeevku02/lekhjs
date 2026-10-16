// Off-screen culling (AC-ENG-08): paint() runs only for objects whose extent intersects the
// visible rect grown by 32/zoom, at zoom 0.1, 1 and 4; an overhang at the viewport edge is
// painted; without a view every object is painted, in store order.
import { describe, expect, it } from 'vitest';
import { Rect } from '../../src/geometry';
import { Page } from '../../src/model';
import { ViewTransform } from '../../src/render';
import { BoxShape, fixedClock, noopDp, paintEnv, randomScene, verifyConfig } from './helpers';

function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.right() && b.x <= a.right() && a.y <= b.bottom() && b.y <= a.bottom();
}

describe('paint only visible objects (AC-ENG-08)', () => {
  it.each([0.1, 1, 4])('zoom %f: exactly the objects whose extent meets the cull rect', (zoom) => {
    const page = new Page('p', 'Page 1', { config: verifyConfig, clock: fixedClock() });
    const boxes = randomScene(page.objectStore, 1500, 7, 20000);
    const view = new ViewTransform({ zoom, scrollX: -3000, scrollY: -2000, canvasW: 1024, canvasH: 768 });
    const painted = page.paint(noopDp, { env: paintEnv(verifyConfig, zoom), view });
    const cull = view.visibleRect();
    const m = 32 / zoom;
    const grown = new Rect(cull.x - m, cull.y - m, cull.width + 2 * m, cull.height + 2 * m);
    const expected = page.objectStore.objects.filter((o) => intersects(o.extent(), grown));
    expect(painted).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(page.objectStore.size);
    for (const b of boxes) expect(b.paints).toBe(expected.includes(b) ? 1 : 0);
  });

  it('a stroke-only overhang at the viewport edge is painted; one beyond the margin is not', () => {
    const page = new Page('p', 'Page 1', { config: verifyConfig, clock: fixedClock() });
    const view = new ViewTransform({ zoom: 1, canvasW: 800, canvasH: 600 });
    // Body ends 40 left of the view; margin 32 + stroke overhang 10 reaches back in.
    const edge = new BoxShape('edge', new Rect(-140, 100, 100, 50), 100);
    edge.stroke = 20;
    const gone = new BoxShape('gone', new Rect(-140, 300, 100, 50), 200);
    gone.stroke = 2;
    page.objectStore.add(edge);
    page.objectStore.add(gone);
    page.paint(noopDp, { env: paintEnv(), view });
    expect(edge.paints).toBe(1);
    expect(gone.paints).toBe(0);
  });

  it('without a view, or for export, nothing is culled and store order is kept', () => {
    const page = new Page('p', 'Page 1', { config: verifyConfig, clock: fixedClock() });
    randomScene(page.objectStore, 200, 3, 50000);
    expect(page.paint(noopDp, { env: paintEnv() })).toEqual(page.objectStore.objects);
    const view = new ViewTransform({ zoom: 1, canvasW: 100, canvasH: 100 });
    expect(page.paint(noopDp, { env: paintEnv(verifyConfig, 1, true), view })).toEqual(page.objectStore.objects);
  });
});
