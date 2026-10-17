// Shared pieces of the PDF suites: the bundled fonts read from lekhjs/fonts, fixture fonts, fake
// providers, a PDF env, boards of text boxes, and pdf.js parsing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ExportEnv, FontData, FontRequest } from '../../src/export';
import type { FontDataProvider } from '../../src/export/pdf';
import { BundledFontSource, createPdfRenderer, type PdfExporterOptions } from '../../src/export/pdf';
import { BoardSession } from '../../src/session';
import { FakeImagePort, FakeScheduler } from '../../src/testing';
import { FontRegistry, type FontsManifest } from '../../src/text';
import { testRuntime } from '../session/helpers';
import { env } from './helpers';

export const PKG = path.resolve(import.meta.dirname, '..', '..');
export const FONTS_DIR = path.join(PKG, 'fonts');
export const TEST_FONTS = path.join(PKG, 'test', 'fixtures', 'fonts');

export function fontBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(TEST_FONTS, file)));
}

/** The bundled registry with absolute TTF paths. */
export function bundledRegistry(): FontRegistry {
  const m = JSON.parse(readFileSync(path.join(FONTS_DIR, 'fonts.json'), 'utf8')) as FontsManifest;
  return FontRegistry.fromManifest(m, (p) => path.join(FONTS_DIR, p));
}

export function bundledSource(): BundledFontSource {
  return new BundledFontSource({
    registry: bundledRegistry(),
    load: (p) => Promise.resolve(new Uint8Array(readFileSync(p))),
  });
}

/** A provider answering by script (or by family) with fixture fonts; records the requests. */
export class FixtureProvider implements FontDataProvider {
  readonly id: string;
  readonly requests: FontRequest[] = [];
  readonly timeoutMs?: number;
  private readonly answer: (req: FontRequest) => Promise<FontData | null>;
  constructor(
    answer: (req: FontRequest) => Promise<FontData | null> | FontData | null,
    id = 'fixture',
    timeoutMs?: number,
  ) {
    this.id = id;
    this.answer = (r) => Promise.resolve(answer(r));
    if (timeoutMs !== undefined) this.timeoutMs = timeoutMs;
  }
  resolve(req: FontRequest): Promise<FontData | null> {
    this.requests.push(req);
    return this.answer(req);
  }
}

export function fixtureFont(file: string, over: Partial<FontData> = {}): FontData {
  return { bytes: fontBytes(file), postscriptName: '', embeddable: true, variable: false, source: 'platform', ...over };
}

/** Noto script fixtures by script, as the web or native chain would return them. */
export function scriptFixtures(id = 'scripts'): FixtureProvider {
  return new FixtureProvider((r) => {
    if (r.script === 'Arabic') return fixtureFont('NotoSansArabic-subset.ttf', { source: 'noto-web' });
    if (r.script === 'Devanagari') return fixtureFont('NotoSansDevanagari-subset.ttf', { source: 'noto-web' });
    if (r.script === 'Han') return fixtureFont('NotoSansSC-subset.otf', { source: 'noto-web' });
    return null;
  }, id);
}

export function pdfEnv(
  fonts: readonly FontDataProvider[] = [bundledSource()],
  over: Partial<ExportEnv> = {},
  opts: PdfExporterOptions = {},
): ReturnType<typeof env> {
  return env({ loadPdf: () => Promise.resolve(createPdfRenderer({ fonts, ...opts })), ...over });
}

export interface TextSpec {
  readonly text: string;
  readonly cx: number;
  readonly cy: number;
  readonly w?: number;
  readonly h?: number;
  readonly size?: number;
  readonly family?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  /** 0 left, 1 centre, 2 right (C++ `TextAlignHorizontal`). */
  readonly align?: number;
  /** Signed ARGB. */
  readonly color?: number;
  readonly angle?: number;
  readonly decoration?: number;
}

/** A board with one page of text boxes (`avabodh.basic.text`). */
export function textBoard(
  pages: readonly (readonly TextSpec[])[],
  opts: { fixed?: boolean; background?: number } = {},
): object {
  const out: Record<string, object> = {};
  let id = 0;
  pages.forEach((texts, i) => {
    const objects: Record<string, object> = {};
    for (const t of texts) {
      id++;
      const style: Record<string, unknown> = { fontsize: t.size ?? 20, fontfamily: t.family ?? 'Noto Sans' };
      if (t.bold === true) style['fontweight'] = 2;
      if (t.italic === true) style['fontstyle'] = 2;
      if (t.align !== undefined) style['textalignhorizontal'] = t.align;
      if (t.color !== undefined) style['textfill'] = { color: t.color, type: 2 };
      if (t.decoration !== undefined) style['textdecoration'] = t.decoration;
      objects[`txt${String(id).padStart(4, '0')}`] = {
        type: 'templated',
        name: 'Text',
        order: id,
        params: { cx: t.cx, cy: t.cy, width: t.w ?? 300, height: t.h ?? 40, angle: t.angle ?? 0 },
        style,
        template: {
          id: 'avabodh.basic.text',
          texts: [{ location: 'default', text: t.text }],
          images: '',
          primitive_for_distance: false,
          primitive_for_intersection: false,
          primitive_for_inside: false,
          data: [],
          draw: [],
        },
      };
    }
    out[`page${String(i + 1).padStart(4, '0')}`] = {
      name: `Page ${String(i + 1)}`,
      order: i + 1,
      canvassizetype: opts.fixed === true ? 'fixed' : 'infinite',
      canvasname: opts.fixed === true ? 'Letter' : 'Infinite',
      size: opts.fixed === true ? { width: 800, height: 600, unit: 'point' } : { width: 0, height: 0, unit: 'point' },
      background: { color: opts.background ?? -1 },
      objects,
    };
  });
  return {
    attributes: { grid: { present: false }, scaling: { scale: 1, unit: 'point' } },
    info: { author: '', description: '', platform: '1', title: '', version: '4.2' },
    pages: out,
  };
}

export interface ParsedPage {
  readonly view: number[];
  readonly items: { str: string; x: number; y: number; width: number; fontName: string; transform: number[] }[];
  readonly ops: { fn: number; args: unknown }[];
}

/** pdf.js over the bytes: page boxes, text items (x, baseline y from the top, in points) and operators. */
export async function parsePdf(bytes: Uint8Array): Promise<{ pages: ParsedPage[]; raw: string }> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const pages: ParsedPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const view = [...p.view];
    const h = (view[3] ?? 0) - (view[1] ?? 0);
    const tc = await p.getTextContent();
    const items = tc.items
      // pdf.js marks line ends with empty items; they are not text.
      .filter(
        (it): it is (typeof tc.items)[number] & { str: string; transform: number[]; width: number; fontName: string } =>
          'str' in it && it.str !== '',
      )
      .map((it) => {
        const tf: number[] = [...(it.transform as number[])];
        return {
          str: it.str,
          x: tf[4] ?? 0,
          y: h - (tf[5] ?? 0),
          width: it.width,
          fontName: it.fontName,
          transform: tf,
        };
      });
    const ol = await p.getOperatorList();
    const ops = ol.fnArray.map((fn, k) => ({ fn, args: ol.argsArray[k] as unknown }));
    pages.push({ view, items, ops });
  }
  await task.destroy();
  return { pages, raw: Buffer.from(bytes).toString('latin1') };
}

export const OPS = pdfjs.OPS;

/** A session on `board` in a runtime for `host` (native hosts keep "" as the platform default). */
export function hostSession(host: 'web' | 'ios' | 'android', board: object, name: string): BoardSession {
  const s = new BoardSession(testRuntime({ host }), { images: new FakeImagePort(), scheduler: new FakeScheduler() });
  const r = s.load(board);
  if (!r.ok) throw new Error(`load: ${r.message}`);
  (s.document as { name: string }).name = name;
  return s;
}

/** Image XObjects in the file, not counting the soft masks of PNGs with alpha. */
export function imageCount(raw: string): number {
  return (raw.match(/\/Subtype \/Image/g) ?? []).length - (raw.match(/\/SMask \d+ 0 R/g) ?? []).length;
}
