// Owner round UI6 #2: the selection overlay's line widths against C++.
// - The selection rectangle: C++ `SelectionRectangleWidget` strokes its corners with its own
//   `drawingProfile`, which sets only the dash {2, 2} (SelectionRectangleWidget.cpp:29-37), so the
//   width is `Style::effectiveStrokeWidth`'s default 2 (Style.cpp:70-84). The port drew 1.
// - The vertex handle (`VertexHandleWidget`, VertexHandleWidget.cpp:19-25, 163-182): the same
//   profile, so its frame and circle are 2 wide too.
// - The rubber band (`SelectDragObject`, SelectDragObject.cpp:7-11): colours only, width 2.
// - The alignment guides (`LekhCore::alignmentLineStyle_`, 1 wide, dashes 4 4, LekhCore.cpp:72-74)
//   are drawn in document units on the zoomed platform (LekhCore.cpp:193-195): 2 wide, 8 8 at zoom 2.
// Unchanged, as C++: the connect handles' ring (1, ConnectHandleWidget.cpp:72-76), the resizers and
// the rotater (their templates at 1, CornerWidget.cpp:84-92), the rotation indicator line (1,
// SelectionRectangleWidget.cpp:113-116) and the curve arms (1 at zoom 1, UI3).
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import { InputMode } from '../../src/interaction';
import { SELECTION_STROKE_WIDTH } from '../../src/interaction/overlay-tokens';
import { ShapePointType } from '../../src/interaction/selection/types';
import { TemplatedObject } from '../../src/model';
import type { DrawingPlatform } from '../../src/render';
import type { Style } from '../../src/style';
import { A, ptr, viewHarness, type ViewHarness } from './helpers';

interface Path {
  readonly style: Style;
  readonly points: Point[];
  circles: number;
}

class RecordingPlatform implements DrawingPlatform {
  readonly paths: Path[] = [];
  private cur_: Path | null = null;
  startDrawing(pt: Point, style: Style): void {
    this.cur_ = { style, points: [pt], circles: 0 };
  }
  endDrawing(): void {
    if (this.cur_ !== null) this.paths.push(this.cur_);
    this.cur_ = null;
  }
  closePath(): void {}
  addLineTo(pt: Point): void {
    this.cur_?.points.push(pt);
  }
  moveTo(): void {}
  addCircle(): void {
    if (this.cur_ !== null) this.cur_.circles++;
  }
  addArc(): void {}
  addEllipse(): void {}
  addCurve(): void {}
  addRoundedRect(): void {}
  drawText(): void {}
  drawImage(): void {}
  saveContext(): void {}
  restoreContext(): void {}
  translate(): void {}
  clip(): void {}
}

function draw(h: ViewHarness): RecordingPlatform {
  const dp = new RecordingPlatform();
  h.bv.drawOverlay(dp);
  return dp;
}

const near = (a: Point | undefined, b: Point, eps = 1e-6): boolean =>
  a !== undefined && Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

const dash = (s: Style): string => s.effectiveDashArray().join(',');

describe('the selection overlay strokes at the C++ default width (UI6 #2)', () => {
  it('the selection rectangle is 2 wide, dashes 2 2', () => {
    expect(SELECTION_STROKE_WIDTH).toBe(2);
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const c = h.bv.overlay.rect.corners();
    const border = draw(h).paths.find((p) => p.points.length === 4 && c.every((q, i) => near(p.points[i], q)));
    expect(border).toBeDefined();
    expect(border?.style.effectiveStrokeWidth()).toBe(2);
    expect(dash(border?.style as Style)).toBe('2,2');
  });

  it('at zoom 2 too: the rectangle is a widget, drawn in view px', () => {
    const h = viewHarness();
    h.bv.board.setView({ zoom: 2 });
    h.bv.overlay.select(h.obj(A));
    const c = h.bv.overlay.rect.corners();
    const border = draw(h).paths.find((p) => p.points.length === 4 && c.every((q, i) => near(p.points[i], q)));
    expect(border?.style.effectiveStrokeWidth()).toBe(2);
    expect(dash(border?.style as Style)).toBe('2,2');
  });

  it('the vertex handle frame and circle are 2 wide', () => {
    const h = viewHarness();
    const o = h.obj(A);
    h.bv.overlay.select(o);
    h.bv.overlay.updateVertexHandle(ShapePointType.Vertex, 0, o);
    expect(h.bv.overlay.vertex.isActive()).toBe(true);
    const dp = draw(h);
    const handle = dp.paths.filter((p) => dash(p.style) === '2,2' && (p.points.length === 4 || p.circles === 1));
    // The frame (4 points, not the selection rectangle's corners) and the circle.
    expect(handle.some((p) => p.circles === 1)).toBe(true);
    expect(handle.length).toBeGreaterThanOrEqual(2);
    for (const p of handle) expect(p.style.effectiveStrokeWidth()).toBe(2);
  });

  it('the rubber band is 2 wide', () => {
    const h = viewHarness();
    h.bv.modes.set(InputMode.Select);
    const from = new Point(700, 520);
    h.bv.input(ptr('down', from.x, from.y));
    for (let i = 1; i <= 4; i++) h.bv.input(ptr('move', from.x - i * 20, from.y - i * 15));
    const band = draw(h).paths.find((p) => {
      const c = p.style.effectiveStrokePaint().solidColor;
      return c.red === 0 && c.green === 100 && c.blue === 255;
    });
    expect(band).toBeDefined();
    expect(band?.style.effectiveStrokeWidth()).toBe(2);
  });

  it('the alignment guides scale with the zoom: 1 wide, 4 4 at zoom 1; 2 wide, 8 8 at zoom 2', () => {
    for (const zoom of [1, 2]) {
      const h = viewHarness();
      h.bv.modes.set(InputMode.Select);
      if (zoom !== 1) h.bv.board.setView({ zoom });
      const o = h.obj(A);
      expect(o).toBeInstanceOf(TemplatedObject);
      h.bv.overlay.select(o);
      const c = h.bv.overlay.rect.corners();
      const mid = new Point(((c[0]?.x ?? 0) + (c[2]?.x ?? 0)) / 2, ((c[0]?.y ?? 0) + (c[2]?.y ?? 0)) / 2);
      h.bv.input(ptr('down', mid.x, mid.y));
      for (let i = 1; i <= 4; i++) h.bv.input(ptr('move', mid.x + i * 3, mid.y + i * 2));
      expect(h.bv.overlay.rect.isMoving).toBe(true);
      const t = o as TemplatedObject;
      t.alignmentxDraw = [[new Point(10, 20), new Point(10, 200)]];
      t.alignmentyDraw = [];
      const guide = draw(h).paths.find((p) => dash(p.style) === `${String(4 * zoom)},${String(4 * zoom)}`);
      expect(guide).toBeDefined();
      expect(guide?.style.effectiveStrokeWidth()).toBe(zoom);
      expect(near(guide?.points[0], h.bv.view.toView(new Point(10, 20)), 1e-6)).toBe(true);
    }
  });
});

// Owner round UI6 #1: the selection menu's popups are placed, when their item has no room, around
// the target's own selection rectangle (C++ `SelectionMenuWidget::launchVM`,
// SelectionMenuWidget.cpp:1690-1696: `target_->getSelectionRectangle()` through `canvasToViewPort`,
// inflated by 5), not around the drawn selection rectangle (which carries the stroke and the
// `selectRectAdjustment` 15 a side). The selection state carries it as `targetRect`.
describe('the selection state carries the target rectangle (UI6 #1)', () => {
  for (const zoom of [1, 2]) {
    it(`a shape's own rectangle in view px, at zoom ${String(zoom)}`, () => {
      const h = viewHarness();
      if (zoom !== 1) h.bv.board.setView({ zoom });
      const o = h.obj(A) as TemplatedObject;
      h.bv.overlay.select(o);
      const sel = h.bv.ui.get().selection;
      if (sel === null) throw new Error('no selection');
      const r = o.selectionRect();
      const p1 = h.bv.view.toView(r.topLeft());
      const p2 = h.bv.view.toView(r.bottomRight());
      expect(sel.targetRect.x).toBeCloseTo(p1.x, 9);
      expect(sel.targetRect.y).toBeCloseTo(p1.y, 9);
      expect(sel.targetRect.width).toBeCloseTo(p2.x - p1.x, 9);
      expect(sel.targetRect.height).toBeCloseTo(p2.y - p1.y, 9);
      // The drawn rectangle (the menu's anchor) is larger: stroke + the adjustment a side.
      expect(sel.anchorRect.width).toBeGreaterThan(sel.targetRect.width + 2 * 15 - 1e-9);
    });
  }

  it("a rotated shape's is its rotated bounds (C++ TemplatedObject::getSelectionRectangle)", () => {
    const h = viewHarness();
    const o = h.obj(A) as TemplatedObject;
    o.ds.setAngle(Math.PI / 4);
    o.generateData();
    h.bv.overlay.select(o);
    const sel = h.bv.ui.get().selection;
    if (sel === null) throw new Error('no selection');
    const u = o.unrotatedRect();
    expect(sel.targetRect.width).toBeGreaterThan(u.width * h.bv.board.view().zoom);
  });
});
