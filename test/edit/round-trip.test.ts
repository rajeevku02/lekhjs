// Every command against its own realtime update: a command (and its undo, and its redo) run on
// board A, the frames it raised are applied by board B's SyncSession, and both boards then
// serialize to the same JSON. This pins `UserAction::raise*` and `UpdateHandler` to each other the
// way C++ peers stay in sync. The C++ quirks that make peers diverge are asserted as such.
import { describe, expect, it } from 'vitest';
import { Point, Rect } from '../../src/geometry';
import {
  ArrowAddEraseAction,
  ArrowChangeAction,
  ClipboardService,
  ConnectionEditor,
  ConvertObjectsAction,
  EditCommands,
  ExpandAction,
  MultiSelection,
  PageEditor,
  RotateAction,
  ScaleAction,
  StyleEditor,
  TextEditAction,
  TextMoveAction,
  TranslateObjectAction,
  VertexEditAction,
  ChangeScalingAction,
  ChangeGridAction,
  type UserAction,
} from '../../src/edit';
import type { ConnectionObject } from '../../src/model';
import {
  ArrowLocation,
  CanvasSizeType,
  GroupObject,
  PageBackground,
  PageSize,
  TemplatedObject,
  type LekhObject,
} from '../../src/model';
import { Color, Scaling, Style, Unit } from '../../src/style';
import { A, B, C, P, board, fixtureJson, type Board, must } from '../sync/helpers';

function pair(rel = 'format/03-connector.lekh'): { a: Board; b: Board } {
  return { a: board(fixtureJson(rel)), b: board(fixtureJson(rel)) };
}

/** Flushes A's raised updates through its SyncSession and delivers the frames to B. */
function sync(a: Board, b: Board): number {
  a.flush();
  const frames = a.transport.sent.splice(0);
  for (const f of frames) {
    const out = b.sync.receive(f);
    expect(out.kind, f.slice(0, 200)).not.toBe('rejected');
  }
  return frames.length;
}

/**
 * Both boards serialize alike once laid out (a session flushes layout after every event; layout
 * writes the arrowheads' style and an auto route's offsets, so an un-laid-out board serializes
 * differently).
 */
function same(a: Board, b: Board): void {
  a.doc.layoutAll();
  b.doc.layoutAll();
  expect(b.text()).toBe(a.text());
}

/** The effective style of each object of the page (what is drawn), by id. */
function effectiveStyles(x: Board): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const visit = (o: LekhObject) => {
    const s = o.getDrawingProfile();
    out[o.id] = [
      s.effectiveStrokeWidth(),
      s.effectiveStrokePaint().solidColor.toInt(),
      s.effectiveFillPaint().type,
      s.effectiveFillPaint().solidColor.toInt(),
    ];
    if (o instanceof GroupObject) for (const m of o.objects()) visit(m.object);
  };
  for (const o of x.doc.getPage(P)?.objectStore.objects ?? []) visit(o);
  return out;
}

/**
 * After an undo of a style change the peer is visually the same but not byte-identical: C++
 * `getDiff` sends the default style's value for an attribute the old style did not set, so the
 * peer stores it explicitly (ported as is).
 */
function sameLook(a: Board, b: Board): void {
  expect(effectiveStyles(b)).toEqual(effectiveStyles(a));
}

const get = (x: Board, id: string) => x.doc.getPage(P)?.objectStore.getObject(id) ?? null;

/** run → sync → same; undo → sync → same; redo → sync → same. */
function roundTrip(a: Board, b: Board, make: (x: Board) => UserAction): void {
  const act = make(a);
  expect(a.editor.tx.run(act)).toBe(true);
  expect(sync(a, b)).toBeGreaterThan(0);
  same(a, b);
  a.editor.undo.undo();
  sync(a, b);
  same(a, b);
  a.editor.undo.redo();
  sync(a, b);
  same(a, b);
}

describe('commands and their updates stay in step with a peer', () => {
  it.each<[string, (x: Board) => UserAction]>([
    ['translate', (x) => new TranslateObjectAction(x.editor.env, x.doc, [must(get(x, A)), must(get(x, B))], 13, -7)],
    ['rotate', (x) => new RotateAction(x.editor.env, x.doc, must(get(x, A)), Math.PI / 6)],
    ['scale', (x) => new ScaleAction(x.editor.env, x.doc, must(get(x, A)), 1.5)],
    [
      'expand (boxes)',
      (x) => {
        const r = (get(x, B) as TemplatedObject).ds.rect();
        return new ExpandAction(x.editor.env, x.doc, must(get(x, B)), {
          old: r,
          cur: Rect.fromCenter(r.center(), 200, 90),
        });
      },
    ],
    ['expand (deltas)', (x) => new ExpandAction(x.editor.env, x.doc, must(get(x, A)), { dx: 40, dy: 20, anchor: 0 })],
    [
      'vertex edit',
      (x) => new VertexEditAction(x.editor.env, x.doc, must(get(x, A)), 0, new Point(90, 120), new Point(60, 100)),
    ],
    ['text edit (shape)', (x) => new TextEditAction(x.editor.env, x.doc, must(get(x, A)), 'Start', 'Begin', 0)],
    ['text edit (connector label)', (x) => new TextEditAction(x.editor.env, x.doc, must(get(x, C)), 'next', 'then', 0)],
    [
      'arrow change',
      (x) => {
        const c = get(x, C) as ConnectionObject;
        return new ArrowChangeAction(x.editor.env, x.doc, c, null, c.arrows.end(), c.arrows.end(), null);
      },
    ],
    [
      'arrow erase',
      (x) => {
        const c = get(x, C) as ConnectionObject;
        return new ArrowAddEraseAction(
          x.editor.env,
          x.doc,
          c,
          { location: ArrowLocation.End, template: c.arrows.end() },
          'erase',
        );
      },
    ],
    [
      'label move',
      (x) => {
        const c = get(x, C) as ConnectionObject;
        x.doc.layoutAll();
        const ti = must(c.textInfos()[0]);
        return new TextMoveAction(
          x.editor.env,
          x.doc,
          { obj: c, index: 0, center: new Point(0, 0), param: ti.param },
          0.8,
        );
      },
    ],
    [
      'convert objects',
      (x) => {
        const to = must((get(x, A) as TemplatedObject).clone());
        return new ConvertObjectsAction(x.editor.env, x.doc, [must(get(x, A))], to);
      },
    ],
    ['grid', (x) => new ChangeGridAction(x.editor.env, x.doc, false)],
  ])('%s', (_n, make) => {
    const { a, b } = pair();
    roundTrip(a, b, make);
  });

  it('style editor: one step per change; a continued change of the same kind extends it', () => {
    const { a, b } = pair();
    const se = new StyleEditor(a.editor, new Style());
    const target = must(get(a, A));
    se.start(target, target.getDrawingProfile());
    se.setStrokeWidth(3);
    se.setStrokeWidth(5);
    se.setLineColor(new Color(255, 0, 0));
    expect(a.editor.undo.undoDepth).toBe(2);
    sync(a, b);
    same(a, b);
    expect(get(b, A)?.getDrawingProfile().effectiveStrokeWidth()).toBe(5);
    a.editor.undo.undo();
    a.editor.undo.undo();
    sync(a, b);
    sameLook(a, b);
  });

  it('style editor on a multi-selection and on a group (member paths)', () => {
    const { a, b } = pair();
    const cmds = new EditCommands(a.editor, new ClipboardService(a.editor));
    const g = cmds.group(new MultiSelection([must(get(a, A)), must(get(a, B))])) as GroupObject;
    sync(a, b);
    same(a, b);
    const se = new StyleEditor(a.editor, new Style());
    se.start(g, g.getDrawingProfile());
    se.setFillColor(new Color(0, 0, 255));
    sync(a, b);
    same(a, b);
    a.editor.undo.undo();
    sync(a, b);
    sameLook(a, b);
  });

  it('connection editor: type change and arrow swap', () => {
    const { a, b } = pair();
    const arrows = () =>
      a.io.overlay
        .base()
        .arrowheads()
        .map((d) => a.io.codec.templates.instantiate(d));
    const ce = new ConnectionEditor(a.editor, arrows);
    ce.start(get(a, C));
    expect(ce.isEnabled()).toBe(true);
    ce.changeConnection(0);
    sync(a, b);
    same(a, b);
    ce.swapArrows();
    sync(a, b);
    same(a, b);
    ce.setStartArrow(2);
    sync(a, b);
    same(a, b);
    a.editor.undo.undo();
    a.editor.undo.undo();
    a.editor.undo.undo();
    sync(a, b);
    same(a, b);
  });

  it('group, ungroup, z-order, duplicate, delete with connectors, clear', () => {
    const { a, b } = pair();
    const cmds = new EditCommands(a.editor, new ClipboardService(a.editor));
    const g = cmds.group(new MultiSelection([must(get(a, A)), must(get(a, B))]));
    expect(g).toBeInstanceOf(GroupObject);
    sync(a, b);
    same(a, b);
    cmds.ungroup(g as GroupObject);
    sync(a, b);
    same(a, b);
    cmds.changeZOrder(get(a, A), 1);
    sync(a, b);
    same(a, b);
    const dup = cmds.duplicate(get(a, B), true);
    expect(dup).toBeInstanceOf(TemplatedObject);
    sync(a, b);
    same(a, b);
    cmds.del(get(a, A));
    expect(get(a, C)).toBeNull();
    sync(a, b);
    same(a, b);
    a.editor.undo.undo();
    sync(a, b);
    same(a, b);
    cmds.clear();
    sync(a, b);
    same(a, b);
    expect(a.doc.getPage(P)?.objectStore.size).toBe(0);
  });

  it('copy and paste (connectors between the copies)', () => {
    const { a, b } = pair();
    const clip = new ClipboardService(a.editor);
    clip.copy(new MultiSelection([must(get(a, A)), must(get(a, B)), must(get(a, C))]));
    const sel = clip.paste(new Point(600, 600));
    expect(sel).toBeInstanceOf(MultiSelection);
    expect(a.doc.getPage(P)?.objectStore.size).toBe(6);
    sync(a, b);
    same(a, b);
  });

  it('page commands: add, rename, size, margin, background, reorder, duplicate, delete', () => {
    const { a, b } = pair('format/05-multi-page.lekh');
    const pe = new PageEditor(a.editor);
    pe.start();
    pe.addPage('Extra');
    sync(a, b);
    same(a, b);
    pe.setPageName(0, 'First');
    pe.setSize(1, new PageSize(Unit.Point, 600, 400), 'Custom');
    pe.setMarginSize(new PageSize(Unit.Point, 10, 10));
    const bg = new PageBackground();
    bg.setColor(new Color(204, 204, 255));
    pe.setBackground(bg);
    pe.reorder(0, 1);
    pe.duplicatePage(a.doc.pages.length - 1);
    sync(a, b);
    same(a, b);
    pe.deletePage(0);
    sync(a, b);
    same(a, b);
  });

  it('margin add, resize, remove, undo, redo: the peer follows each step (UF6, DR-ENG-30)', () => {
    // C++ PageAttrChangeAction::apply sets margin.show = true whatever arrives
    // (UpdateAction.cpp:457-470), so a removed or undone margin (raised as null) stayed on the
    // peer at its old size until reopen. The port hides it (owner, 2026-10-23).
    const { a, b } = pair();
    const pe = new PageEditor(a.editor);
    // What is drawn: the margin box comes from the size alone (Page.marginBox).
    for (const x of [a, b]) {
      x.doc.activePage().canvasSizeType = CanvasSizeType.Fixed;
      x.doc.activePage().size = new PageSize(Unit.Point, 612, 792);
    }
    const shown = (x: Board) => {
      const p = x.doc.activePage();
      p.getCanvasSize(false);
      const m = p.margin;
      const drawn = p.marginBox(1) !== null;
      expect(drawn).toBe(m.show);
      return m.show ? [m.size.width, m.size.height, m.size.unit] : null;
    };
    const step = (f: () => void) => {
      pe.start();
      f();
      sync(a, b);
      same(a, b);
      expect(shown(b)).toEqual(shown(a));
    };
    step(() => {
      pe.setMarginSize(new PageSize(Unit.Point, 10, 10));
    });
    expect(shown(b)).toEqual([10, 10, Unit.Point]);
    step(() => {
      pe.setMarginSize(new PageSize(Unit.Inch, 1, 2));
    });
    expect(shown(b)).toEqual([1, 2, Unit.Inch]);
    step(() => {
      pe.setMarginSize(new PageSize(Unit.Point, 0, 0));
    });
    expect(shown(b)).toBeNull();
    step(() => {
      a.editor.undo.undo();
    });
    expect(shown(b)).toEqual([1, 2, Unit.Inch]);
    step(() => {
      a.editor.undo.redo();
    });
    expect(shown(b)).toBeNull();
    step(() => {
      a.editor.undo.undo();
    });
    step(() => {
      a.editor.undo.undo();
    });
    expect(shown(b)).toEqual([10, 10, Unit.Point]);
    step(() => {
      a.editor.undo.undo();
    });
    expect(shown(b)).toBeNull();
    step(() => {
      a.editor.undo.redo();
    });
    expect(shown(b)).toEqual([10, 10, Unit.Point]);
  });

  it('C++ quirk kept: page orders an addpages frame renumbers are not applied by peers', () => {
    const { a, b } = pair('format/05-multi-page.lekh');
    const pe = new PageEditor(a.editor);
    pe.duplicatePage(0);
    sync(a, b);
    // The frame carries `doc.pages.<id>.order` for each renumbered page (the server stores them),
    // but `UpdateHandler::getPageAddDeleteAction` reads only three-segment keys.
    const orders = (x: Board) => x.doc.pages.map((p) => [p.name, p.order]);
    expect(orders(b)).not.toEqual(orders(a));
  });

  it('C++ quirk kept: undoing a scaling change sends the new scaling, so the peer keeps it', () => {
    const { a, b } = pair();
    const act = new ChangeScalingAction(a.editor.env, a.doc, a.doc.scaling, new Scaling(Unit.Inch, 2));
    a.editor.tx.run(act);
    sync(a, b);
    same(a, b);
    a.editor.undo.undo();
    sync(a, b);
    expect(a.doc.scaling.unit).toBe(Unit.Point);
    expect(b.doc.scaling.unit).toBe(Unit.Inch);
  });
});
