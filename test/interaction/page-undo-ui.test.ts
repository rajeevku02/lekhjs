// Undo / redo of a page action reaches the UI store: a page action changes no object, so the
// session announces it as a view change (as a remote page change is). Without it the page list
// and the pages button kept the order from before the undo (found in round UI2 of Work
// 01M4X7TCHFB862XGT68GPY071C, testing the page reorder).
import { describe, expect, it } from 'vitest';
import { viewHarness, type ViewHarness } from './helpers';

async function settle(h: ViewHarness): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  h.frames.tick();
}

describe('page actions: undo and redo publish the pages', () => {
  it('reorder, undo, redo', async () => {
    const h = viewHarness();
    const pages = h.bv.editors.page();
    pages.addPage('B');
    pages.addPage('C');
    await settle(h);
    const names = () => h.bv.ui.get().pages.names;
    const start = h.session.editor.doc.pages.map((p) => p.name);
    expect(names()).toEqual(start);
    pages.reorder(0, 1);
    await settle(h);
    expect(names()).toEqual([start[1], start[0], start[2]]);
    expect(h.bv.ui.get().pages.active).toBe(1);
    h.bv.commands.run('undo');
    await settle(h);
    expect(names()).toEqual(start);
    expect(h.bv.ui.get().pages.active).toBe(0);
    h.bv.commands.run('redo');
    await settle(h);
    expect(names()).toEqual([start[1], start[0], start[2]]);
  });

  it('undoing an added page removes it from the store', async () => {
    const h = viewHarness();
    const n = h.session.editor.doc.pages.length;
    h.bv.editors.page().addPage('X');
    await settle(h);
    expect(h.bv.ui.get().pages.names).toHaveLength(n + 1);
    h.bv.commands.run('undo');
    await settle(h);
    expect(h.bv.ui.get().pages.names).toHaveLength(n);
  });
});
