// The grid layer: the page background colour and the grid lines (port of C++
// `CanvasWidget::drawBackground`, `object/widget/CanvasWidget.cpp:402-489`).
//
// Painted in screen space (CSS px; the host applies the DPR, `ViewTransform.applyScreen`): the grid
// spacing and line width are multiplied by the zoom and the lines are offset by the zoomed scroll,
// as in C++, so the grid canvas is never zoomed by a transform.
//
// As in C++, an image background is painted white ("TODO: handle image background"). Lines
// alternate between two greys, the phase following the scroll so they do not swap while panning.
// Differences: plain doubles where C++ used `float`, and a non-positive grid width paints no
// lines (C++ looped forever).
import { Point } from '../geometry';
import { Color, Style } from '../style';
import type { DrawingPlatform } from './drawing-platform';

/** The page background as the grid layer needs it (model `PageBackground`, C++ `LekhBackground`). */
export interface GridBackground {
  readonly type: 'default' | 'color' | 'image';
  /** Used when `type === 'color'`. */
  readonly color?: Color;
}

export type ThemeMode = 'light' | 'dark';

export interface GridPaintInput {
  readonly background: GridBackground;
  /** C++ `document()->grid().present`. */
  readonly gridPresent: boolean;
  /** C++ `document()->gridWidth().points()`: grid spacing in canvas units. */
  readonly gridWidth: number;
  /** Zoom factor (1 = 100 %). */
  readonly zoom: number;
  /** Scroll in canvas units (0, 0 on a finite canvas: C++ `computeSize` resets it). */
  readonly scrollX: number;
  readonly scrollY: number;
  /** C++ `effectiveCanvasWidth_` / `effectiveCanvasHeight_`, in CSS px. */
  readonly width: number;
  readonly height: number;
  /** An infinite canvas has no border; a finite page gets a 2 px separator-coloured one. */
  readonly infiniteCanvas: boolean;
  /** Picks the separator colour (C++ `Theme::mode()`, light by default). */
  readonly theme?: ThemeMode;
}

/** C++ `system_opaq_separator_color` (`WidgetStyle.cpp:37`): `{ dark, light }`. */
export const SEPARATOR_COLOR: Readonly<Record<ThemeMode, Color>> = Object.freeze({
  dark: Object.freeze(new Color(56, 56, 58)),
  light: Object.freeze(new Color(198, 198, 200)),
});
export const GRID_LINE_COLOR_1: Color = Object.freeze(new Color(215, 215, 215));
export const GRID_LINE_COLOR_2: Color = Object.freeze(new Color(234, 234, 234));
const WHITE: Color = Object.freeze(new Color(255, 255, 255, 255));

export class GridPainter {
  paint(dp: DrawingPlatform, input: GridPaintInput): void {
    const { width: cw, height: ch } = input;

    const back = new Style();
    back.setFillColor(input.background.type === 'color' ? (input.background.color ?? WHITE) : WHITE);
    back.setStrokeWidth(0);
    if (!input.infiniteCanvas) {
      back.setStrokeWidth(2);
      back.setStrokeColor(SEPARATOR_COLOR[input.theme ?? 'light']);
    }
    dp.startDrawing(new Point(0, 0), back);
    dp.addLineTo(new Point(cw, 0));
    dp.addLineTo(new Point(cw, ch));
    dp.addLineTo(new Point(0, ch));
    dp.closePath();
    dp.endDrawing();

    if (!input.gridPresent) return;
    const zoom = input.zoom;
    const width = input.gridWidth * zoom;
    if (!(width > 0)) return;

    const style1 = new Style();
    const style2 = new Style();
    style1.setStrokeColor(GRID_LINE_COLOR_1);
    style2.setStrokeColor(GRID_LINE_COLOR_2);
    style1.setStrokeWidth(zoom);
    style2.setStrokeWidth(zoom);

    const sx = input.scrollX * zoom;
    const sy = input.scrollY * zoom;
    const [startx, oddx] = phase(sx, width);
    const [starty, oddy] = phase(sy, width);

    const w = Math.trunc(cw);
    const h = Math.trunc(ch);

    let styles = oddx ? [style2, style1] : [style1, style2];
    for (let i = 0; i * width < w + width; i++) {
      dp.startDrawing(new Point(i * width + startx, 0), pick(styles, i));
      dp.addLineTo(new Point(i * width + startx, h));
      dp.endDrawing();
    }

    styles = oddy ? [style2, style1] : [style1, style2];
    for (let i = 0; i * width < h + width; i++) {
      dp.startDrawing(new Point(0, i * width + starty), pick(styles, i));
      dp.addLineTo(new Point(w, i * width + starty));
      dp.endDrawing();
    }
  }
}

/** The first line's offset and whether the alternation starts on the second colour. */
function phase(scroll: number, width: number): [number, boolean] {
  if (scroll < 0) {
    return [width - (-scroll % width), Math.trunc(-scroll / width) % 2 === 0];
  }
  return [scroll % width, Math.trunc(scroll / width) % 2 === 1];
}

function pick(styles: readonly Style[], i: number): Style {
  const s = styles[i % 2];
  if (s === undefined) throw new RangeError('grid style');
  return s;
}
