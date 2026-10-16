// `Runtime`: one per JS realm — one per page in the browser, one per kashi pool worker (spec 01
// §4.2, spec 03 §12.4). Shared by every session on it and holding no per-board state: the
// immutable base catalog, the bundled font registry (owner of `fontEpoch`), the value-keyed
// line-width cache, the text layout over the host's measurer, the configuration and the
// clock / id / log ports. Replaces the C++ singletons `LekhGlobal`, `Platform::currentPlatform`,
// `TemplateStore::instance` and `Config::instance` (spec 01 C12).
import { EngineConfig, type Clock, type Config, type ConfigOverrides, type IdSource, type Logger } from '../base';
import type { GeneratorHooks } from '../io';
import type { TemplateCatalog } from '../template';
import {
  FontNameResolver,
  FontRegistry,
  LineWidthCache,
  NO_PLATFORM_FONTS,
  TEXT_SWITCHES_OFF,
  TextLayout,
  TextPainter,
  type FontHost,
  type FontLoader,
  type PlatformFontSource,
  type TextMeasurer,
  type TextTestSwitches,
} from '../text';

export interface RuntimeOptions {
  /** Canvas `measureText` (browser) or the napi canvas (node). */
  readonly measurer: TextMeasurer;
  /** `FontFace` (browser), `GlobalFonts` (node). Its changes bump the registry's epoch. */
  readonly fonts: FontLoader;
  /** Immutable base: front end = stencils v5 + core + builtin; kashi = per worker (spec 10 §5). */
  readonly catalog: TemplateCatalog;
  /**
   * The generator hooks (Lua → JS conversion and generator construction). Spec 01 names a
   * `GeneratorRegistry` here; until `generators/` exists the io hooks are what a session needs.
   */
  readonly generators?: GeneratorHooks;
  readonly clock?: Clock;
  readonly ids?: IdSource;
  readonly logger?: Logger;
  readonly config?: ConfigOverrides;
  /** Where text is drawn (spec 06 §8.1). Default `'web'`. */
  readonly host?: FontHost;
  /** The device's own font families (the iOS "This device" group). Default: none. */
  readonly platformFonts?: PlatformFontSource;
  /** The host's font fallback list (spec 06 §8.1). */
  readonly fallbackFamilies?: readonly string[];
  /** The bundled families; default the shipped set. */
  readonly fontRegistry?: FontRegistry;
  /** Test-only text switches (`setTestConfig`, `lekhjs/testing`); production leaves them off. */
  readonly testing?: TextTestSwitches;
}

export interface Runtime {
  readonly catalog: TemplateCatalog;
  /** Owns `fontEpoch`; its `fontsChanged` is delivered to every live session on this runtime. */
  readonly fonts: FontRegistry;
  readonly lineWidths: LineWidthCache;
  readonly generators: GeneratorHooks;
  readonly measurer: TextMeasurer;
  readonly config: Config;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly logger: Logger;
  /** Layout over `measurer` and `lineWidths` (value-keyed: shared by every session). */
  readonly textLayout: TextLayout;
  readonly fontResolver: FontNameResolver;
  readonly textPainter: TextPainter;
}

/** A logger that drops everything (the default: hosts pass their own). */
export const SILENT_LOGGER: Logger = Object.freeze({
  debug(): void {},
  info(): void {},
  warn(): void {},
  error(): void {},
});

/** `Date.now()`: the default clock when the host passes none. */
export const SYSTEM_CLOCK: Clock = Object.freeze({ now: () => Date.now() });

const HEX = '0123456789abcdef';

/**
 * A uuid-v4 from `Math.random` (the default when the host passes no `IdSource`; hosts pass
 * `crypto.randomUUID`, which lekhjs may not reach: no ambient globals).
 */
export const RANDOM_IDS: IdSource = Object.freeze({
  next(): string {
    let s = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
      else if (i === 14) s += '4';
      else if (i === 19) s += HEX.charAt(8 + Math.floor(Math.random() * 4));
      else s += HEX.charAt(Math.floor(Math.random() * 16));
    }
    return s;
  },
});

export function createRuntime(opts: RuntimeOptions): Runtime {
  const config = new EngineConfig(opts.config ?? {});
  const fonts = opts.fontRegistry ?? new FontRegistry();
  fonts.attachLoader(opts.fonts);
  const testing = opts.testing ?? TEXT_SWITCHES_OFF;
  const lineWidths = new LineWidthCache();
  const fontResolver = new FontNameResolver(opts.host ?? 'web', fonts, opts.platformFonts ?? NO_PLATFORM_FONTS, {
    ...(opts.fallbackFamilies !== undefined ? { fallbackFamilies: opts.fallbackFamilies } : {}),
    testing,
  });
  const textLayout = new TextLayout({ measurer: opts.measurer, cache: lineWidths, fonts, testing });
  return Object.freeze({
    catalog: opts.catalog,
    fonts,
    lineWidths,
    generators: opts.generators ?? {},
    measurer: opts.measurer,
    config,
    clock: opts.clock ?? SYSTEM_CLOCK,
    ids: opts.ids ?? RANDOM_IDS,
    logger: opts.logger ?? SILENT_LOGGER,
    textLayout,
    fontResolver,
    textPainter: new TextPainter(),
  });
}
