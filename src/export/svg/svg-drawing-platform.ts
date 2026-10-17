// `SvgDrawingPlatform` (spec 08 §8): `DrawingPlatform` → SVG elements, the port of the
// `SVGDrawingPlatform` in C++ `L/SVGExporter.cpp`, with its structure kept: paths as
// `<path d="…">` with `M`/`L`/`Q`/`C`/`Z`, `<circle>`, `<ellipse>` (rotated about its centre),
// `<rect rx ry>`, `<image>` with base64 PNG data, the same style attributes (dashes, round caps,
// stroke and fill opacity) and the same tag layout and indentation.
//
// Fixed (DR-EXP-03): `saveContext`/`restoreContext` open and close a `<g>`; `translate` opens a
// `<g transform="translate(x y)">` and `clip` a `<g clip-path="url(#…)">` after its `<clipPath>`,
// both closed by the matching `restoreContext`. C++ left all four empty.
//
// The export view (`applyExportView`) offsets every coordinate, as C++ `TranslatedDrawingPlatform`
// did, so a board without clips keeps today's element coordinates (AC-EXP-29). Scale is 1.
//
// Other differences, each deliberate:
// - text: one `<text>` per laid-out block, one `<tspan>` per laid-out line at its `baselineY`
//   (1.18 pitch, spec 06 §4), `font-family` from the resolved font list (always quoted, with the
//   generic fallback); fill only (C++ also stroked the glyphs with the fill colour, which the
//   canvas never did); the SVG wraps nothing itself (C++ re-wrapped with its own measure);
// - gradients: `<linearGradient>`/`<radialGradient>` with every stop when the layout supplies the
//   computed gradient (DR-EXP-02; C++ SVG had none);
// - `addArc` draws its arc (C++ left it empty);
// - no stroke attributes for a zero stroke width, as the canvas strokes nothing then (C++ wrote
//   `stroke-width="0"`, which some renderers draw as a hairline);
// - images arrive as `DecodedImage`s and are encoded to PNG by the exporter after the draw, so
//   the output is a list of string parts and image slots.
import type { BezierCurve, PathStep, Point, Rect, Size } from '../../geometry';
import { PathStepType } from '../../geometry';
import type { ComputedGradient, DecodedImage, DrawingPlatform, ExportView, PathPaint } from '../../render';
import type { Color, Style } from '../../style';
import { PaintType } from '../../style';
import type { LaidOutText } from '../../text';

/** A part of the SVG text: a string, or an image to be encoded and inlined. */
export type SvgPart = string | { readonly image: DecodedImage };

const TAG_NONE = 0;
const NO_NEWLINE_BEFORE = 1;
const HAS_ATTRIBUTES = 2;

/** A number as the SVG writes it: at most 4 decimals, no trailing zeros, no `-0`. */
export function svgNum(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** C++ `XmlSerializer::escapeString`. */
export function escapeXml(s: string): string {
  return s.replace(/[&"'<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '"' ? '&quot;' : c === "'" ? '&apos;' : c === '<' ? '&lt;' : '&gt;',
  );
}

/** C++ `getColor`: `none` for a transparent colour, else `rgb(r, g, b)`. */
function svgColor(c: Color): string {
  if (c.alpha === 0) return 'none';
  return `rgb(${String(c.red)}, ${String(c.green)}, ${String(c.blue)})`;
}

function alphaStr(a: number): string {
  return String(Math.round((a / 255) * 1e6) / 1e6);
}

function toDegree(rad: number): number {
  return (rad * 180) / Math.PI;
}

type PathCmd = { k: 'M' | 'L'; x: number; y: number } | { k: 'Z' } | { k: 'C'; c: BezierCurve } | { k: 'A'; d: string };

export class SvgDrawingPlatform implements DrawingPlatform {
  private readonly parts_: SvgPart[] = [];
  private cur_ = '';
  private indent_ = 0;
  private style_: Style | null = null;
  private gradient_: ComputedGradient | null = null;
  private path_: PathCmd[] = [];
  private dx_ = 0;
  private dy_ = 0;
  /** Per save level: how many `<g>` were opened (the save's own included). */
  private readonly groups_: number[] = [];
  private nextId_ = 0;
  private readonly idPrefix_: string;

  /** `idPrefix` keeps `<clipPath>`/gradient ids unique when several pages share a document. */
  constructor(opts: { idPrefix?: string } = {}) {
    this.idPrefix_ = opts.idPrefix ?? 'lk';
  }

  // ---- document ----

  /** C++ `start`: the prolog, the `<svg>` root with the page size and background, and `<desc>`. */
  start(width: number, height: number, background: { color?: Color; imageBase64?: string } | null): void {
    this.cur_ += '<?xml version="1.0" standalone="no"?>\n';
    this.cur_ += '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"\n\t';
    this.cur_ += '"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n';
    this.startTag('svg', HAS_ATTRIBUTES);
    this.cur_ += ` width="${svgNum(width)}"`;
    this.cur_ += ` height="${svgNum(height)}"`;
    this.cur_ += ` viewBox="0 0 ${svgNum(width)} ${svgNum(height)}" `;
    if (background !== null) {
      if (background.imageBase64 !== undefined && background.imageBase64 !== '') {
        this.cur_ += `style="background-image: url(data:image/png;base64,${background.imageBase64});" `;
      } else if (background.color !== undefined) {
        const c = background.color;
        this.cur_ += `style="background-color: rgb(${String(c.red)}, ${String(c.green)}, ${String(c.blue)})" `;
      }
    }
    this.cur_ += 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"  version="1.1">';
    this.startTag('desc');
    this.cur_ += 'Lekh Diagram';
    this.endTag('desc', NO_NEWLINE_BEFORE);
  }

  /** C++ `finish`: closes any group still open and the root. */
  finish(): void {
    this.finishPath();
    while (this.groups_.length > 0) this.closeLevel();
    this.endTag('svg');
  }

  /** The SVG as string parts and image slots, in order. */
  parts(): SvgPart[] {
    if (this.cur_ !== '') {
      this.parts_.push(this.cur_);
      this.cur_ = '';
    }
    return this.parts_;
  }

  applyExportView(view: ExportView): void {
    this.dx_ += view.tx;
    this.dy_ += view.ty;
  }

  // ---- paths ----

  startDrawing(pt: Point, style: Style, paint?: PathPaint): void {
    this.style_ = style;
    this.gradient_ = paint?.fillGradient ?? null;
    this.path_ = [{ k: 'M', x: pt.x, y: pt.y }];
  }

  endDrawing(): void {
    this.finishPath();
  }

  closePath(): void {
    this.path_.push({ k: 'Z' });
  }

  addLineTo(pt: Point): void {
    this.path_.push({ k: 'L', x: pt.x, y: pt.y });
  }

  /** C++: a move right after a move replaces it. */
  moveTo(pt: Point): void {
    const last = this.path_[this.path_.length - 1];
    if (last?.k === 'M') {
      last.x = pt.x;
      last.y = pt.y;
      return;
    }
    this.path_.push({ k: 'M', x: pt.x, y: pt.y });
  }

  addCurve(curve: BezierCurve): void {
    this.path_.push({ k: 'C', c: curve });
  }

  addCircle(center: Point, radius: number): void {
    this.finishPath();
    this.startTag('circle', HAS_ATTRIBUTES);
    this.addStyles();
    this.cur_ += ` cx="${this.x(center.x)}" cy="${this.y(center.y)}" r="${svgNum(radius)}"`;
    this.endTag();
  }

  /** A clockwise arc as a path (C++ drew nothing). */
  addArc(center: Point, radius: number, startAngle: number, endAngle: number): void {
    const x0 = center.x + radius * Math.cos(startAngle);
    const y0 = center.y + radius * Math.sin(startAngle);
    const x1 = center.x + radius * Math.cos(endAngle);
    const y1 = center.y + radius * Math.sin(endAngle);
    let sweep = endAngle - startAngle;
    while (sweep < 0) sweep += 2 * Math.PI;
    const large = sweep > Math.PI ? 1 : 0;
    const r = svgNum(radius);
    this.path_ = [
      { k: 'M', x: x0, y: y0 },
      { k: 'A', d: `${r},${r} 0 ${String(large)},1 ${this.x(x1)},${this.y(y1)}` },
    ];
  }

  addEllipse(center: Point, width: number, height: number, rotation: number): void {
    this.finishPath();
    this.startTag('ellipse', HAS_ATTRIBUTES);
    this.addStyles();
    this.cur_ += ` cx="${this.x(center.x)}" cy="${this.y(center.y)}" `;
    this.cur_ += ` rx="${svgNum(width / 2)}" ry="${svgNum(height / 2)}"`;
    if (rotation !== 0) {
      this.cur_ += ` transform="rotate(${svgNum(toDegree(rotation))} ${this.x(center.x)} ${this.y(center.y)})"`;
    }
    this.endTag();
  }

  addRoundedRect(rect: Rect): void {
    this.finishPath();
    const r = Math.min(rect.width, rect.height) / 5; // LekhUtil::getCornerRadius
    this.startTag('rect', HAS_ATTRIBUTES);
    this.addStyles();
    this.cur_ += ` x="${this.x(rect.x)}" y="${this.y(rect.y)}" width="${svgNum(rect.width)}" height="${svgNum(rect.height)}"`;
    this.cur_ += ` rx="${svgNum(r)}" ry="${svgNum(r)}"`;
    this.endTag();
  }

  // ---- text and images ----

  drawText(t: LaidOutText, style: Style): void {
    this.finishPath();
    if (t.lines.length === 0) return;
    const font = parseFont(t.font);
    const anchor = t.align === 'left' ? 'start' : t.align === 'right' ? 'end' : 'middle';
    const fill = style.effectiveTextFill();
    const color = fill.type === PaintType.Solid ? svgColor(fill.solidColor) : 'black';
    let css = `font-family:${font.families}; font-size:${svgNum(t.px)}px; `;
    if (font.weight !== '400' && font.weight !== 'normal')
      css += ` font-weight:${font.weight === '700' ? 'bold' : font.weight}; `;
    if (font.style !== 'normal') css += ` font-style:${font.style}; `;
    if (t.underline || t.strikeThrough) {
      css += ' text-decoration: ';
      if (t.underline) css += ' underline';
      if (t.strikeThrough) css += ' line-through';
      css += '; ';
    }
    css += ` fill:${color}; `;
    if (fill.type === PaintType.Solid && fill.solidColor.alpha !== 255 && fill.solidColor.alpha !== 0) {
      css += ` fill-opacity:${alphaStr(fill.solidColor.alpha)}; `;
    }
    if (t.stretch !== 'normal' && t.stretch !== '') css += ` font-stretch:${t.stretch}; `;
    const baseline = t.baseline === 'top' ? ' dominant-baseline: text-before-edge;' : '';
    this.startTag('text', HAS_ATTRIBUTES);
    this.cur_ += ` style="${escapeXml(css)}${baseline} text-anchor: ${anchor};"`;
    if (t.angle !== 0) {
      const cx = t.box.x + t.box.width / 2;
      const cy = t.box.y + t.box.height / 2;
      this.cur_ += ` transform="rotate(${svgNum(toDegree(t.angle))} ${this.x(cx)} ${this.y(cy)})"`;
    }
    this.cur_ += '>';
    for (const line of t.lines) {
      this.startTag('tspan', HAS_ATTRIBUTES);
      // `text-anchor` follows the line's direction in SVG, while the canvas aligns absolutely
      // (`textAlign` left/right); an RTL line swaps start and end to land where the canvas puts it.
      const rtl = line.dir === 'rtl';
      const a = rtl && anchor !== 'middle' ? (anchor === 'start' ? 'end' : 'start') : null;
      this.cur_ += ` x="${this.x(line.x)}" y="${this.y(line.baselineY)}"`;
      if (rtl) this.cur_ += ' direction="rtl" unicode-bidi="embed"';
      if (a !== null) this.cur_ += ` text-anchor="${a}"`;
      this.cur_ += `>${escapeXml(line.text)}`;
      this.endTag('tspan', NO_NEWLINE_BEFORE);
    }
    this.endTag('text');
  }

  drawImage(center: Point, size: Size, rotation: number, image: DecodedImage | null | undefined): void {
    this.finishPath();
    if (image === null || image === undefined) return;
    const x = center.x - size.width / 2;
    const y = center.y - size.height / 2;
    this.startTag('image', HAS_ATTRIBUTES);
    this.cur_ += `x="${this.x(x)}" y="${this.y(y)}" width="${svgNum(size.width)}" height="${svgNum(size.height)}" `;
    if (rotation !== 0) {
      this.cur_ += `transform="rotate(${svgNum(toDegree(rotation))} ${this.x(center.x)} ${this.y(center.y)})" `;
    }
    this.cur_ += 'xlink:href="data:image/png;base64,';
    this.parts_.push(this.cur_);
    this.cur_ = '';
    this.parts_.push({ image });
    this.cur_ += '"';
    this.endTag();
  }

  // ---- state (DR-EXP-03) ----

  saveContext(): void {
    this.finishPath();
    this.startTag('g');
    this.groups_.push(1);
  }

  restoreContext(): void {
    this.finishPath();
    if (this.groups_.length === 0) return;
    this.closeLevel();
  }

  translate(x: number, y: number): void {
    this.finishPath();
    this.openGroup(`transform="translate(${svgNum(x)} ${svgNum(y)})"`);
  }

  clip(path: readonly PathStep[]): void {
    this.finishPath();
    if (path.length === 0) return;
    const id = `${this.idPrefix_}clip${String(++this.nextId_)}`;
    let d = '';
    for (const p of path) {
      switch (p.type) {
        case PathStepType.Move:
          d += ` M ${this.x(p.p1.x)},${this.y(p.p1.y)} `;
          break;
        case PathStepType.Line:
          d += ` L ${this.x(p.p1.x)},${this.y(p.p1.y)} `;
          break;
        case PathStepType.Quad:
          d += ` Q ${this.x(p.p1.x)},${this.y(p.p1.y)} ${this.x(p.p2.x)},${this.y(p.p2.y)} `;
          break;
        case PathStepType.Cubic:
          d += ` C ${this.x(p.p1.x)},${this.y(p.p1.y)} ${this.x(p.p2.x)},${this.y(p.p2.y)} ${this.x(p.p3.x)},${this.y(p.p3.y)} `;
          break;
        case PathStepType.Close:
          d += ' Z ';
          break;
        default:
          break; // Arc: no sweep in a PathStep; skipped as the canvas skips it
      }
    }
    this.startTag('clipPath', HAS_ATTRIBUTES);
    this.cur_ += `id="${id}">`;
    this.startTag('path', HAS_ATTRIBUTES);
    this.cur_ += ` d="${d}"`;
    this.endTag();
    this.endTag('clipPath');
    this.openGroup(`clip-path="url(#${id})"`);
  }

  // ---- internals ----

  private x(v: number): string {
    return svgNum(v + this.dx_);
  }

  private y(v: number): string {
    return svgNum(v + this.dy_);
  }

  private openGroup(attrs: string): void {
    this.startTag('g', HAS_ATTRIBUTES);
    this.cur_ += `${attrs}>`;
    const n = this.groups_.length;
    if (n === 0) this.groups_.push(1);
    else this.groups_[n - 1] = (this.groups_[n - 1] ?? 0) + 1;
  }

  private closeLevel(): void {
    const n = this.groups_.pop() ?? 0;
    for (let i = 0; i < n; i++) this.endTag('g');
  }

  private finishPath(): void {
    const cmds = this.path_;
    this.path_ = [];
    if (cmds.length === 0 || this.style_ === null) return;
    let count = 0;
    let d = '';
    for (const c of cmds) {
      if (c.k !== 'M') count++;
      switch (c.k) {
        case 'M':
          d += ` M ${this.x(c.x)},${this.y(c.y)} `;
          break;
        case 'L':
          d += ` L ${this.x(c.x)},${this.y(c.y)} `;
          break;
        case 'Z':
          d += ' Z ';
          break;
        case 'A':
          d += ` A ${c.d} `;
          break;
        default: {
          const v = c.c;
          if (v.numPoints === 2) d += ` L ${this.x(v.point2.x)},${this.y(v.point2.y)} `;
          else if (v.numPoints === 3)
            d += ` Q ${this.x(v.point2.x)},${this.y(v.point2.y)} ${this.x(v.point3.x)},${this.y(v.point3.y)} `;
          else {
            d += ` C ${this.x(v.point2.x)},${this.y(v.point2.y)} ${this.x(v.point3.x)},${this.y(v.point3.y)} `;
            d += `${this.x(v.point4.x)},${this.y(v.point4.y)} `;
          }
        }
      }
    }
    if (count === 0) return;
    this.startTag('path', HAS_ATTRIBUTES);
    this.addStyles();
    this.cur_ += ` d="${d}"`;
    this.endTag();
  }

  /** C++ `addStyles(true)`: dashes, round cap, stroke (if painted and wider than 0), fill (gradient when computed). */
  private addStyles(): void {
    const style = this.style_;
    if (style === null) return;
    const dash = style.effectiveDashArray();
    if (dash.length > 0) this.cur_ += ` stroke-dasharray="${dash.map((v) => svgNum(v)).join(', ')}" `;
    this.cur_ += ' stroke-linecap="round" ';
    const sp = style.effectiveStrokePaint();
    if (sp.type !== PaintType.NoPaint && style.effectiveStrokeWidth() > 0) {
      this.cur_ += ` stroke-width="${svgNum(style.effectiveStrokeWidth())}" stroke="${svgColor(sp.solidColor)}"`;
      if (sp.solidColor.alpha !== 255) this.cur_ += ` stroke-opacity="${alphaStr(sp.solidColor.alpha)}"`;
    }
    const fp = style.effectiveFillPaint();
    let fill = 'none';
    const g = this.gradient_;
    if (style.fill())
      fill = g !== null && g.stops.length > 1 ? `url(#${this.gradientDef(g)})` : svgColor(fp.solidColor);
    this.cur_ += ` fill="${fill}"`;
    if (style.fill() && (g === null || g.stops.length <= 1) && fp.solidColor.alpha !== 255) {
      this.cur_ += ` fill-opacity="${alphaStr(fp.solidColor.alpha)}"`;
    }
  }

  /** Writes a gradient definition before the element being styled and returns its id. */
  private gradientDef(g: ComputedGradient): string {
    const id = `${this.idPrefix_}grad${String(++this.nextId_)}`;
    // The element's tag is already open: write the definition in front of it.
    const open = this.cur_.lastIndexOf('<');
    const head = this.cur_.slice(0, open);
    const tail = this.cur_.slice(open);
    let def = '';
    if (g.type === 'linear') {
      def += `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${this.x(g.x1)}" y1="${this.y(g.y1)}" x2="${this.x(g.x2)}" y2="${this.y(g.y2)}">`;
    } else {
      def += `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${this.x(g.cx)}" cy="${this.y(g.cy)}" r="${svgNum(g.r)}" fx="${this.x(g.fx)}" fy="${this.y(g.fy)}" fr="${svgNum(g.fr)}">`;
    }
    for (const s of g.stops) {
      def += `<stop offset="${svgNum(s.offset)}" stop-color="${svgColor(s.color) === 'none' ? 'rgb(0, 0, 0)' : svgColor(s.color)}"`;
      if (s.color.alpha !== 255) def += ` stop-opacity="${alphaStr(s.color.alpha)}"`;
      def += '/>';
    }
    def += g.type === 'linear' ? '</linearGradient>' : '</radialGradient>';
    const lineStart = head.lastIndexOf('\n');
    const indent = head.slice(lineStart + 1);
    this.cur_ = `${head}${def}\n${indent}${tail}`;
    return id;
  }

  private startTag(tag: string, flags = TAG_NONE): void {
    if ((flags & NO_NEWLINE_BEFORE) === 0) this.cur_ += '\n';
    this.cur_ += '  '.repeat(this.indent_);
    this.cur_ += `<${tag}`;
    this.cur_ += (flags & HAS_ATTRIBUTES) !== 0 ? ' ' : '>';
    this.indent_++;
  }

  private endTag(tag = '', flags = TAG_NONE): void {
    this.indent_--;
    if (tag === '') {
      this.cur_ += '/>';
      return;
    }
    if ((flags & NO_NEWLINE_BEFORE) === 0) {
      this.cur_ += '\n';
      this.cur_ += '  '.repeat(this.indent_);
    }
    this.cur_ += `</${tag}>`;
  }
}

/** The parts of a `buildCanvasFont` string: `${style} ${weight} ${px}px ${families}`. */
function parseFont(font: string): { style: string; weight: string; families: string } {
  const m = /^(\S+) (\S+) [^ ]+px (.+)$/.exec(font);
  if (m === null) return { style: 'normal', weight: '400', families: 'sans-serif' };
  return { style: m[1] ?? 'normal', weight: m[2] ?? '400', families: m[3] ?? 'sans-serif' };
}
