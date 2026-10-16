// Value types shared by the font registry, resolver and font-string builders.

/** Where the text is drawn (spec 06 §8.1). */
export type FontHost = 'web' | 'ios' | 'mac' | 'android' | 'backend';

/** A generic CSS family a bundled family falls back to. */
export type GenericFamily = 'sans-serif' | 'serif' | 'monospace' | 'cursive';

/** The result of `FontNameResolver.resolve` (spec 06 §8.1). */
export interface ResolvedFont {
  /** Font-list tokens: quoted names (primary, then any host fallbacks), then generic keywords. */
  readonly families: readonly string[];
  readonly weight: number;
  readonly style: 'normal' | 'italic' | 'oblique';
  /** `normal`, `condensed`, `expanded`, … (applied through `ctx.fontStretch`). */
  readonly stretch: string;
  readonly source: 'bundled' | 'platform-default' | 'platform' | 'fallback-default';
  /** Unquoted family used for metrics and the PDF lookup; '' for a platform default or generic. */
  readonly primary: string;
}
