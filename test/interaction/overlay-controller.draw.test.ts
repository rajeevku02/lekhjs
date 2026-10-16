// AC-UI-24 (lekhjs half): handles, connect handles, previews and the rubber band are drawn on the
// Middle layer by the overlay itself (draw calls through a `DrawingPlatform`), not as DOM
// elements: selecting a shape draws the dashed rectangle, the corner glyphs and the four connect
// handles at the side midpoints; a rubber-band drag draws its band; a connect drag its preview.
import { describe, expect, it } from 'vitest';
import type { BezierCurve, Point } from '../../src/geometry';
import { Movement, OVERLAY_VALUES, handleCentres, type ConnectDragger } from '../../src/interaction';
import type { DrawingPlatform } from '../../src/render';
import type { Style } from '../../src/style';
import { A, pe, viewHarness, type ViewHarness } from './helpers';

interface Call {
  readonly op: string;
  readonly p?: Point;
  readonly r?: number;
  readonly dash?: readonly number[];
}

class RecordingPlatform implements DrawingPlatform {
  readonly calls: Call[] = [];
  startDrawing(pt: Point, style: Style): void {
    this.calls.push({ op: 'start', p: pt, dash: style.effectiveDashArray() });
  }
  endDrawing(): void {
    this.calls.push({ op: 'end' });
  }
  closePath(): void {
    this.calls.push({ op: 'close' });
  }
  addLineTo(pt: Point): void {
    this.calls.push({ op: 'line', p: pt });
  }
  moveTo(pt: Point): void {
    this.calls.push({ op: 'move', p: pt });
  }
  addCircle(center: Point, radius: number): void {
    this.calls.push({ op: 'circle', p: center, r: radius });
  }
  addArc(): void {
    this.calls.push({ op: 'arc' });
  }
  addEllipse(): void {
    this.calls.push({ op: 'ellipse' });
  }
  addCurve(c: BezierCurve): void {
    this.calls.push({ op: 'curve', p: c.point4 });
  }
  addRoundedRect(): void {
    this.calls.push({ op: 'rrect' });
  }
  drawText(): void {
    this.calls.push({ op: 'text' });
  }
  drawImage(): void {
    this.calls.push({ op: 'image' });
  }
  saveContext(): void {
    this.calls.push({ op: 'save' });
  }
  restoreContext(): void {
    this.calls.push({ op: 'restore' });
  }
  translate(): void {
    this.calls.push({ op: 'translate' });
  }
  clip(): void {
    this.calls.push({ op: 'clip' });
  }
  circles(r?: number): Call[] {
    return this.calls.filter((c) => c.op === 'circle' && (r === undefined || c.r === r));
  }
}

function draw(h: ViewHarness): RecordingPlatform {
  const dp = new RecordingPlatform();
  h.bv.drawOverlay(dp);
  return dp;
}

const near = (a: Point | undefined, b: Point) =>
  a !== undefined && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

describe('overlay draws the handles on the Middle layer (AC-UI-24)', () => {
  it('nothing selected: nothing drawn', () => {
    const h = viewHarness();
    expect(draw(h).calls).toHaveLength(0);
  });

  it('a selected shape: the dashed rectangle, the rotater disc, three resizers, four connect handles', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const dp = draw(h);
    const corners = h.bv.overlay.rect.corners();
    expect(corners).toHaveLength(4);
    // The dashed selection polygon through the four corners.
    const startAt = dp.calls.findIndex(
      (c) => c.op === 'start' && c.dash?.join(',') === '2,2' && near(c.p, corners[0] as Point),
    );
    expect(startAt).toBeGreaterThanOrEqual(0);
    const lines = dp.calls.slice(startAt + 1, startAt + 4).map((c) => c.p);
    expect(
      near(lines[0], corners[1] as Point) && near(lines[1], corners[2] as Point) && near(lines[2], corners[3] as Point),
    ).toBe(true);
    // The rotater's disc on corner 0 (radius = closePointDistanceShort).
    expect(dp.circles(15).some((c) => near(c.p, corners[0] as Point))).toBe(true);
    // A filled square on corners 1-3: each starts a path near its corner.
    for (const i of [1, 2, 3]) {
      const c = corners[i] as Point;
      expect(
        dp.calls.some((k) => k.op === 'start' && k.p !== undefined && Math.hypot(k.p.x - c.x, k.p.y - c.y) < 8),
      ).toBe(true);
    }
    // The connect handles: a ring and a dot at each side midpoint.
    const mids = handleCentres(corners);
    for (const m of mids) {
      expect(dp.circles(OVERLAY_VALUES.connectRingRadius).some((c) => near(c.p, m))).toBe(true);
      expect(dp.circles(OVERLAY_VALUES.connectDotRadius).some((c) => near(c.p, m))).toBe(true);
    }
  });

  it('no connect handles on a read-only board', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    h.readOnly = true;
    expect(draw(h).circles(OVERLAY_VALUES.connectRingRadius)).toHaveLength(0);
  });

  it('a rubber-band drag draws the band', () => {
    const h = viewHarness();
    const from = h.v(600, 450);
    const to = h.v(700, 520);
    h.bv.canvas.onPan(from, pe(from.x, from.y), Movement.Start);
    h.bv.router.dragHandler()?.onPan(to, pe(to.x, to.y, { state: 'move' }), Movement.Move);
    const dp = draw(h);
    const s = dp.calls.findIndex((c) => c.op === 'start' && near(c.p, from));
    expect(s).toBeGreaterThanOrEqual(0);
    expect(dp.calls.slice(s, s + 6).some((c) => c.op === 'line' && near(c.p, to))).toBe(true);
  });

  it('a connect drag draws its dashed preview and end dot', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const right = handleCentres(h.bv.overlay.rect.corners())[1] as Point;
    expect(h.bv.overlay.onPan(right, pe(right.x, right.y), Movement.Start)).toBe(true);
    const d = h.bv.router.dragHandler() as ConnectDragger;
    expect(d.kind).toBe('ConnectDragger');
    const to = h.v(350, 450);
    d.onPan(to, pe(to.x, to.y, { state: 'move' }), Movement.Move);
    const dp = draw(h);
    expect(dp.calls.some((c) => c.op === 'start' && c.dash?.join(',') === '6,4')).toBe(true);
    expect(d.preview.route.length).toBeGreaterThan(1);
  });

  it('repaints go through the layer scheduler, one frame for many requests', () => {
    const h = viewHarness();
    const frames = h.frames;
    frames.tick();
    h.bv.overlay.invalidate();
    h.bv.overlay.invalidate();
    h.bv.overlay.select(h.obj(A));
    expect(frames.pending).toBe(1);
    expect(h.bv.layers.dirty).toContain('middle');
  });
});
