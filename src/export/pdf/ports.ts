// The third-party surfaces the PDF writer uses, as structural types (spec 08 §7). Only
// `pdf/index.ts` imports `pdfkit`, `fontkit` and `bidi-js`; every other file here sees these
// interfaces, so the writer is tested with the real modules and nothing else knows them.

/** A PDFKit colour: `[r, g, b]` 0-255, or a gradient made by the document. */
export type PdfColor = readonly [number, number, number] | PdfGradient;

export interface PdfGradient {
  stop(offset: number, color: readonly [number, number, number], opacity?: number): PdfGradient;
}

/** An image PDFKit opened once (`openImage`); drawing it again reuses the XObject. */
export type PdfImage = object;

/** The `PDFDocument` methods the writer calls (PDFKit 0.20). */
export interface PdfDocument {
  on(event: 'data', listener: (chunk: Uint8Array) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: unknown) => void): this;
  addPage(opts: { size: [number, number]; margin: number }): this;
  end(): void;
  save(): this;
  restore(): this;
  scale(s: number): this;
  translate(x: number, y: number): this;
  rotate(deg: number, opts?: { origin?: [number, number] }): this;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): this;
  moveTo(x: number, y: number): this;
  lineTo(x: number, y: number): this;
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): this;
  quadraticCurveTo(a: number, b: number, c: number, d: number): this;
  closePath(): this;
  rect(x: number, y: number, w: number, h: number): this;
  fill(rule?: 'even-odd' | 'non-zero'): this;
  stroke(): this;
  fillAndStroke(rule?: 'even-odd' | 'non-zero'): this;
  clip(rule?: 'even-odd' | 'non-zero'): this;
  fillColor(color: PdfColor, opacity?: number): this;
  strokeColor(color: PdfColor, opacity?: number): this;
  lineWidth(w: number): this;
  lineCap(c: 'butt' | 'round' | 'square'): this;
  lineJoin(j: 'miter' | 'round' | 'bevel'): this;
  linearGradient(x1: number, y1: number, x2: number, y2: number): PdfGradient;
  radialGradient(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): PdfGradient;
  addContent(op: string): this;
  registerFont(name: string, font: FontkitFont): this;
  font(name: string): this;
  fontSize(px: number): this;
  text(
    text: string,
    x: number,
    y: number,
    opts: { lineBreak: false; baseline: 'alphabetic'; features: string[]; oblique?: number },
  ): this;
  openImage(bytes: Uint8Array): PdfImage;
  image(img: PdfImage, x: number, y: number, opts: { width: number; height: number }): this;
}

export interface PdfDocumentOptions {
  readonly autoFirstPage: false;
  readonly compress: boolean;
  /** `null`: no standard font is loaded (the browser build has none registered). */
  readonly font: null;
  /** The document information dictionary (PDFKit's defaults are Creator and Producer "PDFKit"). */
  readonly info: { readonly Title: string; readonly Creator: string; readonly Producer: string };
}

export type PdfDocumentCtor = new (opts: PdfDocumentOptions) => PdfDocument;

// ---- fontkit 2 ----

export interface FontkitPathCommand {
  readonly command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
  readonly args: readonly number[];
}

export interface FontkitGlyph {
  readonly id: number;
  readonly codePoints: readonly number[];
  readonly path: { readonly commands: readonly FontkitPathCommand[] };
}

export interface FontkitPosition {
  readonly xAdvance: number;
  readonly yAdvance: number;
  readonly xOffset: number;
  readonly yOffset: number;
}

export interface FontkitGlyphRun {
  readonly glyphs: readonly FontkitGlyph[];
  readonly positions: readonly FontkitPosition[];
  readonly advanceWidth: number;
  readonly direction?: 'ltr' | 'rtl';
}

/** OS/2 `fsType` as fontkit parses it (a bitfield object). */
export interface FontkitFsType {
  readonly noEmbedding?: boolean;
  readonly viewOnly?: boolean;
  readonly editable?: boolean;
  readonly noSubsetting?: boolean;
  readonly bitmapOnly?: boolean;
}

export interface FontkitFont {
  readonly postscriptName: string | null;
  readonly familyName?: string | null;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly italicAngle?: number;
  readonly directory?: { readonly tables?: Record<string, unknown> };
  readonly 'OS/2'?: {
    readonly fsType?: FontkitFsType | number;
    readonly fsSelection?: { readonly italic?: boolean };
    readonly usWeightClass?: number;
  };
  readonly variationAxes?: Record<string, { min: number; default: number; max: number }>;
  hasGlyphForCodePoint(cp: number): boolean;
  layout(text: string, features?: string[]): FontkitGlyphRun;
  getVariation?(settings: Record<string, number>): FontkitFont;
}

/** A TrueType collection (`fontkit.create` on a `.ttc` without a PostScript name). */
export interface FontkitCollection {
  readonly fonts: readonly FontkitFont[];
}

export interface FontkitModule {
  create(bytes: Uint8Array, postscriptName?: string): FontkitFont | FontkitCollection | null;
}

// ---- bidi-js ----

export interface BidiEngine {
  getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): { levels: Uint8Array };
  getMirroredCharacter(char: string): string | null;
  getBidiCharTypeName(char: string): string;
}

/** Everything `PdfExporter` needs from the three modules (wired by `pdf/index.ts`). */
export interface PdfModules {
  readonly PDFDocument: PdfDocumentCtor;
  readonly fontkit: FontkitModule;
  readonly bidi: BidiEngine;
}
