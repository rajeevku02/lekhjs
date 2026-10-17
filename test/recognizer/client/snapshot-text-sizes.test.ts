// The snapshot's text sizes (spec 07 §6.4 step 5) after R4's main-thread optimisation
// (AC-REC-30): freehand ink is not re-read (it measures no text), and the sizes of each object
// are cached under its serialised JSON and the font epoch. The cached path must give exactly the
// sizes a fresh builder gives, and a change to the object or to the font epoch must re-measure.
import { describe, expect, it } from 'vitest';
import { Point, Rect } from '../../../src/geometry';
import { SceneSnapshotBuilder } from '../../../src/recognizer/client/SceneSnapshotBuilder';
import type { BoardSession } from '../../../src/session';
import { flat, jobView, SCENE_BOARDS, sessionOn } from '../support/scene';

function builder(session: BoardSession, epoch: () => number = () => 0): SceneSnapshotBuilder {
  return new SceneSnapshotBuilder({
    doc: session.editor.doc,
    codec: session.codec,
    overlay: session.overlay,
    text: session.text,
    config: session.config,
    fontEpoch: epoch,
  });
}

/** Counts the session's text measurements. */
function countMeasures(session: BoardSession): { n: number } {
  const c = { n: 0 };
  const text = session.text as unknown as { measure: (...a: unknown[]) => unknown };
  const orig = text.measure.bind(text);
  text.measure = (...a: unknown[]) => {
    c.n++;
    return orig(...a);
  };
  return c;
}

function spanningStroke(session: BoardSession): Float64Array {
  let r = new Rect(0, 0, 1, 1);
  for (const o of session.editor.doc.activePage().objectStore.objects) r = r.includeRect(o.selectionRect());
  const v = jobView(session);
  const a = new Point(r.x * v.zoom + v.tx, r.y * v.zoom + v.ty);
  const b = new Point((r.x + r.width) * v.zoom + v.tx, (r.y + r.height) * v.zoom + v.ty);
  return flat([a, b]);
}

describe('SceneSnapshotBuilder text sizes (cache, AC-REC-30)', () => {
  for (const board of SCENE_BOARDS) {
    it(`${board}: a cached build equals a fresh one and measures nothing`, () => {
      const h = sessionOn(board);
      const s = h.session;
      const stroke = spanningStroke(s);
      const view = jobView(s);
      const fresh = builder(s).build(stroke, view).snapshot.textSizes;
      const b = builder(s);
      expect(b.build(stroke, view).snapshot.textSizes).toEqual(fresh);
      const c = countMeasures(s);
      expect(b.build(stroke, view).snapshot.textSizes).toEqual(fresh);
      expect(c.n).toBe(0);
    });
  }

  it('re-measures after the font epoch changes, and after an object changes', () => {
    const h = sessionOn('objects/titled-shapes.lekh');
    const s = h.session;
    let epoch = 1;
    const b = builder(s, () => epoch);
    const stroke = spanningStroke(s);
    const view = jobView(s);
    const first = b.build(stroke, view).snapshot.textSizes;
    expect(Object.keys(first).length).toBeGreaterThan(0);
    const c = countMeasures(s);
    b.build(stroke, view);
    expect(c.n).toBe(0);
    epoch = 2;
    b.build(stroke, view);
    expect(c.n).toBeGreaterThan(0);

    // Move one titled object: its JSON changes, so it alone is re-read.
    const objs = s.editor.doc.activePage().objectStore.objects;
    const o = objs.find((x) => x.getTextForEditing() !== '');
    expect(o).toBeDefined();
    c.n = 0;
    b.build(stroke, view);
    expect(c.n).toBe(0);
    o?.translate(3, 0);
    s.editor.doc.activePage().objectStore.flushLayout();
    b.build(stroke, view);
    expect(c.n).toBeGreaterThan(0);
  });
});
