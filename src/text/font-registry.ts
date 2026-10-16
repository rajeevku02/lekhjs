// The bundled font families and the font epoch (spec 06 §7.3, spec 03 §8.4).
//
// One `FontRegistry` per `Runtime` (one per JS realm). It owns `fontEpoch`: when a font becomes
// usable the registry bumps the epoch once and notifies every listener (each live session marks
// its text dirty; the text caches treat older-epoch entries as misses). In Node the epoch never
// changes after startup.
import type { FontLoader } from './ports';
import type { GenericFamily } from './font-types';

export const DEFAULT_FONT_FAMILY = 'Noto Sans';

/** One WOFF2 subset of a bundled face. */
export interface BundledWoff2 {
  readonly subset: string;
  readonly url: string;
  readonly unicodeRange: string;
}

/** One bundled face (spec 06 §7.3), with the hhea metrics the OQ-38 fallback uses. */
export interface BundledFace {
  readonly weight: 400 | 700;
  readonly style: 'normal' | 'italic';
  /** URL (or path) of the TTF, through the `urlOf` given to `fromManifest`; '' when unknown. */
  readonly ttf: string;
  readonly woff2: readonly BundledWoff2[];
  readonly ascender: number;
  readonly descender: number;
  readonly unitsPerEm: number;
}

export interface BundledFamily {
  readonly family: string;
  readonly generic: GenericFamily;
  readonly faces: readonly BundledFace[];
  readonly license: 'OFL-1.1';
}

/** The part of `lekhjs/fonts/fonts.json` the registry reads. */
export interface FontsManifest {
  readonly defaultFamily?: string;
  readonly families: readonly {
    readonly family: string;
    readonly generic: string;
    readonly license?: string;
    readonly faces: readonly {
      readonly weight: number;
      readonly style: string;
      readonly ascender: number;
      readonly descender: number;
      readonly unitsPerEm: number;
      readonly ttf: { readonly file: string };
      readonly woff2: readonly { readonly subset: string; readonly unicodeRange: string; readonly file: string }[];
    }[];
  }[];
}

/** hhea metrics of the bundled faces (from fonts.json; identical across weights and styles). */
const NOTO_METRICS = Object.freeze({ ascender: 1069, descender: -293, unitsPerEm: 1000 });
const CAVEAT_METRICS = Object.freeze({ ascender: 960, descender: -300, unitsPerEm: 1000 });

function face(
  weight: 400 | 700,
  style: 'normal' | 'italic',
  m: { ascender: number; descender: number; unitsPerEm: number },
): BundledFace {
  return Object.freeze({ weight, style, ttf: '', woff2: Object.freeze([]), ...m });
}

type HheaMetrics = Readonly<{ ascender: number; descender: number; unitsPerEm: number }>;
const FOUR = (m: HheaMetrics) =>
  Object.freeze([face(400, 'normal', m), face(700, 'normal', m), face(400, 'italic', m), face(700, 'italic', m)]);
const TWO = (m: HheaMetrics) => Object.freeze([face(400, 'normal', m), face(700, 'normal', m)]);

/**
 * The four bundled families in their fixed order, without file URLs (the registry built from
 * the manifest adds them). Noto Sans Mono and Caveat have no italic: it is synthesised.
 */
export const BUNDLED_FONTS: readonly BundledFamily[] = Object.freeze([
  Object.freeze({ family: 'Noto Sans', generic: 'sans-serif', faces: FOUR(NOTO_METRICS), license: 'OFL-1.1' } as const),
  Object.freeze({ family: 'Noto Serif', generic: 'serif', faces: FOUR(NOTO_METRICS), license: 'OFL-1.1' } as const),
  Object.freeze({
    family: 'Noto Sans Mono',
    generic: 'monospace',
    faces: TWO(NOTO_METRICS),
    license: 'OFL-1.1',
  } as const),
  Object.freeze({ family: 'Caveat', generic: 'cursive', faces: TWO(CAVEAT_METRICS), license: 'OFL-1.1' } as const),
]);

const GENERICS: readonly string[] = Object.freeze(['sans-serif', 'serif', 'monospace', 'cursive']);

export class FontRegistry {
  private readonly families_: readonly BundledFamily[];
  private epoch_ = 0;
  private readonly listeners = new Set<(epoch: number) => void>();

  constructor(families: readonly BundledFamily[] = BUNDLED_FONTS) {
    this.families_ = families;
  }

  /** The registry over `fonts.json`, with each file path mapped through `urlOf`. */
  static fromManifest(m: FontsManifest, urlOf: (path: string) => string): FontRegistry {
    const fams: BundledFamily[] = m.families.map((f) => ({
      family: f.family,
      generic: (GENERICS.includes(f.generic) ? f.generic : 'sans-serif') as GenericFamily,
      license: 'OFL-1.1',
      faces: f.faces.map((fc) => ({
        weight: fc.weight >= 600 ? 700 : 400,
        style: fc.style === 'italic' ? 'italic' : 'normal',
        ttf: urlOf(fc.ttf.file),
        woff2: fc.woff2.map((w) => ({ subset: w.subset, unicodeRange: w.unicodeRange, url: urlOf(w.file) })),
        ascender: fc.ascender,
        descender: fc.descender,
        unitsPerEm: fc.unitsPerEm,
      })),
    }));
    return new FontRegistry(fams);
  }

  /** Fixed order: Noto Sans, Noto Serif, Noto Sans Mono, Caveat. */
  families(): readonly BundledFamily[] {
    return this.families_;
  }

  /** Case-insensitive lookup of a bundled family. */
  find(family: string): BundledFamily | undefined {
    const f = family.trim().toLowerCase();
    return this.families_.find((b) => b.family.toLowerCase() === f);
  }

  /** The face used for `weight`/`italic`: the closest weight, the italic only when it exists. */
  faceFor(family: string, weight: number, italic: boolean): BundledFace | undefined {
    const fam = this.find(family);
    if (fam === undefined) return undefined;
    const w = weight >= 600 ? 700 : 400;
    const style = italic ? 'italic' : 'normal';
    return (
      fam.faces.find((f) => f.weight === w && f.style === style) ??
      fam.faces.find((f) => f.weight === w && f.style === 'normal') ??
      fam.faces[0]
    );
  }

  /** The TTF of a face, for the PDF platform (spec 08). */
  ttfFor(family: string, weight: number, italic: boolean): string | undefined {
    const f = this.faceFor(family, weight, italic);
    return f !== undefined && f.ttf !== '' ? f.ttf : undefined;
  }

  // ---- the font epoch (spec 03 §8.4) ----

  get fontEpoch(): number {
    return this.epoch_;
  }

  /** Fonts changed: the epoch goes up once and every listener hears the new value. */
  bumpEpoch(): number {
    this.epoch_++;
    for (const cb of [...this.listeners]) cb(this.epoch_);
    return this.epoch_;
  }

  /** Subscribes to epoch changes; returns the disposer. */
  onFontsChanged(cb: (epoch: number) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Bumps the epoch whenever `loader` reports newly usable fonts. Returns the disposer. */
  attachLoader(loader: FontLoader): () => void {
    return loader.onFontsChanged(() => {
      this.bumpEpoch();
    });
  }
}
