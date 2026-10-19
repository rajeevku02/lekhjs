// Owner round UI3 #3-#6, the selection overlay against C++:
// - #3 the rotater (corner 0) is the template `lekhapp.ui.sel_rect_rotate` drawn with its own
//   strokes (C++ `CornerWidget::onLayout`: `overrideStrokeColor_ = false`), so its bounding
//   square, which has no stroke, is not drawn: no border around the control;
// - #4 hovering a drawn corner (the rotater or a resizer) shows the `action` cursor (C++
//   `CornerWidget` is an `Icon`: `PointerIconType::Action`, the web's `pointer`), the mode's
//   cursor again off it;
// - #5 a selected single curve shape draws its control arms dashed (C++
//   `BezierCurveTemplate::drawExtraWhenSelected`), #6 so does a curve connector (C++
//   `ConnectionObject::drawSelectionVertices`): start → first control, end → second control.
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import { InputMode } from '../../src/interaction';
import { ConnectionObject, TemplatedObject } from '../../src/model';
import type { DrawingPlatform } from '../../src/render';
import type { Style } from '../../src/style';
import { A, fixtureJson, ptr, viewHarness, type ViewHarness } from './helpers';

const BOARD = 'boards/android-shapes-and-connectors.lekh';
/** An `avabodh.basic.curve` (a single Bézier) of that board. */
const CURVE = '439275f5-4ae5-4057-93b1-3005ce756229';

interface Path {
  readonly style: Style;
  /** The start, then every line and move target, in order. */
  readonly points: Point[];
}

class RecordingPlatform implements DrawingPlatform {
  readonly paths: Path[] = [];
  private cur_: Path | null = null;
  startDrawing(pt: Point, style: Style): void {
    this.cur_ = { style, points: [pt] };
  }
  endDrawing(): void {
    if (this.cur_ !== null) this.paths.push(this.cur_);
    this.cur_ = null;
  }
  closePath(): void {}
  addLineTo(pt: Point): void {
    this.cur_?.points.push(pt);
  }
  moveTo(pt: Point): void {
    // A `startDrawing` then a `moveTo` of the same point is one point here.
    const last = this.cur_?.points.at(-1);
    if (last !== undefined && last.x === pt.x && last.y === pt.y) return;
    this.cur_?.points.push(pt);
  }
  addCircle(): void {}
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

/** The dashed (2 2 at this zoom) paths' points, one array per `startDrawing`. */
function dashedPaths(dp: RecordingPlatform, zoom = 1): Point[][] {
  return dp.paths
    .filter((p) => p.style.effectiveDashArray().join(',') === `${String(2 * zoom)},${String(2 * zoom)}`)
    .map((p) => p.points);
}

describe('the rotate control has no border (UI3 #3)', () => {
  it('only the arrow is stroked: the glyph frame (no stroke in the template) is not drawn', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const dp = draw(h);
    const c0 = h.bv.overlay.rect.corners()[0] as Point;
    const size = h.bv.board.config.closePointDistanceShort * 2;
    // A stroked path whose first point is the glyph's top-left corner would be the border.
    const tl = new Point(c0.x - size / 2, c0.y - size / 2);
    const border = dp.paths.filter((p) => p.style.effectiveStrokeWidth() > 0 && near(p.points[0], tl, 1e-3));
    expect(border).toHaveLength(0);
  });
});

describe('the cursor over the selection corners (UI3 #4)', () => {
  function hover(h: ViewHarness, at: Point): string {
    h.bv.input(ptr('move', at.x, at.y, { buttons: 0 }));
    return h.bv.cursor.get();
  }

  it('the rotater and the three resizers show the action cursor; the body and the canvas the mode cursor', () => {
    const h = viewHarness();
    h.bv.modes.set(InputMode.Select);
    h.bv.overlay.select(h.obj(A));
    const corners = h.bv.overlay.rect.corners();
    for (const c of corners) expect(hover(h, c)).toBe('action');
    const mid = new Point(
      ((corners[0]?.x ?? 0) + (corners[2]?.x ?? 0)) / 2,
      ((corners[0]?.y ?? 0) + (corners[2]?.y ?? 0)) / 2,
    );
    expect(hover(h, mid)).toBe('select');
    expect(hover(h, corners[1] as Point)).toBe('action');
    expect(hover(h, new Point(700, 550))).toBe('select');
  });

  it('nothing selected: no corner cursor', () => {
    const h = viewHarness();
    h.bv.modes.set(InputMode.Select);
    const at = h.v(150 - 60, 150 - 30);
    expect(hover(h, at)).toBe('select');
  });
});

describe('dashed control arms of a selected curve (UI3 #5, #6)', () => {
  it('a single curve shape: start → control 1 and control 2 → end, dashed', () => {
    const h = viewHarness({ board: fixtureJson(BOARD) });
    const o = h.obj(CURVE);
    expect(o).toBeInstanceOf(TemplatedObject);
    h.bv.overlay.select(o);
    const pts = o.getInterestingPoints().map((ip) => h.bv.view.toView(ip.point));
    const arms = dashedPaths(draw(h), h.session.viewTransform.zoom);
    const hasArm = (a: Point, b: Point) =>
      arms.some((p) => p.length >= 2 && near(p[0], a, 1e-3) && near(p[1], b, 1e-3));
    expect(hasArm(pts[0] as Point, pts[1] as Point)).toBe(true);
    // The second arm is a moveTo to control 2 then a line to the end, in the same path.
    expect(
      arms.some((p) => p.length >= 4 && near(p[2], pts[2] as Point, 1e-3) && near(p[3], pts[3] as Point, 1e-3)),
    ).toBe(true);
  });

  it('a curve connector: start → first control, end → second control, dashed', () => {
    const h = viewHarness({ board: fixtureJson(BOARD) });
    const con = h.session.editor.doc
      .activePage()
      .objectStore.objects.find((o) => o instanceof ConnectionObject && o.routeCurves().length > 0) as
      ConnectionObject | undefined;
    expect(con).toBeDefined();
    if (con === undefined) return;
    h.bv.overlay.select(con);
    const bz = con.routeCurves()[0];
    const vtx = con.getInterestingPoints();
    if (bz === undefined) throw new Error('curve');
    const v = (p: Point) => h.bv.view.toView(p);
    const arms = dashedPaths(draw(h), h.session.viewTransform.zoom);
    expect(
      arms.some(
        (p) =>
          p.length >= 4 &&
          near(p[0], v(bz.point1), 1e-3) &&
          near(p[1], v((vtx[1] as { point: Point }).point), 1e-3) &&
          near(p[2], v(bz.point4), 1e-3) &&
          near(p[3], v((vtx[2] as { point: Point }).point), 1e-3),
      ),
    ).toBe(true);
  });

  it('the arms scale with the zoom, as C++ drew them on the zoomed platform', () => {
    const h = viewHarness({ board: fixtureJson(BOARD) });
    h.bv.board.setView({ zoom: 2 });
    h.bv.overlay.select(h.obj(CURVE));
    const dp = draw(h);
    const arm = dp.paths.find((p) => p.style.effectiveDashArray().join(',') === '4,4');
    expect(arm).toBeDefined();
    expect(arm?.style.effectiveStrokeWidth()).toBe(2);
  });
});
