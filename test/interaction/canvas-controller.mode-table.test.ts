// AC-UI-04: `CanvasController.onPan` covers every branch of C++ `CanvasWidget::onPan`
// (`CanvasWidget.cpp:179-257`), in its order, and each branch installs the C++ dragger. The table
// below has one row per branch; the last test checks that the rows hit every branch the
// controller names (`ON_PAN_BRANCHES`), so a branch without a row fails.
import { describe, expect, it } from 'vitest';
import { PencilBehavior } from '../../src/base';
import type { Point } from '../../src/geometry';
import { InputMode, Movement, ON_PAN_BRANCHES, type OnPanBranch } from '../../src/interaction';
import { A, labelPoint, pe, viewHarness, type PeOptions, type ViewHarness } from './helpers';

interface Row {
  readonly branch: OnPanBranch;
  readonly mode: InputMode;
  readonly at: (h: ViewHarness) => Point;
  readonly ev?: PeOptions;
  readonly movement?: Movement;
  readonly readOnly?: boolean;
  readonly onlyPencil?: boolean;
  readonly pencilDraws?: boolean;
  /** The dragger class installed, or null for none. */
  readonly dragger: string | null;
  readonly check?: (h: ViewHarness) => void;
}

const empty = (h: ViewHarness) => h.v(700, 550);
const onA = (h: ViewHarness) => h.v(150, 150);

const ROWS: readonly Row[] = [
  { branch: 'not-start', mode: InputMode.Select, at: empty, movement: Movement.Move, dragger: null },
  { branch: 'three-pointers', mode: InputMode.Select, at: empty, ev: { kind: 'finger', points: 3 }, dragger: null },
  {
    branch: 'two-pointers',
    mode: InputMode.Draw,
    at: empty,
    ev: { kind: 'finger', points: 2 },
    dragger: 'CanvasScaleScrollDragger',
  },
  { branch: 'not-mouse-left', mode: InputMode.Select, at: empty, ev: { button: 'right' }, dragger: null },
  { branch: 'read-only', mode: InputMode.Draw, at: empty, readOnly: true, dragger: 'CanvasScaleScrollDragger' },
  {
    branch: 'text',
    mode: InputMode.Text,
    at: empty,
    dragger: 'NoOpDragger',
    check: (h) => {
      expect(h.bv.textEdit.active).toBe(true);
      expect(h.bv.modes.get()).toBe(InputMode.Select);
    },
  },
  { branch: 'scroll', mode: InputMode.Scroll, at: onA, dragger: 'CanvasScaleScrollDragger' },
  { branch: 'draw-eraser', mode: InputMode.Draw, at: empty, ev: { kind: 'eraser' }, dragger: 'EraseDragger' },
  {
    branch: 'draw-pencil-only-touch',
    mode: InputMode.SmartDraw,
    at: empty,
    ev: { kind: 'finger' },
    onlyPencil: true,
    dragger: 'CanvasScaleScrollDragger',
  },
  {
    branch: 'draw-cmd-scroll',
    mode: InputMode.Draw,
    at: empty,
    ev: { mods: { cmd: true } },
    dragger: 'CanvasScaleScrollDragger',
  },
  { branch: 'draw', mode: InputMode.SmartDraw, at: empty, ev: { kind: 'pen' }, dragger: 'DrawingDragger' },
  { branch: 'select-eraser', mode: InputMode.Select, at: onA, ev: { kind: 'eraser' }, dragger: 'EraseDragger' },
  {
    branch: 'select-pen-draws',
    mode: InputMode.Select,
    at: onA,
    ev: { kind: 'pen' },
    pencilDraws: true,
    dragger: 'DrawingDragger',
  },
  {
    branch: 'select-cmd-scroll',
    mode: InputMode.Select,
    at: onA,
    ev: { mods: { ctrl: true } },
    dragger: 'CanvasScaleScrollDragger',
  },
  { branch: 'select-movable-text', mode: InputMode.Select, at: labelPoint, dragger: 'TextDragger' },
  {
    branch: 'select-shape',
    mode: InputMode.Select,
    at: onA,
    dragger: 'SelectionDragger',
    check: (h) => {
      expect(h.session.selection).toEqual([A]);
    },
  },
  {
    branch: 'select-shape-alt-duplicate',
    mode: InputMode.Select,
    at: onA,
    ev: { mods: { alt: true } },
    dragger: 'SelectionDragger',
    check: (h) => {
      // The copy is made and selected; the drag moves it.
      expect(h.session.editor.doc.activePage().objectStore.size).toBe(4);
      expect(h.session.selection).not.toEqual([A]);
    },
  },
  { branch: 'select-rubber-band', mode: InputMode.Select, at: empty, dragger: 'MultiSelectDragger' },
  {
    branch: 'erase-cmd-scroll',
    mode: InputMode.Erase,
    at: empty,
    ev: { mods: { cmd: true } },
    dragger: 'CanvasScaleScrollDragger',
  },
  { branch: 'erase', mode: InputMode.Erase, at: empty, ev: { kind: 'finger' }, dragger: 'EraseDragger' },
  { branch: 'laser', mode: InputMode.Laser, at: empty, dragger: 'LaserDragger' },
  { branch: 'other-mode', mode: InputMode.Shape, at: empty, dragger: 'CanvasScaleScrollDragger' },
];

function runRow(r: Row): ViewHarness {
  const config = {
    ...(r.onlyPencil === true ? { onlyDrawWithPencil: true } : {}),
    ...(r.pencilDraws === true ? { pencilBehavior: PencilBehavior.DrawInSelectionMode } : {}),
  };
  const h = viewHarness({ config });
  h.readOnly = r.readOnly === true;
  h.bv.modes.set(r.mode);
  const at = r.at(h);
  const handled = h.bv.canvas.onPan(at, pe(at.x, at.y, r.ev), r.movement ?? Movement.Start);
  expect(h.bv.canvas.lastPanBranch).toBe(r.branch);
  expect(handled).toBe(r.dragger !== null);
  expect(h.bv.router.dragHandler()?.kind ?? null).toBe(r.dragger);
  r.check?.(h);
  return h;
}

describe('CanvasController mode table (AC-UI-04)', () => {
  for (const r of ROWS) {
    it(`${r.branch} → ${r.dragger ?? 'no dragger'}`, () => {
      runRow(r);
    });
  }

  it('covers every onPan branch, in the C++ order', () => {
    const hit = new Set<OnPanBranch>();
    for (const r of ROWS) hit.add(runRow(r).bv.canvas.lastPanBranch as OnPanBranch);
    expect([...hit].sort()).toEqual([...ON_PAN_BRANCHES].sort());
    expect(ROWS.map((r) => r.branch)).toEqual([...ON_PAN_BRANCHES]);
  });
});
