// The canvas/CSS font string and the measurement key (spec 06 §8.4, §5.2).
//
// Family names are always quoted; the six generic keywords never are. This fixes the web and
// backend bug where an unquoted `Bodoni 72` made `ctx.font` invalid and the text took the
// previous object's font (DR-TXT-08).
import type { ResolvedFont } from './font-types';

/** The generic keywords a font string may end with; never quoted. */
export const GENERIC_FAMILIES: readonly string[] = Object.freeze([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'system-ui',
  '-apple-system',
]);

export function isGenericFamily(name: string): boolean {
  return GENERIC_FAMILIES.includes(name);
}

/** `"name"` with `\` and `"` escaped (CSS string syntax). */
export function quoteFamily(name: string): string {
  return '"' + name.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** A family list entry: generic keywords as they are, names quoted. */
export function familyToken(name: string): string {
  return isGenericFamily(name) ? name : quoteFamily(name);
}

/** Pixel sizes are written with at most 4 decimals, so equal sizes give equal strings. */
function pxStr(px: number): string {
  return String(Math.round(px * 10000) / 10000);
}

/** `${style} ${weight} ${px}px ${families}` — e.g. `italic 700 15px "Noto Sans", sans-serif`. */
export function buildCanvasFont(r: ResolvedFont, px: number): string {
  return `${r.style} ${String(r.weight)} ${pxStr(px)}px ${r.families.join(', ')}`;
}

/**
 * The measurement key of a resolved font at a size: the font string plus `|stretch` when the
 * stretch is not normal. Stretch goes through `ctx.fontStretch`, not the shorthand, so this
 * keeps condensed and normal widths apart in every cache (spec 06 §5.2).
 */
export function buildFontKey(r: ResolvedFont, px: number): string {
  const css = buildCanvasFont(r, px);
  return r.stretch === 'normal' || r.stretch === '' ? css : `${css}|${r.stretch}`;
}

const STRETCH_KEYWORDS: readonly string[] = Object.freeze([
  'ultra-condensed',
  'extra-condensed',
  'condensed',
  'semi-condensed',
  'semi-expanded',
  'expanded',
  'extra-expanded',
  'ultra-expanded',
]);

/** Splits a font key into the CSS font string and the stretch keyword (`'normal'` when absent). */
export function splitFontKey(fontKey: string): { font: string; stretch: string } {
  const bar = fontKey.lastIndexOf('|');
  if (bar > 0) {
    const stretch = fontKey.slice(bar + 1);
    if (STRETCH_KEYWORDS.includes(stretch)) return { font: fontKey.slice(0, bar), stretch };
  }
  return { font: fontKey, stretch: 'normal' };
}

/** The font string with its family list replaced (used when a context rejects a font, §8.4). */
export function replaceFamilies(font: string, families: readonly string[]): string {
  const m = /^(\S+ \S+ [^ ]+px) /.exec(font);
  return m?.[1] !== undefined ? `${m[1]} ${families.join(', ')}` : font;
}

/** The pixel size inside a font string built by `buildCanvasFont` (NaN when there is none). */
export function fontPx(font: string): number {
  const m = /(?:^|\s)([0-9.eE+-]+)px(?:\s|$)/.exec(font);
  return m?.[1] !== undefined ? Number(m[1]) : NaN;
}
