// The three icons the overlay draws on the canvas (spec 05 §4.4, §7.4; spec 02 `CanvasGlyphs`),
// as path data in a unit box: each coordinate is a factor of the drawn width (x) or height (y)
// about the centre, as the C++ icon templates (`res/icons/svg_icons.json`, `icons.json`) state them. They are drawn
// through `DrawingPlatform` (canvas, and a recording platform in tests); `glyphSvgPath` gives the
// same path as SVG path data for a DOM `Path2D`. They are exempt from the React `iconMap`.
import type { Rect } from '../geometry';
import { BezierCurve, Point } from '../geometry';
import type { DrawingPlatform } from '../render';
import { Color, Style } from '../style';

export type GlyphId = 'lekhapp.ui.sel_rect_rotate' | 'lekhapp.ui.erase_dragger' | 'lekhapp.ui.zoom_info';

/** One sub-path: a move, then lines (`L`) and cubics (`C`, three points each), optionally closed. */
export interface GlyphPath {
  readonly d: readonly (
    readonly ['M' | 'L', number, number] | readonly ['C', number, number, number, number, number, number]
  )[];
  /** 'none' | a colour (ARGB int) for the fill; the stroke likewise; `undefined` = the caller's. */
  readonly fill?: number | 'none';
  readonly stroke?: number | 'none';
}

export interface Glyph {
  readonly id: GlyphId;
  readonly paths: readonly GlyphPath[];
}

/** Builds the path list from a template's `data` (factor pairs) and its `M 0 1 C 2 3 …` paths. */
function fromTemplate(
  data: readonly number[],
  draws: readonly { path: string; fill?: number | 'none'; stroke?: number | 'none' }[],
): GlyphPath[] {
  const pt = (i: number): [number, number] => [data[2 * i] ?? 0, data[2 * i + 1] ?? 0];
  return draws.map((dw) => {
    const tok = dw.path.trim().split(/\s+/);
    const d: GlyphPath['d'][number][] = [];
    let k = 0;
    while (k < tok.length) {
      const op = tok[k++];
      if (op === 'M' || op === 'L') {
        const [x, y] = pt(Number(tok[k]) / 2);
        k += 2;
        d.push(Object.freeze([op, x, y] as const));
      } else if (op === 'C') {
        const [x1, y1] = pt(Number(tok[k]) / 2);
        const [x2, y2] = pt(Number(tok[k + 2]) / 2);
        const [x3, y3] = pt(Number(tok[k + 4]) / 2);
        k += 6;
        d.push(Object.freeze(['C', x1, y1, x2, y2, x3, y3] as const));
      } else {
        k++;
      }
    }
    return Object.freeze({
      d: Object.freeze(d),
      ...(dw.fill !== undefined ? { fill: dw.fill } : {}),
      ...(dw.stroke !== undefined ? { stroke: dw.stroke } : {}),
    });
  });
}

// prettier-ignore
const SEL_RECT_ROTATE_DATA = Object.freeze([
  -0.5, -0.5, -0.166667, -0.5, 0.166667, -0.5, 0.5, -0.5, 0.5, -0.166667, 0.5, 0.166667, 0.5, 0.5,
  0.166667, 0.5, -0.166667, 0.5, -0.5, 0.5, -0.5, 0.166667, -0.5, -0.166667, -0.5, -0.5,
  0.33125, 0.333333, 0.33125, 0.263889, 0.33125, 0.194444, 0.33125, 0.125, 0.261806, 0.125, 0.192361, 0.125,
  0.122917, 0.125, 0.33125, -0.0416667, 0.309451, -0.207972, 0.167475, -0.332178, -0.000252803, -0.331676,
  -0.16798, -0.331175, -0.309211, -0.206122, -0.330015, -0.0396893, -0.350819, 0.126744, -0.244716, 0.282713,
  -0.082273, 0.324486, 0.0801701, 0.366258, 0.248352, 0.280822, 0.310417, 0.125,
]);

// prettier-ignore
const ERASE_DRAGGER_DATA = Object.freeze([
  0.5, 0, 0.5, 0.276142, 0.276142, 0.5, 0, 0.5, -0.276142, 0.5, -0.5, 0.276142, -0.5, 0, -0.5, -0.276142,
  -0.276142, -0.5, 0, -0.5, 0.276142, -0.5, 0.5, -0.276142, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0,
  0.146341, 0, 0.146341, 0.0808222, 0.0808222, 0.146341, 0, 0.146341, -0.0808222, 0.146341, -0.146341, 0.0808222,
  -0.146341, 0, -0.146341, -0.0808222, -0.0808222, -0.146341, 0, -0.146341, 0.0808222, -0.146341, 0.146341, -0.0808222,
  0.146341, 0, 0.146341, 0, 0.146341, 0, 0.146341, 0,
]);

const ZOOM_INFO_DATA = Object.freeze([-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5]);

/** Template paths use data indices (x index, y index); `fromTemplate` halves them into pairs. */
export const CANVAS_GLYPHS: Readonly<Record<GlyphId, Glyph>> = Object.freeze({
  'lekhapp.ui.sel_rect_rotate': Object.freeze({
    id: 'lekhapp.ui.sel_rect_rotate',
    paths: Object.freeze(
      fromTemplate(SEL_RECT_ROTATE_DATA, [
        {
          path: 'M 0 1 C 2 3 4 5 6 7 C 8 9 10 11 12 13 C 14 15 16 17 18 19 C 20 21 22 23 24 25',
          fill: 'none',
          stroke: 'none',
        },
        {
          path: 'M 26 27 C 28 29 30 31 32 33 C 34 35 36 37 38 39 M 40 41 C 42 43 44 45 46 47 C 48 49 50 51 52 53 C 54 55 56 57 58 59 C 60 61 62 63 64 65',
          fill: 'none',
          stroke: -16777216,
        },
      ]),
    ),
  }),
  'lekhapp.ui.erase_dragger': Object.freeze({
    id: 'lekhapp.ui.erase_dragger',
    paths: Object.freeze(
      fromTemplate(ERASE_DRAGGER_DATA, [
        {
          path: 'M 0 1 C 2 3 4 5 6 7 C 8 9 10 11 12 13 C 14 15 16 17 18 19 C 20 21 22 23 24 25 C 26 27 28 29 30 31',
          fill: 'none',
          stroke: -16777216,
        },
        {
          path: 'M 32 33 C 34 35 36 37 38 39 C 40 41 42 43 44 45 C 46 47 48 49 50 51 C 52 53 54 55 56 57 C 58 59 60 61 62 63',
          fill: -16777216,
          stroke: -16777216,
        },
      ]),
    ),
  }),
  'lekhapp.ui.zoom_info': Object.freeze({
    id: 'lekhapp.ui.zoom_info',
    paths: Object.freeze(fromTemplate(ZOOM_INFO_DATA, [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 L 0 1', fill: -436207616 }])),
  }),
});

/** The glyph's paths at `rect` (rotated by `angle` about its centre) as SVG path data. */
export function glyphSvgPath(id: GlyphId, rect: Rect, angle = 0): string[] {
  const c = rect.center();
  const map = (fx: number, fy: number): Point =>
    rotateAbout(new Point(c.x + fx * rect.width, c.y + fy * rect.height), c, angle);
  return CANVAS_GLYPHS[id].paths.map((p) =>
    p.d
      .map((s) => {
        if (s[0] === 'C') {
          const a = map(s[1], s[2]);
          const b = map(s[3], s[4]);
          const e = map(s[5], s[6]);
          return `C ${fmt(a.x)} ${fmt(a.y)} ${fmt(b.x)} ${fmt(b.y)} ${fmt(e.x)} ${fmt(e.y)}`;
        }
        const q = map(s[1], s[2]);
        return `${s[0]} ${fmt(q.x)} ${fmt(q.y)}`;
      })
      .join(' '),
  );
}

function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

function rotateAbout(p: Point, c: Point, angle: number): Point {
  if (angle === 0) return p;
  const s = Math.sin(angle);
  const co = Math.cos(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return new Point(c.x + dx * co - dy * s, c.y + dx * s + dy * co);
}

export interface GlyphPaint {
  /** Used for a path whose own fill/stroke is unset. */
  readonly fill?: Color | null;
  readonly stroke?: Color | null;
  readonly strokeWidth?: number;
}

/** Draws the glyph into `rect` (view coordinates) through `dp` (C++ `ShapeTemplate::draw`). */
export function drawGlyph(dp: DrawingPlatform, id: GlyphId, rect: Rect, angle = 0, paint: GlyphPaint = {}): void {
  const c = rect.center();
  const map = (fx: number, fy: number): Point =>
    rotateAbout(new Point(c.x + fx * rect.width, c.y + fy * rect.height), c, angle);
  for (const p of CANVAS_GLYPHS[id].paths) {
    const style = new Style();
    style.setStrokeWidth(paint.strokeWidth ?? 1);
    const fill = p.fill === 'none' ? null : p.fill !== undefined ? Color.fromInt(p.fill) : (paint.fill ?? null);
    const stroke =
      p.stroke === 'none'
        ? (paint.stroke ?? null)
        : p.stroke !== undefined
          ? Color.fromInt(p.stroke)
          : (paint.stroke ?? null);
    if (fill === null) style.setNoFill();
    else style.setFillColor(fill);
    if (stroke === null) style.setStrokeWidth(0);
    else style.setStrokeColor(stroke);
    let cur = new Point();
    let started = false;
    for (const s of p.d) {
      if (s[0] === 'M') {
        cur = map(s[1], s[2]);
        if (!started) {
          dp.startDrawing(cur, style);
          started = true;
        }
        dp.moveTo(cur);
      } else if (s[0] === 'L') {
        cur = map(s[1], s[2]);
        dp.addLineTo(cur);
      } else {
        const c = s as readonly ['C', number, number, number, number, number, number];
        const a = map(c[1], c[2]);
        const b = map(c[3], c[4]);
        const e = map(c[5], c[6]);
        dp.addCurve(new BezierCurve(cur, a, b, e));
        cur = e;
      }
    }
    if (started) dp.endDrawing();
  }
}
