// Shared helpers for the text suites: a napi canvas with the bundled fonts registered (the
// backend's measuring setup), the parsed fonts.json, and a monospace-like recorded measurer.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import type { Canvas2DLike } from '../../src/base';
import { RecordedWidthMeasurer } from '../../src/testing';
import { CanvasTextMeasurer, type CanvasFactory, type FontsManifest, type TextPaintContext } from '../../src/text';
import { PKG_ROOT } from '../lint/eslint-helpers';

export const FONTS_DIR = path.join(PKG_ROOT, 'fonts');
export const MANIFEST = JSON.parse(readFileSync(path.join(FONTS_DIR, 'fonts.json'), 'utf8')) as FontsManifest;

let registered = false;
/** Registers the 12 bundled TTFs with @napi-rs/canvas once per worker (what kashi does at boot). */
export function registerBundledFonts(): void {
  if (registered) return;
  for (const fam of MANIFEST.families) {
    for (const face of fam.faces) GlobalFonts.registerFromPath(path.join(FONTS_DIR, face.ttf.file), fam.family);
  }
  registered = true;
}

export const napiFactory: CanvasFactory = {
  createCanvas: (w, h) => createCanvas(w, h),
};

export function napiContext(): Canvas2DLike {
  return createCanvas(1, 1).getContext('2d');
}

export function napiMeasurer(): CanvasTextMeasurer {
  registerBundledFonts();
  return CanvasTextMeasurer.fromFactory(napiFactory);
}

/** Every grapheme is `advance` wide (default 10). */
export function fixedMeasurer(advance = 10, overrides: Record<string, number> = {}): RecordedWidthMeasurer {
  return new RecordedWidthMeasurer(new Map(Object.entries(overrides)), advance);
}

/** A seeded xorshift PRNG in [0, 1). */
export function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** A context that records what the painter sets and draws. */
export function recordingContext() {
  const log: string[] = [];
  const fills: { text: string; x: number; y: number; direction: string; align: string; baseline: string }[] = [];
  const ctx = {
    font: '10px sans-serif',
    fillStyle: '#000' as unknown,
    strokeStyle: '#000' as unknown,
    lineWidth: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    direction: 'inherit',
    fontStretch: 'normal',
    save: () => log.push('save'),
    restore: () => log.push('restore'),
    translate: (x: number, y: number) => log.push(`translate ${String(x)} ${String(y)}`),
    rotate: (a: number) => log.push(`rotate ${String(a)}`),
    beginPath: () => log.push('beginPath'),
    moveTo: (x: number, y: number) => log.push(`moveTo ${x.toFixed(3)} ${y.toFixed(3)}`),
    lineTo: (x: number, y: number) => log.push(`lineTo ${x.toFixed(3)} ${y.toFixed(3)}`),
    stroke: () => log.push('stroke'),
    fillText(text: string, x: number, y: number) {
      fills.push({ text, x, y, direction: this.direction, align: this.textAlign, baseline: this.textBaseline });
    },
  };
  return { ctx: ctx as TextPaintContext & typeof ctx, log, fills };
}
