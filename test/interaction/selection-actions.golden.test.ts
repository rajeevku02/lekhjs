// AC-UI-22 (lekhjs half): the selection menu's items for a target are the C++ ones. For every
// board of the core fixture set and every selectable target on its active page (each top-level
// object, and the multi-selection of all of them), the C++ SelectionMenuWidget's `isVisible` and
// `isCollapsedAlways` per item (captured by parity/tools/capture-selection-actions/regen.mjs) equal
// `SelectionActionCatalog`'s `shouldShow` and `collapsedAlways` per entry, and `BoardView`'s
// selection state lists the shown items in the C++ registration order.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MultiSelection, SelectionActionCatalog, type EditTarget } from '../../src/edit';
import type { LekhObject } from '../../src/model';
import { TemplateCatalog, type LibraryFileJson } from '../../src/template';
import { CORE_FIXTURES, STENCILS } from '../io/helpers';
import { STENCILS_V4 } from '../generators/oracle/lua-oracle';
import { viewHarness } from './helpers';

interface Item {
  cls: string;
  shown: boolean;
  collapsed: boolean;
}
interface Target {
  target: string;
  kind: string;
  items: Item[];
}
interface Board {
  board: string;
  loaded: boolean;
  targets: Target[];
}

const FILE = path.join(import.meta.dirname, '../fixtures/golden/selection-actions/selection-actions.json');
const GOLDEN: { boards: Board[] } | null = existsSync(FILE)
  ? (JSON.parse(readFileSync(FILE, 'utf8')) as { boards: Board[] })
  : null;

/** The C++ item class of each catalog id, in the registration order. */
const CLASS_OF: Readonly<Record<string, string>> = Object.freeze({
  info: 'InfoMenuItem',
  separator: 'SeparatorMenuItem',
  delete: 'DelMenuItem',
  duplicate: 'DuplicateMenuItem',
  properties: 'PropertyEditMenuItem',
  stroke: 'StrokeAttrEditMenuItem',
  fill: 'FillColorMenuItem',
  text_attr: 'TextAttrEditMenuItem',
  text_color: 'TextColorEditMenuItem',
  round_corner: 'RoundCornerMenuItem',
  sharp_corner: 'SharpCornerMenuItem',
  make_square: 'MakeSquareMenuItem',
  make_circle: 'MakeCircleMenuItem',
  make_equilateral: 'MakeEqTriagleMenuItem',
  group: 'GroupMenuItem',
  ungroup: 'UnGroupMenuItem',
  connection: 'ConnectionEditMenuItem',
  shape_help: 'ShapeHelpMenuItem',
  title_position: 'TitleSideMenuItem',
  copy: 'CopyShapeMenuItem',
  cut: 'CutShapeMenuItem',
  bring_front: 'MoveToFrontMenuItem',
  send_back: 'MoveToBackMenuItem',
  flip_h: 'FlipHzMenuItem',
  flip_v: 'FlipVerticalMenuItem',
  copy_style: 'CopyStyleMenuItem',
  paste_style: 'PasteStyleMenuItem',
  copy_size: 'CopySizeMenuItem',
  paste_size: 'PasteSizeMenuItem',
  set_size: 'SetSizeMenuItem',
  save_to_library: 'SaveToCustomLibMenuItem',
  about: 'AboutMenuItem',
});

/**
 * The catalog the C++ test tier seeds (its core stencil set): the bundled one plus the wireframe
 * library, whose help texts `shape_help` reads.
 */
function captureCatalog(): TemplateCatalog {
  const read = (dir: string, names: readonly string[]): LibraryFileJson[] =>
    names.map((n) => JSON.parse(readFileSync(path.join(dir, n), 'utf8')) as LibraryFileJson);
  const dirFiles = (dir: string): string[] =>
    readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
  return TemplateCatalog.build([
    ...read(path.join(STENCILS, 'builtin'), dirFiles(path.join(STENCILS, 'builtin'))),
    ...read(path.join(STENCILS, 'core'), dirFiles(path.join(STENCILS, 'core'))),
    ...read(STENCILS_V4, ['wireframe.json']),
  ]);
}

/**
 * Targets the C++ holds as a legacy object type (`objects/legacy-objects.lekh`, a legacy ellipse in
 * `style/deviations.lekh`): lekhjs converts legacy types on load (OQ-14, AC-ENG-35), so the menu of
 * the converted shape is the templated one's, not the legacy class's. The capture marks them `other`.
 */
const LEGACY_KIND = 'other';

describe.skipIf(GOLDEN === null)('selection actions match C++ SelectionMenuWidget (AC-UI-22)', () => {
  const golden = GOLDEN ?? { boards: [] };
  const catalog = new SelectionActionCatalog();
  const runtimeCatalog = GOLDEN === null ? null : captureCatalog();

  it('the golden lists the catalog layout, class for class', () => {
    const first = golden.boards.flatMap((b) => b.targets)[0];
    expect(first).toBeDefined();
    expect(first?.items.map((i) => i.cls)).toEqual(catalog.layout.map((id) => CLASS_OF[id]));
  });

  for (const b of golden.boards) {
    if (!b.loaded || b.targets.length === 0) continue;
    it(`${b.board}: ${String(b.targets.length)} targets`, () => {
      const raw = readFileSync(path.join(CORE_FIXTURES, b.board), 'utf8');
      const h = viewHarness({ board: raw, ...(runtimeCatalog !== null ? { catalog: runtimeCatalog } : {}) });
      const objs: LekhObject[] = [...h.session.editor.doc.activePage().objectStore.objects];
      const ctx = { editor: h.session.editor, commands: h.session.commands, clipboard: h.session.clipboard };
      for (const t of b.targets) {
        // A legacy object, or the multi-selection of a board holding one.
        if (t.kind === LEGACY_KIND || (t.target === 'multi' && b.targets.some((x) => x.kind === LEGACY_KIND))) continue;
        const target: EditTarget | undefined = t.target === 'multi' ? new MultiSelection(objs) : objs[Number(t.target)];
        expect(target, `${b.board} target ${t.target}`).toBeDefined();
        if (target === undefined) continue;
        const got = catalog.layout.map((id) => {
          const e = catalog.get(id);
          const isSep = id === 'separator';
          return {
            cls: CLASS_OF[id],
            shown: isSep ? null : catalog.isAvailable(id, target, ctx),
            collapsed: isSep ? null : (e?.collapsedAlways ?? false),
          };
        });
        const want = t.items.map((i) => ({
          cls: i.cls,
          shown: i.cls === 'SeparatorMenuItem' ? null : i.shown,
          collapsed: i.cls === 'SeparatorMenuItem' ? null : i.collapsed,
        }));
        expect(got, `${b.board} target ${t.target} (${t.kind})`).toEqual(want);
        // The menu React renders: the shown items, in the registration order.
        h.bv.overlay.select(target);
        const ids = (h.bv.ui.get().selection?.actions ?? []).map((a) => a.id).filter((id) => id !== 'separator');
        const shownInOrder = catalog.layout.filter((id, k) => id !== 'separator' && want[k]?.shown === true);
        expect(ids, `${b.board} target ${t.target} menu order`).toEqual(shownInOrder);
        h.bv.overlay.deselect();
      }
    });
  }
});
