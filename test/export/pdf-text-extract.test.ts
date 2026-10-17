// AC-EXP-10 (text half) and AC-EXP-18 (extraction half), Work 01M4X7TCHFB862XGT68GPY071C, F2:
// pdfjs-dist `getTextContent` over the PDF of boards laid out with the bundled fonts on a real
// canvas. Every line's string equals the engine's laid-out line, in order; the baseline y is within
// 0.5 pt of the engine's (board units / 2, the page's 0.5 scale). Line start x: where the PDF draws
// the line in the font the canvas measured (a bundled family), the start x is within 0.5 pt of the
// engine's. Where it cannot (the web's "" / platform families: the canvas uses the browser's
// sans-serif, the PDF the bundled Noto Sans, spec 08 §6.1 source 4), spec 08 §7.1 places the line
// with PDF-measured widths at the engine's alignment anchor, so the anchor (left edge, centre or
// right edge) is checked within 0.5 pt instead.
// For mixed Arabic/Latin lines the runs come out in the visual order of UAX #9 (written out by hand
// here, not taken from BidiResolver), adjacent, each as wide as the canvas draws it (napi
// `measureText` in the run's font), from the engine's line start to its end within 0.5 pt. The
// canvas here has the PDF's Arabic font in its font list (the backend's fallback families); on the
// web screen the browser's own Arabic font may be wider or narrower, and the PDF keeps its widths.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { CORE_FIXTURES, readText } from '../io/helpers';
import { TEST_FONTS, bundledSource, parsePdf, scriptFixtures, type ParsedPage } from './pdf-helpers';
import { exportPdfFile, measuredSession, textBoxes, type TextBox } from './pdf-parity-helpers';

const TOL = 0.5;

/** The fixture script fonts, registered so the canvas measures (and draws) Arabic like the PDF. */
GlobalFonts.registerFromPath(path.join(TEST_FONTS, 'NotoSansArabic-subset.ttf'), 'Noto Sans Arabic');
GlobalFonts.registerFromPath(path.join(TEST_FONTS, 'NotoSansDevanagari-subset.ttf'), 'Noto Sans Devanagari');

interface EngineLine {
  readonly text: string;
  readonly align: 'left' | 'center' | 'right';
  /** The alignment anchor (left edge, centre or right edge), PDF points. */
  readonly anchor: number;
  /** The canvas measured the line in a bundled family, the font the PDF embeds. */
  readonly bundled: boolean;
  /** PDF points from the page's top-left. */
  readonly x: number;
  readonly baseline: number;
  readonly rotated: boolean;
}

/** The engine's lines of a page (start x by alignment), in PDF points. */
function engineLines(boxes: readonly TextBox[]): EngineLine[] {
  return boxes.flatMap((b) =>
    b.text.lines.map((l) => {
      const x0 = b.text.align === 'left' ? l.x : b.text.align === 'right' ? l.x - l.width : l.x - l.width / 2;
      return {
        text: l.text,
        align: b.text.align,
        anchor: (l.x + b.ox) / 2,
        bundled: /^\S+ \S+ \S+px "(Noto Sans|Noto Serif|Noto Sans Mono|Caveat)"/.test(b.text.font),
        x: (x0 + b.ox) / 2,
        baseline: (l.baselineY + b.oy) / 2,
        rotated: b.text.angle !== 0,
      };
    }),
  );
}

/**
 * pdf.js text items grouped into lines: same baseline (0.1 pt) and no gap wider than 3 pt to the
 * item before (two boxes side by side on one baseline are two lines). Whitespace-only items are
 * left out.
 */
function pdfLines(p: ParsedPage): { str: string; x: number; y: number; end: number; items: ParsedPage['items'] }[] {
  const out: { str: string; x: number; y: number; end: number; items: ParsedPage['items'] }[] = [];
  const sorted = [...p.items].sort((a, b) => (Math.abs(a.y - b.y) < 0.1 ? a.x - b.x : a.y - b.y));
  for (const it of sorted) {
    // pdf.js adds whitespace items of its own between words; they carry no position of ours.
    if (it.str.trim() === '') continue;
    const last = out.find((l) => Math.abs(l.y - it.y) < 0.1 && it.x >= l.end - 0.5 && it.x <= l.end + 3);
    if (last !== undefined && it.transform[1] === 0) {
      last.items.push(it);
      last.str += it.str;
      last.end = it.x + it.width;
    } else {
      out.push({ str: it.str, x: it.x, y: it.y, end: it.x + it.width, items: [it] });
    }
  }
  return out;
}

const squash = (s: string): string => s.replace(/\s+/g, '');

/** Start x for a bundled-font line; otherwise the alignment anchor with the PDF's own width. */
function checkStart(l: EngineLine, g: { x: number; end: number }): void {
  if (l.bundled) {
    expect(Math.abs(g.x - l.x), `start x of "${l.text}"`).toBeLessThanOrEqual(TOL);
    return;
  }
  const at = l.align === 'left' ? g.x : l.align === 'right' ? g.end : (g.x + g.end) / 2;
  expect(Math.abs(at - l.anchor), `${l.align} anchor of "${l.text}"`).toBeLessThanOrEqual(TOL);
}

const BOARDS = readdirSync(path.join(CORE_FIXTURES, 'boards')).filter((f) => f.endsWith('.lekh'));

function fixture(file: string): object {
  return JSON.parse(readText(path.join(CORE_FIXTURES, 'boards', file))) as object;
}

/** A board of text boxes laid out by the engine (Noto Sans, the bundled default). */
function linesBoard(
  specs: {
    text: string;
    cx: number;
    cy: number;
    w?: number;
    /** C++ `TextAlignHorizontal`: 1 centre, 2 left, 3 right. */ align?: number;
    size?: number;
  }[],
): object {
  const objects: Record<string, object> = {};
  specs.forEach((t, i) => {
    objects[`t${String(i + 1).padStart(4, '0')}`] = {
      type: 'templated',
      name: 'Text',
      order: i + 1,
      params: { cx: t.cx, cy: t.cy, width: t.w ?? 300, height: 40, angle: 0 },
      style: {
        fontsize: t.size ?? 20,
        fontfamily: 'Noto Sans',
        ...(t.align !== undefined ? { textalignhorizontal: t.align } : {}),
      },
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
  });
  return {
    attributes: { grid: { present: false }, scaling: { scale: 1, unit: 'point' } },
    info: { author: '', description: '', platform: '1', title: '', version: '4.2' },
    pages: {
      p0001: {
        name: 'Page 1',
        order: 1,
        canvassizetype: 'infinite',
        canvasname: 'Infinite',
        size: { width: 0, height: 0, unit: 'point' },
        background: { color: -1 },
        objects,
      },
    },
  };
}

describe('PDF text extraction against the engine layout (AC-EXP-10)', () => {
  it.each(BOARDS)('%s: every line, in order, at the engine start x and baseline (0.5 pt)', async (file) => {
    const s = measuredSession(fixture(file), 'Board');
    const { bytes } = await exportPdfFile(s);
    const { pages } = await parsePdf(bytes);
    const plans = textBoxes(s);
    expect(pages.length).toBe(plans.length);
    for (const [i, p] of pages.entries()) {
      const want = engineLines(plans[i]?.boxes ?? []).filter((l) => l.text.trim() !== '');
      const got = pdfLines(p);
      // In order: the page's text is the engine's lines, one after another.
      expect(squash(p.items.map((it) => it.str).join(''))).toBe(squash(want.map((l) => l.text).join('')));
      // Line by line (upright lines; a rotated line's items carry its own matrix).
      for (const l of want.filter((x) => !x.rotated)) {
        // The nearest PDF line with this string on this baseline (one board can repeat a label).
        const at = (x: { x: number; end: number }): number =>
          l.align === 'left' ? x.x : l.align === 'right' ? x.end : (x.x + x.end) / 2;
        const g = got
          .filter((x) => squash(x.str) === squash(l.text) && Math.abs(x.y - l.baseline) <= TOL)
          .sort((m, n) => Math.abs(at(m) - l.anchor) - Math.abs(at(n) - l.anchor))[0];
        expect(g, `line "${l.text}" at baseline ${l.baseline.toFixed(2)}`).toBeDefined();
        if (g === undefined) continue;
        checkStart(l, g);
      }
    }
  });

  it('left, centred, right and multi-line text: start x and baseline within 0.5 pt', async () => {
    const s = measuredSession(
      linesBoard([
        { text: 'Left aligned', cx: 200, cy: 60, align: 2 },
        { text: 'Centred text', cx: 200, cy: 140, align: 1 },
        { text: 'Right aligned', cx: 200, cy: 220, align: 3 },
        { text: 'two\nlines of text', cx: 200, cy: 320 },
        { text: 'A wrapped paragraph that does not fit on one line of this box', cx: 200, cy: 420, w: 220, size: 16 },
      ]),
      'Lines',
    );
    const { bytes } = await exportPdfFile(s);
    const { pages } = await parsePdf(bytes);
    const want = engineLines(textBoxes(s)[0]?.boxes ?? []);
    const got = pdfLines(pages[0] as ParsedPage);
    // Five boxes: one line each for the first three, two, and a wrapped paragraph of at least two.
    expect(want.length).toBeGreaterThanOrEqual(6);
    expect(want.every((l) => l.bundled)).toBe(true);
    expect(got.map((g) => g.str.trimEnd())).toEqual(want.map((l) => l.text.trimEnd()));
    for (const [k, l] of want.entries()) {
      const g = got[k];
      if (g === undefined) throw new Error('line');
      checkStart(l, g);
      expect(Math.abs(g.y - l.baseline)).toBeLessThanOrEqual(TOL);
    }
  });
});

describe('mixed Arabic/Latin lines in canvas order (AC-EXP-18)', () => {
  // UAX #9 visual order, left to right, by hand: base RTL when the first strong character is
  // Arabic (spec 06 §3.5, DR-TXT-09), base LTR otherwise.
  const CASES: { text: string; visual: string[] }[] = [
    { text: 'abc مرحبا def', visual: ['abc', 'مرحبا', 'def'] },
    { text: 'مرحبا abc', visual: ['abc', 'مرحبا'] },
    { text: 'مرحبا 123', visual: ['123', 'مرحبا'] },
    { text: 'Hello مرحبا world', visual: ['Hello', 'مرحبا', 'world'] },
    { text: 'مرحبا one two', visual: ['one two', 'مرحبا'] },
  ];

  it('runs come out in visual order, each at its canvas position, from the line start to its end (0.5 pt)', async () => {
    const s = measuredSession(
      linesBoard(CASES.map((c, i) => ({ text: c.text, cx: 300, cy: 40 + i * 60, w: 500 }))),
      'Bidi',
      { fallbackFamilies: ['Noto Sans Arabic'] },
    );
    const { bytes } = await exportPdfFile(s, [bundledSource(), scriptFixtures()]);
    const { pages } = await parsePdf(bytes);
    const boxes = textBoxes(s)[0]?.boxes ?? [];
    // One line per box here: every item on a baseline belongs to it, left to right.
    const byY = new Map<number, ParsedPage['items']>();
    for (const it of (pages[0] as ParsedPage).items) {
      const k = Math.round(it.y * 10);
      byY.set(k, [...(byY.get(k) ?? []), it]);
    }
    const lines = [...byY.values()].map((items) => {
      const sorted = [...items].sort((a, b) => a.x - b.x);
      return { y: sorted[0]?.y ?? NaN, items: sorted };
    });
    expect(lines.length).toBe(CASES.length);
    const ctx = createCanvas(10, 10).getContext('2d');
    for (const [i, c] of CASES.entries()) {
      const line = lines.find(
        (l) => Math.abs(l.y - (boxes[i]?.text.lines[0]?.baselineY ?? NaN) / 2 - (boxes[i]?.oy ?? 0) / 2) < TOL,
      );
      const box = boxes[i];
      const l = box?.text.lines[0];
      if (line === undefined || box === undefined || l === undefined) throw new Error(`line ${String(i)}`);
      // pdf.js marks the Arabic shaping's joiners with control characters; they are not text.
      const items = line.items.map((it) => ({ ...it, str: it.str.replace(/\p{Cc}/gu, '') }));
      expect(
        items.map((it) => it.str.trim()).filter((t) => t !== ''),
        c.text,
      ).toEqual(c.visual);
      // Each run where the canvas puts it: the line start plus the canvas advances (napi
      // `measureText` in the run's font) of everything to its left, spaces included.
      const px = box.text.px;
      const fontOf = (str: string): string =>
        /\p{Script=Arabic}/u.test(str) ? `${String(px)}px "Noto Sans Arabic"` : `${String(px)}px "Noto Sans"`;
      const start = (l.x - l.width / 2 + box.ox) / 2;
      let at = start;
      for (const it of items) {
        if (it.str.trim() !== '')
          expect(Math.abs(it.x - at), `x of "${it.str}" in "${c.text}"`).toBeLessThanOrEqual(TOL);
        ctx.font = fontOf(it.str);
        at += ctx.measureText(it.str).width / 2;
      }
      // From the engine's line start to its end (the canvas measured the same fonts).
      expect(Math.abs(at - (start + l.width / 2)), `canvas end of "${c.text}"`).toBeLessThanOrEqual(TOL);
      // (The end is checked through the canvas advances: pdf.js reports a shaped Arabic item's width
      // with the joining-control character it inserts, not the advance the PDF placed.)
    }
  });
});
