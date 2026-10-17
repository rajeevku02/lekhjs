// Stored font attributes → a CSS family list, weight, style and stretch (spec 06 §8;
// canonical class name `FontNameResolver`, spec 02 §1.2).
//
// Rules, first match wins (§8.2):
//   1 a bundled family (any case)           → that family, then its generic       'bundled'
//   2 "" or "System" (any case)             → the platform default                'platform-default'
//   3 sans / serif / monospace (Android)    → the generic keyword                 'platform'
//   4 a known Apple PostScript name         → its family/weight/italic/stretch, then rules 1, 5, 6
//   5 a family this host has                → that family, then sans-serif        'platform'
//   6 anything else                         → Noto Sans, weight/italic kept       'fallback-default' (DR-TXT-07)
//
// Host fallback families (spike b, item 4): `@napi-rs/canvas` falls back only between families
// named in the font string, so the backend passes the Noto script families its image installs as
// `fallbackFamilies`; they go after the primary family and before the generic keyword. The
// browser passes none: its own per-character system fallback does the job (§11).
import { FontStyle, FontWeight } from '../style';
import { modifierToCss } from './font-modifier';
import { DEFAULT_FONT_FAMILY, type FontRegistry } from './font-registry';
import { familyToken, isGenericFamily, quoteFamily } from './font-string';
import type { FontHost, ResolvedFont } from './font-types';
import { seedPostScriptNames, type PostScriptFace } from './legacy-font-names';
import { NO_PLATFORM_FONTS, type PlatformFontSource } from './ports';
import { TEXT_SWITCHES_OFF, type TextTestSwitches } from './test-switches';

/** The stored attributes the resolver reads (effective values). */
export interface StoredFont {
  readonly family: string;
  readonly modifier: string;
  readonly weight: FontWeight;
  readonly style: FontStyle;
}

export interface FontNameResolverOptions {
  /** Ordered families inserted after the primary family and before the generic keyword (backend: the Noto script families). Default none. */
  readonly fallbackFamilies?: readonly string[];
  /** The on-device PostScript table (H-TXT-1); default: the provisional seed. */
  readonly postScriptNames?: ReadonlyMap<string, PostScriptFace>;
  /** Test-only switches (spec 06 §3.6); default all off. */
  readonly testing?: TextTestSwitches;
}

const ANDROID_GENERICS: Readonly<Record<string, string>> = Object.freeze({
  sans: 'sans-serif',
  serif: 'serif',
  monospace: 'monospace',
});

export class FontNameResolver {
  readonly host: FontHost;
  private readonly registry: FontRegistry;
  private readonly platform: PlatformFontSource;
  private readonly fallback: readonly string[];
  private readonly postScript: ReadonlyMap<string, PostScriptFace>;
  private readonly testing: TextTestSwitches;

  constructor(
    host: FontHost,
    registry: FontRegistry,
    platform: PlatformFontSource = NO_PLATFORM_FONTS,
    opts: FontNameResolverOptions = {},
  ) {
    this.host = host;
    this.registry = registry;
    this.platform = platform;
    this.fallback = Object.freeze((opts.fallbackFamilies ?? []).filter((f) => f.trim() !== ''));
    this.postScript = opts.postScriptNames ?? seedPostScriptNames();
    this.testing = opts.testing ?? TEXT_SWITCHES_OFF;
  }

  /** The fallback families this resolver inserts (part of a font-set fingerprint). */
  fallbackFamilies(): readonly string[] {
    return this.fallback;
  }

  resolve(s: StoredFont): ResolvedFont {
    const mod = modifierToCss(s.modifier);
    // `fontweight` Bold is 700; a modifier (or PostScript) weight replaces the regular 400, and
    // when both are present the larger wins (§8.3).
    const bold = s.weight === FontWeight.Bold ? 700 : 0;
    let weight = Math.max(bold, mod.weight) || 400;
    let style: ResolvedFont['style'] =
      s.style === FontStyle.Italic ? 'italic' : s.style === FontStyle.Oblique ? 'oblique' : 'normal';
    if (style === 'normal' && mod.style !== '') style = mod.style;
    let stretch = mod.stretch === '' ? 'normal' : mod.stretch;

    const raw = s.family.trim();
    const lower = raw.toLowerCase();

    // Rule 1: bundled.
    const bundled = this.registry.find(raw);
    if (bundled !== undefined) return this.named(bundled.family, bundled.generic, weight, style, stretch, 'bundled');

    // Rule 2: the platform default.
    if (lower === '' || lower === 'system') return this.platformDefault(weight, style, stretch);

    // Rule 3: Android's generic names.
    const generic = Object.hasOwn(ANDROID_GENERICS, lower) ? ANDROID_GENERICS[lower] : undefined;
    if (generic !== undefined) {
      return this.make([...this.fallback.map(quoteFamily), generic], weight, style, stretch, 'platform', '');
    }

    // Rule 4: a legacy PostScript name, then rules 1, 5 and 6 for its family.
    let family = raw;
    const ps = this.postScript.get(raw);
    if (ps !== undefined) {
      family = ps.family;
      weight = Math.max(bold, mod.weight, ps.weight) || 400;
      if (ps.italic && style === 'normal') style = 'italic';
      if (ps.stretch !== 'normal' && stretch === 'normal') stretch = ps.stretch;
      const b = this.registry.find(family);
      if (b !== undefined) return this.named(b.family, b.generic, weight, style, stretch, 'bundled');
    }

    // Rule 5: a family this host has.
    if (this.platform.isAvailable(family)) return this.named(family, 'sans-serif', weight, style, stretch, 'platform');

    // Rule 6: the bundled default (or, under fontFallbackCompat, the C++ web's sans-serif).
    if (this.testing.fontFallbackCompat) {
      return this.make(
        [...this.fallback.map(quoteFamily), 'sans-serif'],
        weight,
        style,
        stretch,
        'fallback-default',
        '',
      );
    }
    return this.named(DEFAULT_FONT_FAMILY, 'sans-serif', weight, style, stretch, 'fallback-default');
  }

  private platformDefault(weight: number, style: ResolvedFont['style'], stretch: string): ResolvedFont {
    const fb = this.fallback.map(quoteFamily);
    switch (this.host) {
      case 'ios':
      case 'mac':
        return this.make([...fb, '-apple-system', 'system-ui'], weight, style, stretch, 'platform-default', '');
      case 'backend':
        // Under fontFallbackCompat, the C++ backend's `sans-serif` (neutralises DR-BE-01 for the
        // kashi MCP oracle parity test, spec 10 §11).
        if (this.testing.fontFallbackCompat) {
          return this.make([...fb, 'sans-serif'], weight, style, stretch, 'platform-default', '');
        }
        return this.named(DEFAULT_FONT_FAMILY, 'sans-serif', weight, style, stretch, 'platform-default');
      default:
        return this.make([...fb, 'sans-serif'], weight, style, stretch, 'platform-default', '');
    }
  }

  private named(
    family: string,
    generic: string,
    weight: number,
    style: ResolvedFont['style'],
    stretch: string,
    source: ResolvedFont['source'],
  ): ResolvedFont {
    const list = [familyToken(family)];
    for (const f of this.fallback) {
      if (f.toLowerCase() !== family.toLowerCase()) list.push(quoteFamily(f));
    }
    list.push(isGenericFamily(generic) ? generic : 'sans-serif');
    return this.make(list, weight, style, stretch, source, family);
  }

  private make(
    families: string[],
    weight: number,
    style: ResolvedFont['style'],
    stretch: string,
    source: ResolvedFont['source'],
    primary: string,
  ): ResolvedFont {
    return Object.freeze({ families: Object.freeze(families), weight, style, stretch, source, primary });
  }
}
