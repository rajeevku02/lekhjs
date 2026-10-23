// UF3 (owner: "laser mode is not working in the TS port"): a collaborator's laser trail is drawn.
// C++ `UpdateManager::onMessage` hands a `trackpointer` update's points to `CursorTracker`
// (UpdateManager.cpp:191-194), and `LekhCore::draw` draws the trackers last
// (LekhCore.cpp:207 → CursorTracker.cpp:106-151): per point, newest first, a dot of the user's
// colour (radius 10, 9, 8, ...; 3 after the tenth) with a red ring at radius + 2 and a white one at
// radius - 3. The port kept the points (`PresenceTracker`) but never drew them.
import { describe, expect, it } from 'vitest';
import type { Point } from '../../src/geometry';
import type { DrawingPlatform } from '../../src/render';
import type { Color, Style } from '../../src/style';
import { PRESENCE_COLORS } from '../../src/sync';
import { DOCID } from '../session/helpers';
import { viewHarness, type ViewHarness } from './helpers';

interface Circle {
  readonly p: Point;
  readonly r: number;
  readonly fill: string | null;
  readonly stroke: string;
}

const rgba = (c: Color): string => `${String(c.red)},${String(c.green)},${String(c.blue)},${String(c.alpha)}`;

class Recorder implements DrawingPlatform {
  readonly circles: Circle[] = [];
  private style_: Style | null = null;
  startDrawing(_pt: Point, style: Style): void {
    this.style_ = style;
  }
  endDrawing(): void {}
  closePath(): void {}
  addLineTo(): void {}
  moveTo(): void {}
  addCircle(center: Point, radius: number): void {
    const s = this.style_ as Style;
    this.circles.push({
      p: center,
      r: radius,
      fill: s.fill() ? rgba(s.effectiveFillPaint().solidColor) : null,
      stroke: rgba(s.effectiveStrokePaint().solidColor),
    });
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

function deliver(h: ViewHarness, uid: string, pts: readonly { x: number; y: number }[]): void {
  h.transport.deliver(
    JSON.stringify({
      version: 0,
      docid: DOCID,
      type: 'update',
      user: { id: uid, name: 'peer' },
      updates: { type: 'trackpointer', changes: {}, pointer: pts },
    }),
  );
}

function draw(h: ViewHarness): Recorder {
  const dp = new Recorder();
  h.bv.drawOverlay(dp);
  return dp;
}

describe('a collaborator laser trail is drawn on the board (C++ CursorTracker::draw)', () => {
  it('each received point: a coloured dot, a red ring and a white ring, newest largest', () => {
    const h = viewHarness({ cloud: true });
    expect(draw(h).circles).toHaveLength(0);
    deliver(h, '7', [
      { x: 300, y: 200 },
      { x: 320, y: 210 },
      { x: 340, y: 220 },
    ]);
    const c = draw(h).circles;
    expect(c).toHaveLength(9);
    const colour = rgba(PRESENCE_COLORS[7 % PRESENCE_COLORS.length] as Color);
    // Newest point first: radius 10, then 9, then 8 (C++ (int)(10 * (1 - 0.06 i))).
    const newest = h.v(340, 220);
    expect(Math.hypot((c[0] as Circle).p.x - newest.x, (c[0] as Circle).p.y - newest.y)).toBeLessThan(1e-6);
    expect(c.map((k) => k.r)).toEqual([10, 12, 7, 9, 11, 6, 8, 10, 5]);
    expect((c[0] as Circle).fill).toBe(colour);
    expect((c[1] as Circle).fill).toBeNull();
    expect((c[2] as Circle).fill).toBeNull();
    expect((c[1] as Circle).stroke).toBe('200,0,0,255');
    expect((c[2] as Circle).stroke).toBe('255,255,255,255');
  });

  it('trimmed to its last point 300 ms after the last frame, gone after 5 s', () => {
    const h = viewHarness({ cloud: true });
    deliver(h, '7', [
      { x: 300, y: 200 },
      { x: 340, y: 220 },
    ]);
    h.scheduler.advance(400);
    expect(draw(h).circles).toHaveLength(3);
    h.scheduler.advance(5000);
    expect(draw(h).circles).toHaveLength(0);
  });
});
