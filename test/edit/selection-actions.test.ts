// The selection-menu catalog (spec 05 §8, spec 02 `SelectionActionCatalog`): the 33 C++ menu
// items as data, in the C++ registration order, with their icon ids, and C++ `shouldShow` per
// target kind; running an entry makes one undo step.
import { describe, expect, it } from 'vitest';
import {
  ClipboardService,
  EditCommands,
  MultiSelection,
  SelectionActionCatalog,
  type SelectionActionContext,
  type SelectionActionId,
} from '../../src/edit';
import type { TemplatedObject } from '../../src/model';
import { GroupObject } from '../../src/model';
import { A, B, C, P, board, fixtureJson, type Board, must } from '../sync/helpers';

function setup(): { b: Board; ctx: SelectionActionContext; cat: SelectionActionCatalog } {
  const b = board(fixtureJson('format/03-connector.lekh'));
  const clipboard = new ClipboardService(b.editor);
  const ctx = { editor: b.editor, clipboard, commands: new EditCommands(b.editor, clipboard) };
  return { b, ctx, cat: new SelectionActionCatalog() };
}
const get = (b: Board, id: string) => b.doc.getPage(P)?.objectStore.getObject(id) ?? null;
const shown = (
  cat: SelectionActionCatalog,
  t: Parameters<SelectionActionCatalog['actionsFor']>[0],
  ctx: SelectionActionContext,
) =>
  cat
    .actionsFor(t, ctx)
    .filter((a) => a.id !== 'separator')
    .map((a) => a.id);

describe('SelectionActionCatalog', () => {
  it('has 33 entries: 31 actions, the separator and the overflow expander', () => {
    const { cat } = setup();
    expect(cat.entries).toHaveLength(33);
    expect(cat.entries.filter((e) => e.kind === 'action')).toHaveLength(31);
    expect(new Set(cat.entries.map((e) => e.id)).size).toBe(33);
  });

  it('lays out in the C++ registration order (spec 05 §8)', () => {
    const { cat } = setup();
    expect(cat.layout.filter((id) => id !== 'separator')).toEqual([
      'info',
      'delete',
      'duplicate',
      'properties',
      'stroke',
      'fill',
      'text_attr',
      'text_color',
      'round_corner',
      'sharp_corner',
      'make_square',
      'make_circle',
      'make_equilateral',
      'group',
      'ungroup',
      'connection',
      'shape_help',
      'title_position',
      'copy',
      'cut',
      'bring_front',
      'send_back',
      'flip_h',
      'flip_v',
      'copy_style',
      'paste_style',
      'copy_size',
      'paste_size',
      'set_size',
      'save_to_library',
      'about',
    ] satisfies SelectionActionId[]);
  });

  it('icon ids are the C++ ones; the always-collapsed items have none, as C++', () => {
    const { cat } = setup();
    for (const e of cat.entries) {
      if (e.collapsedAlways && e.kind === 'action') expect(e.iconId).toBe('');
      else expect(e.iconId).toMatch(/^lekhapp\.ui\.[a-z_]+$/);
    }
    expect(cat.get('delete')?.iconId).toBe('lekhapp.ui.delete');
    expect(cat.get('connection')?.iconId).toBe('lekhapp.ui.connect_arrow');
    expect(cat.get('expand')?.iconId).toBe('lekhapp.ui.chevrons_down');
  });

  it('a rectangle', () => {
    const { b, ctx, cat } = setup();
    const ids = shown(cat, get(b, A), ctx);
    expect(ids).toEqual(
      expect.arrayContaining([
        'delete',
        'duplicate',
        'stroke',
        'fill',
        'text_attr',
        'round_corner',
        'make_square',
        'copy',
        'cut',
        'bring_front',
        'set_size',
        'about',
      ]),
    );
    expect(ids).not.toContain('group');
    expect(ids).not.toContain('ungroup');
    expect(ids).not.toContain('sharp_corner');
    expect(ids).not.toContain('properties');
  });

  it('a connector: no duplicate, no fill, no copy; the connection panel', () => {
    const { b, ctx, cat } = setup();
    const ids = shown(cat, get(b, C), ctx);
    expect(ids).toContain('connection');
    for (const id of ['duplicate', 'fill', 'copy', 'cut', 'set_size', 'copy_size'] as const)
      expect(ids).not.toContain(id);
  });

  it('a multi-selection groups; a group ungroups and shows text style', () => {
    const { b, ctx, cat } = setup();
    const multi = new MultiSelection([must(get(b, A)), must(get(b, B))]);
    expect(shown(cat, multi, ctx)).toContain('group');
    const r = cat.run('group', multi, ctx);
    expect(r.select).toBeInstanceOf(GroupObject);
    const ids = shown(cat, r.select as GroupObject, ctx);
    expect(ids).toEqual(expect.arrayContaining(['ungroup', 'text_attr', 'text_color']));
    expect(b.editor.undo.undoDepth).toBe(1);
  });

  it('separators: never first, never twice in a row; collapsed items marked', () => {
    const { b, ctx, cat } = setup();
    const items = cat.actionsFor(get(b, A), ctx);
    expect(items[0]?.id).not.toBe('separator');
    for (let i = 1; i < items.length; i++) {
      if (items[i]?.id === 'separator') expect(items[i - 1]?.id).not.toBe('separator');
    }
    expect(items.find((i) => i.id === 'copy')?.collapsed).toBe(true);
    expect(items.find((i) => i.id === 'delete')?.collapsed).toBe(false);
  });

  it('round corner, make square and make circle edit the shape as one step each', () => {
    const { b, ctx, cat } = setup();
    const a = get(b, A) as TemplatedObject;
    cat.run('round_corner', a, ctx);
    expect(cat.isAvailable('sharp_corner', a, ctx)).toBe(true);
    cat.run('make_square', a, ctx);
    expect(a.ds.width()).toBe(a.ds.height());
    expect(b.editor.undo.undoDepth).toBe(2);
    b.editor.undo.undo();
    b.editor.undo.undo();
    expect(a.ds.width()).toBe(120);
  });

  it('panels: the entry says what to open', () => {
    const { b, ctx, cat } = setup();
    expect(cat.run('stroke', get(b, A), ctx)).toEqual({ open: { panel: 'stroke' } });
    expect(cat.run('connection', get(b, C), ctx)).toEqual({ open: { panel: 'connection' } });
    expect(cat.run('delete', null, ctx)).toEqual({});
  });
});
