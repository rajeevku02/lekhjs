// Owner round UI5 #2: the readout drawn over a shape while it is moved ("x=…, y=…"), resized
// ("width=…, height=…") or rotated ("angle=…") is drawn by C++ `SelectionRectangleWidget`
// (drawLocationInfo / drawSizeInfo / drawForRotation, C++
// object/widget/selection/SelectionRectangleWidget.cpp:40-102) with a fresh `Style tmpStyle`: no
// font size set, so `Style::effectiveFontSize`'s default 15 (Style.cpp:511-521), black, in view
// px (the same size at any zoom). The port drew it at 12.
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import { InputMode } from '../../src/interaction';
import type { DrawingPlatform } from '../../src/render';
import type { Style } from '../../src/style';
import type { LaidOutText } from '../../src/text';
import { A, ptr, viewHarness, type ViewHarness } from './helpers';

interface Drawn {
  readonly text: string;
  readonly fontSize: number;
  readonly color: string;
}

class TextRecorder implements DrawingPlatform {
  readonly texts: Drawn[] = [];
  startDrawing(): void {}
  endDrawing(): void {}
  closePath(): void {}
  addLineTo(): void {}
  moveTo(): void {}
  addCircle(): void {}
  addArc(): void {}
  addEllipse(): void {}
  addCurve(): void {}
  addRoundedRect(): void {}
  drawText(laid: LaidOutText, style: Style): void {
    const text = laid.lines.map((l) => l.text).join('\n');
    const c = style.effectiveTextFill().solidColor;
    this.texts.push({ text, fontSize: style.effectiveFontSize(), color: `${String(c.red)},${String(c.green)},${String(c.blue)}` });
  }
  drawImage(): void {}
  saveContext(): void {}
  restoreContext(): void {}
  translate(): void {}
  clip(): void {}
}

function readout(h: ViewHarness, prefix: string): Drawn {
  const dp = new TextRecorder();
  h.bv.drawOverlay(dp);
  const t = dp.texts.find((d) => d.text.startsWith(prefix));
  if (t === undefined) throw new Error(`no "${prefix}" readout among ${JSON.stringify(dp.texts)}`);
  return t;
}

/** Presses at `from` and moves to `to` without releasing (the readout shows while dragging). */
function hold(h: ViewHarness, from: Point, to: Point): void {
  h.bv.input(ptr('down', from.x, from.y));
  for (let i = 1; i <= 4; i++) {
    h.bv.input(ptr('move', from.x + ((to.x - from.x) * i) / 4, from.y + ((to.y - from.y) * i) / 4));
  }
}

function selected(zoom: number): ViewHarness {
  const h = viewHarness();
  h.bv.modes.set(InputMode.Select);
  if (zoom !== 1) h.bv.board.setView({ zoom });
  h.bv.overlay.select(h.obj(A));
  return h;
}

function centre(h: ViewHarness): Point {
  const c = h.bv.overlay.rect.corners();
  return new Point(((c[0]?.x ?? 0) + (c[2]?.x ?? 0)) / 2, ((c[0]?.y ?? 0) + (c[2]?.y ?? 0)) / 2);
}

describe('the transform readout is drawn at the C++ default font size (UI5 #2)', () => {
  for (const zoom of [1, 2]) {
    it(`move, at zoom ${String(zoom)}: "x=…, y=…" at 15, black`, () => {
      const h = selected(zoom);
      const c = centre(h);
      hold(h, c, new Point(c.x + 30, c.y + 20));
      expect(readout(h, 'x=')).toMatchObject({ fontSize: 15, color: '0,0,0' });
    });

    it(`resize, at zoom ${String(zoom)}: "width=…, height=…" at 15`, () => {
      const h = selected(zoom);
      const br = h.bv.overlay.rect.corners()[2] as Point;
      hold(h, br, new Point(br.x + 30, br.y + 20));
      expect(readout(h, 'width=')).toMatchObject({ fontSize: 15, color: '0,0,0' });
    });

    it(`rotate, at zoom ${String(zoom)}: "angle=…" at 15`, () => {
      const h = selected(zoom);
      const r = h.bv.overlay.rect.corners()[0] as Point;
      hold(h, r, new Point(r.x + 30, r.y - 20));
      expect(readout(h, 'angle=')).toMatchObject({ fontSize: 15, color: '0,0,0' });
    });
  }
});
