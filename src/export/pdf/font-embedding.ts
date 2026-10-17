// `fontEmbedding` (spec 08 §6.4): opens a `FontData` with fontkit (one face of a TTC selected by
// PostScript name, or by `collectionIndex` when the name is ''), and decides how its runs are
// written: **embedded** as a subset (`/FontFile2` for TrueType, `/FontFile3` for CFF) when OS/2
// `fsType` allows it, or **outlines** (filled glyph paths, no text object) when the font is
// restricted (bit 1), forbids subsetting (bit 8), is bitmap-only (bit 9), or is variable (the
// requested instance is outlined; PDFKit would embed the default instance only).
import type { FontData } from '../types';
import type { FontkitCollection, FontkitFont, FontkitFsType, FontkitModule } from './ports';

export const FS_TYPE_RESTRICTED = 0x0002;
export const FS_TYPE_PREVIEW_PRINT = 0x0004;
export const FS_TYPE_EDITABLE = 0x0008;
export const FS_TYPE_NO_SUBSETTING = 0x0100;
export const FS_TYPE_BITMAP_ONLY = 0x0200;

export type FontMode = 'embed' | 'outline';

/** A font opened for this export. */
export interface OpenedFont {
  /** The PDF registration name (`F<n>`), unique per export. */
  readonly key: string;
  /** The face to draw with (the requested instance for a variable font). */
  readonly font: FontkitFont;
  readonly mode: FontMode;
  readonly postscriptName: string;
  /** The face itself is italic (otherwise italic is synthesised with a 12° skew). */
  readonly italic: boolean;
  readonly source: FontData['source'];
}

/** The raw `fsType` value from fontkit's bitfield (or a number). */
export function fsTypeValue(fs: FontkitFsType | number | undefined): number {
  if (fs === undefined) return 0;
  if (typeof fs === 'number') return fs;
  return (
    (fs.noEmbedding === true ? FS_TYPE_RESTRICTED : 0) |
    (fs.viewOnly === true ? FS_TYPE_PREVIEW_PRINT : 0) |
    (fs.editable === true ? FS_TYPE_EDITABLE : 0) |
    (fs.noSubsetting === true ? FS_TYPE_NO_SUBSETTING : 0) |
    (fs.bitmapOnly === true ? FS_TYPE_BITMAP_ONLY : 0)
  );
}

/** The §6.4 table: 0, 4 and 8 embed; bit 1, 8 or 9 set → outlines. */
export function fsTypeAllowsEmbedding(fsType: number): boolean {
  return (fsType & (FS_TYPE_RESTRICTED | FS_TYPE_NO_SUBSETTING | FS_TYPE_BITMAP_ONLY)) === 0;
}

export function isVariableFont(font: FontkitFont): boolean {
  const t = font.directory?.tables;
  return t !== undefined && 'fvar' in t;
}

function isCollection(v: FontkitFont | FontkitCollection): v is FontkitCollection {
  return Array.isArray((v as { fonts?: unknown }).fonts);
}

/**
 * The face of `data`: a TTC selects by `postscriptName` (the name wins over `collectionIndex`;
 * a disagreement is logged as `font_ttc_mismatch`), or by `collectionIndex` when the name is ''.
 */
export function openFace(fontkit: FontkitModule, data: FontData, log?: (code: string) => void): FontkitFont | null {
  let opened: FontkitFont | FontkitCollection | null;
  try {
    opened = fontkit.create(data.bytes);
  } catch {
    return null;
  }
  if (opened === null) return null;
  if (!isCollection(opened)) return opened;
  const fonts = opened.fonts;
  const byIndex = data.collectionIndex !== undefined ? fonts[data.collectionIndex] : undefined;
  if (data.postscriptName !== '') {
    const byName = fonts.find((f) => f.postscriptName === data.postscriptName);
    if (byName !== undefined) {
      if (byIndex !== undefined && byIndex.postscriptName !== data.postscriptName) log?.('font_ttc_mismatch');
      return byName;
    }
  }
  return byIndex ?? fonts[0] ?? null;
}

/** Whether a face is italic (fsSelection bit 0, or a non-zero italic angle). */
export function faceIsItalic(font: FontkitFont): boolean {
  return font['OS/2']?.fsSelection?.italic === true || (font.italicAngle ?? 0) !== 0;
}

/**
 * Opens `data` for drawing: the face, the mode, and for a variable font the instance at the
 * requested weight (`wght` 700 for bold, else 400, clamped to the axis).
 */
export function openFont(
  fontkit: FontkitModule,
  data: FontData,
  key: string,
  bold: boolean,
  log?: (code: string) => void,
): OpenedFont | null {
  const face = openFace(fontkit, data, log);
  if (face === null) return null;
  const variable = data.variable || isVariableFont(face);
  let font = face;
  if (variable && face.getVariation !== undefined) {
    const axis = face.variationAxes?.['wght'];
    const want = bold ? 700 : 400;
    const wght = axis !== undefined ? Math.min(axis.max, Math.max(axis.min, want)) : want;
    try {
      font = face.getVariation(axis !== undefined ? { wght } : {});
    } catch {
      font = face;
    }
  }
  const embeddable = data.embeddable && fsTypeAllowsEmbedding(fsTypeValue(face['OS/2']?.fsType));
  return Object.freeze({
    key,
    font,
    mode: embeddable && !variable ? 'embed' : 'outline',
    postscriptName: face.postscriptName ?? data.postscriptName,
    italic: faceIsItalic(face),
    source: data.source,
  });
}
