// The ports text/ owns (spec 06 §1, §5; spec 02 §5). Hosts implement them; lekhjs never touches
// a DOM canvas, `document.fonts` or a file directly.
import type { Canvas2DLike } from '../base';

/** What one line measures to. `ascent`/`descent` are the font box (`fontBoundingBox*`), or NaN when the context does not report them. */
export interface LineMetrics {
  readonly width: number;
  readonly ascent: number;
  readonly descent: number;
}

/**
 * The one measurement port (spec 06 §5.1): `measureLine(text, fontKey)`, where `fontKey` is a
 * `buildFontKey` string. Synchronous everywhere; a backend never waits for fonts.
 */
export interface TextMeasurer {
  measureLine(text: string, fontKey: string): LineMetrics;
}

/** A face the loader may fetch (a `ResolvedFont` reduced to what `document.fonts.load` needs). */
export interface FontFaceRequest {
  readonly fontKey: string;
  readonly family: string;
  readonly weight: number;
  readonly style: string;
}

/**
 * Registers bundled faces and reports when fonts become usable (spec 06 §5.3). The DOM
 * implementation (`DomFontLoader`) is host code; the backend's is a no-op that resolves at once.
 * This is one of the two places text/ mentions `Promise` (AC-ENG-25): the port declaration only.
 */
export interface FontLoader {
  ensureLoaded(fonts: readonly FontFaceRequest[], sampleText: string): Promise<void>;
  readonly epoch: number;
  onFontsChanged(cb: () => void): () => void;
}

/** A canvas a `CanvasFactory` makes: `OffscreenCanvas`, a detached `<canvas>` or `@napi-rs/canvas`. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): Canvas2DLike | null;
}

/** Creates 2-D canvases (spec 02 §5): `OffscreenCanvas` in the browser and worker, `@napi-rs/canvas` on the server. */
export interface CanvasFactory {
  createCanvas(width: number, height: number): CanvasLike;
}

/**
 * The host's "This device" font families (spec 06 §10, canonical name `PlatformFontSource`):
 * iOS/Mac from `LekhPlugin.getFontFamilies`, Android generics, the web's measured list. Its
 * async loading is host code; lekhjs only reads the result.
 */
export interface PlatformFontSource {
  families(): readonly string[];
  isAvailable(family: string): boolean;
}

/** A `PlatformFontSource` with no families (Android, backend, tests). */
export const NO_PLATFORM_FONTS: PlatformFontSource = Object.freeze({
  families: () => [],
  isAvailable: () => false,
});
