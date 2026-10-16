// The bundled fonts (spec 06 §7): the manifest matches the files (AC-TXT-10), the Latin
// WOFF2 budget holds (AC-TXT-12), no OFL.txt declares a Reserved Font Name (OQ-36), and
// every face loads in @napi-rs/canvas (with fontBoundingBox* equal to the hhea metrics,
// OQ-38) and embeds in PDFKit from a Uint8Array (spec 08 §7). Spike (b) recorded the
// numbers in the Work's spec/spikes/spike-b-bundled-fonts.md.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT } from '../lint/eslint-helpers';

interface FileInfo {
  file: string;
  bytes: number;
  sha256: string;
}
interface Face {
  weight: number;
  style: 'normal' | 'italic';
  ascender: number;
  descender: number;
  lineGap: number;
  unitsPerEm: number;
  ttf: FileInfo;
  woff2: (FileInfo & { subset: string; unicodeRange: string })[];
}
interface Family {
  family: string;
  dir: string;
  generic: string;
  license: string;
  licenseFile: FileInfo;
  faces: Face[];
}
interface Manifest {
  defaultFamily: string;
  subsets: Record<string, string>;
  families: Family[];
}

/** The part of PDFKit's document API this test uses (pdfkit ships no types). */
interface PdfDoc {
  on(event: 'data', cb: (chunk: Uint8Array) => void): void;
  on(event: 'end', cb: () => void): void;
  registerFont(name: string, bytes: Uint8Array): PdfDoc;
  addPage(opts: { size: [number, number]; margin: number }): PdfDoc;
  font(name: string): PdfDoc;
  fontSize(size: number): PdfDoc;
  text(text: string, x: number, y: number, opts: { lineBreak: boolean; baseline: string }): PdfDoc;
  widthOfString(text: string): number;
  end(): void;
}
type PdfCtor = new (opts: { autoFirstPage: boolean; compress: boolean }) => PdfDoc;

const FONTS = path.join(PKG_ROOT, 'fonts');
const manifest = JSON.parse(readFileSync(path.join(FONTS, 'fonts.json'), 'utf8')) as Manifest;
const faces = manifest.families.flatMap((fam) => fam.faces.map((face) => ({ fam, face })));
const label = ({ fam, face }: { fam: Family; face: Face }) => `${fam.family} ${String(face.weight)} ${face.style}`;
const SAMPLE = 'The quick brown fox jumps over the lazy dog 0123456789';

function sha256(rel: string): string {
  return createHash('sha256')
    .update(readFileSync(path.join(FONTS, rel)))
    .digest('hex');
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(p) : [path.relative(FONTS, p).split(path.sep).join('/')];
  });
}

describe('fonts.json', () => {
  it('lists exactly the four families in the fixed order, Noto Sans the default', () => {
    expect(manifest.families.map((f) => f.family)).toEqual(['Noto Sans', 'Noto Serif', 'Noto Sans Mono', 'Caveat']);
    expect(manifest.defaultFamily).toBe('Noto Sans');
    expect(manifest.families.map((f) => f.faces.length)).toEqual([4, 4, 2, 2]);
    expect(manifest.families.every((f) => f.license === 'OFL-1.1')).toBe(true);
  });

  it('names every file under fonts/ and nothing else (AC-TXT-10)', () => {
    const named = manifest.families.flatMap((fam) => [
      fam.licenseFile.file,
      ...fam.faces.flatMap((face) => [face.ttf.file, ...face.woff2.map((w) => w.file)]),
    ]);
    const extra = ['LICENSES.md', 'build-fonts.mjs', 'fonts.json'];
    expect(listFiles(FONTS).sort()).toEqual([...named, ...extra].sort());
  });

  it('records the sha256 and size of every file (AC-TXT-10)', () => {
    const infos = manifest.families.flatMap((fam) => [
      fam.licenseFile,
      ...fam.faces.flatMap((face) => [face.ttf, ...face.woff2]),
    ]);
    for (const info of infos) {
      expect(sha256(info.file), info.file).toBe(info.sha256);
      expect(readFileSync(path.join(FONTS, info.file)).length, info.file).toBe(info.bytes);
    }
  });

  it('gives each WOFF2 file the unicode-range of its subset, and the wOF2 signature', () => {
    for (const { face } of faces)
      for (const w of face.woff2) {
        expect(w.unicodeRange).toBe(manifest.subsets[w.subset]);
        expect(readFileSync(path.join(FONTS, w.file)).subarray(0, 4).toString('latin1')).toBe('wOF2');
      }
  });

  it('keeps the Latin WOFF2 subsets within 0.6 MB (AC-TXT-12)', () => {
    const latin = faces.flatMap(({ face }) => face.woff2.filter((w) => w.subset === 'latin'));
    expect(latin).toHaveLength(12);
    expect(latin.reduce((n, w) => n + w.bytes, 0)).toBeLessThanOrEqual(600_000);
  });
});

describe('licences (OQ-36)', () => {
  it.each(manifest.families.map((f) => [f.family, f.licenseFile.file]))(
    '%s OFL.txt is OFL 1.1 and declares no Reserved Font Name',
    (_family, file) => {
      const text = readFileSync(path.join(FONTS, file), 'utf8');
      const header = text.slice(0, text.indexOf('This Font Software is licensed'));
      expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(header).toMatch(/^Copyright /);
      expect(header).not.toMatch(/Reserved Font Name/i);
    },
  );

  it('LICENSES.md has a paragraph per family with its source and version', () => {
    const text = readFileSync(path.join(FONTS, 'LICENSES.md'), 'utf8');
    for (const fam of manifest.families) expect(text).toContain(`## ${fam.family}`);
  });
});

describe('@napi-rs/canvas', () => {
  for (const f of faces) GlobalFonts.registerFromPath(path.join(FONTS, f.face.ttf.file), f.fam.family);
  const ctx = createCanvas(10, 10).getContext('2d');

  it.each(faces.map((f) => [label(f), f] as const))('%s loads and measures', (_l, { fam, face }) => {
    const font = `${face.style} ${String(face.weight)} 100px "${fam.family}"`;
    ctx.font = font;
    expect(ctx.font).toBe(font);
    const m = ctx.measureText(SAMPLE);
    expect(m.width).toBeGreaterThan(1000);
    // OQ-38: fontBoundingBox* is present and equals the hhea metrics stored in fonts.json.
    expect(m.fontBoundingBoxAscent).toBeCloseTo((face.ascender / face.unitsPerEm) * 100, 2);
    expect(m.fontBoundingBoxDescent).toBeCloseTo((-face.descender / face.unitsPerEm) * 100, 2);
  });

  it('selects the bold face, not the regular one', () => {
    ctx.font = 'normal 400 50px "Noto Sans"';
    const regular = ctx.measureText(SAMPLE).width;
    ctx.font = 'normal 700 50px "Noto Sans"';
    expect(ctx.measureText(SAMPLE).width).toBeGreaterThan(regular);
  });
});

describe('PDFKit', () => {
  const require = createRequire(import.meta.url);
  const PDFDocument = require('pdfkit') as PdfCtor;

  it.each(faces.map((f) => [label(f), f] as const))('%s embeds from a Uint8Array', async (_l, { face }) => {
    const bytes = new Uint8Array(readFileSync(path.join(FONTS, face.ttf.file)));
    const doc = new PDFDocument({ autoFirstPage: false, compress: true });
    const chunks: Uint8Array[] = [];
    doc.on('data', (c) => chunks.push(c));
    const ended = new Promise<void>((resolve) => {
      doc.on('end', resolve);
    });
    doc
      .registerFont('face', bytes)
      .addPage({ size: [400, 100], margin: 0 })
      .font('face')
      .fontSize(20);
    doc.text(SAMPLE, 10, 50, { lineBreak: false, baseline: 'alphabetic' });
    expect(doc.widthOfString(SAMPLE)).toBeGreaterThan(200);
    doc.end();
    await ended;
    const pdf = Buffer.concat(chunks).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toContain('/FontFile2');
    expect(pdf).toContain('/Identity-H');
  });
});
