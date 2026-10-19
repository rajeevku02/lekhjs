// The canvas context menu's Add Note / Add Rectangle / Add Circle place the shape at the size its
// library gives it, as C++ `Command::addShapeById` does through
// `TemplateStore::getObjectFromTemplate` (the library object keyed by the template, cloned; only a
// template no library object has falls back to the template's default size). Owner's UI2 issue 5:
// the TS port used the template default (10 × 10 for the rectangle), so the shape was tiny.
// Sizes from the bundled basic library (`library[0].objects[*].params`, and the note's
// `default`, since its library entry names the template).
import { describe, expect, it } from 'vitest';
import { TemplatedObject, type LekhObject } from '../../src/model';
import { viewHarness, type ViewHarness } from './helpers';

function added(h: ViewHarness, fn: () => void): LekhObject[] {
  const store = () => h.session.editor.doc.activePage().objectStore;
  const before = new Set(store().objects.map((o) => o.id));
  fn();
  return store().objects.filter((o) => !before.has(o.id));
}

describe('context menu Add shape: the library size (C++ getObjectFromTemplate)', () => {
  const cases: [string, string, number, number][] = [
    ['add_rect', 'avabodh.basic.rectangle', 112, 75],
    ['add_circle', 'avabodh.basic.circle', 100, 100],
    ['add_note', 'avabodh.basic.note', 104, 112],
  ];
  for (const [action, tid, w, h0] of cases) {
    it(`${action} adds ${tid} at ${String(w)} × ${String(h0)}`, () => {
      const h = viewHarness();
      const objs = added(h, () => {
        h.bv.commands.runContextAction(action as Parameters<typeof h.bv.commands.runContextAction>[0]);
      });
      expect(objs).toHaveLength(1);
      const o = objs[0] as TemplatedObject;
      expect(o).toBeInstanceOf(TemplatedObject);
      expect(o.shapeTemplate()?.id()).toBe(tid);
      const r = o.ds.rect();
      expect(r.width).toBeCloseTo(w, 6);
      expect(r.height).toBeCloseTo(h0, 6);
    });
  }

  it('each add is a fresh object (a new id, not the library copy)', () => {
    const h = viewHarness();
    const objs = added(h, () => {
      h.bv.commands.runContextAction('add_rect');
      h.bv.commands.runContextAction('add_rect');
    });
    expect(objs).toHaveLength(2);
    expect(objs[0]?.id).not.toBe(objs[1]?.id);
  });
});
