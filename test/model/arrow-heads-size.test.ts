// DR-ENG-27: an arrowhead is sized `default + 2 × the owner's stroke width` from the first layout,
// the size C++ `drawArrows` reached on every draw after the first (it regenerated the head's data
// before copying the owner's stroke width onto the arrowhead template). The fixture is the
// register's: open lines with an `ar` head (6 × 12) at both ends, stroke widths 1, 2, 3, 5, 9, 14.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TemplatedObject } from '../../src/model';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { testRuntime } from '../session/helpers';

const FIXTURE = path.resolve(__dirname, '../../parity/fixtures/DR-ENG-27/arrowheads-stroke-width.lekh');

describe('arrowhead size (DR-ENG-27)', () => {
  it("is default + 2 × the owner's stroke width on the first layout and stays so", () => {
    const s = new BoardSession(testRuntime(), { images: new FakeImagePort(), scheduler: new FakeScheduler() });
    expect(s.load(readFileSync(FIXTURE, 'utf8')).ok).toBe(true);
    const page = s.document.pages[0];
    if (page === undefined) throw new Error('no page');
    const objs = page.objectStore.objects.filter((o): o is TemplatedObject => o instanceof TemplatedObject);
    expect(objs).toHaveLength(18);
    const sizes = () =>
      objs.map((o) => {
        const sw = o.shapeTemplate()?.getStyle().effectiveStrokeWidth() ?? NaN;
        return [
          o.arrows.startDs.width() - 2 * sw,
          o.arrows.startDs.height() - 2 * sw,
          o.arrows.endDs.width() - 2 * sw,
          o.arrows.endDs.height() - 2 * sw,
        ];
      });
    s.layoutAll();
    for (const sz of sizes()) expect(sz).toEqual([6, 12, 6, 12]);
    s.layoutAll();
    for (const sz of sizes()) expect(sz).toEqual([6, 12, 6, 12]);
    s.dispose();
  });
});
