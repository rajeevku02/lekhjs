// `createNodeRuntime` (spec 01 §4.3, spec 10 §3): the `Runtime` of one kashi pool worker, in place
// of the C++ binding's `Module.setPlatform(new PlatformImpl(platform))`. It measures text with the canvas
// factory kashi passes (`@napi-rs/canvas`; lekhjs never imports it), registers the bundled TTFs
// through that factory once, resolves `""` and unknown families to Noto Sans (host `backend`, spec
// 06 §8.2), and shares one immutable base catalog with every session of the worker. Fonts in Node
// never load later, so the font epoch never moves.
import type { Clock, ConfigOverrides, IdSource, Logger } from '../base';
import type { GeneratorRegistry } from '../generators';
import { SILENT_LOGGER, createRuntime, type Runtime } from '../session';
import type { TemplateCatalog } from '../template';
import { BUNDLED_FONTS, CanvasTextMeasurer, type CanvasFactory, type FontLoader, type TextTestSwitches } from '../text';

/** The canvas factory kashi passes: @napi-rs/canvas's `createCanvas`, and `GlobalFonts.register`. */
export interface NodeCanvasFactory extends CanvasFactory {
  /**
   * Registers one font file under `family` (@napi-rs/canvas `GlobalFonts.register(buffer, family)`).
   * Optional: without it the bundled files are not registered by lekhjs (the host did it).
   */
  registerFont?(data: Uint8Array, family: string): unknown;
}

export interface NodeRuntimeOptions {
  /** `(w, h) => canvas` (and `registerFont`); the one `TextMeasurer` is built over it. */
  readonly canvas: NodeCanvasFactory;
  /**
   * The bundled TTFs by file name (`NotoSans-Regular.ttf`, or a path ending in it, as in
   * `fonts/fonts.json`), registered once through `canvas.registerFont` under their family.
   */
  readonly fontFiles?: ReadonlyMap<string, Uint8Array>;
  /** The immutable base catalog, built once per runtime (kashi: once per pool worker). */
  readonly catalog: TemplateCatalog;
  readonly clock?: Clock;
  readonly ids?: IdSource;
  readonly logger?: Logger;
  readonly config?: ConfigOverrides;
  /** Default: the built-in registry (spec 04). */
  readonly generators?: GeneratorRegistry;
  /** Test-only text switches (`setTestConfig` from `lekhjs/testing`); production leaves them off. */
  readonly testing?: TextTestSwitches;
  /**
   * The script families the host has installed (kashi: the Noto CJK, Arabic, Hebrew, … faces of the
   * image), named after the primary family in every font string: @napi-rs/canvas falls back only
   * between families the string names, so without them a CJK run draws as `.notdef` (spec 06 §8.1,
   * §11; spec 10 §7). Default none.
   */
  readonly fallbackFamilies?: readonly string[];
}

/** The backend's `FontLoader`: every font is already usable, so nothing is ever waited for. */
class NodeFontLoader implements FontLoader {
  readonly epoch = 0;

  ensureLoaded(): Promise<void> {
    return Promise.resolve();
  }

  onFontsChanged(): () => void {
    return () => undefined;
  }
}

/** The bundled family a TTF file name belongs to (`NotoSansMono-Bold.ttf` → `Noto Sans Mono`), or null. */
export function bundledFamilyOfFile(file: string): string | null {
  const base = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1);
  const stem = base.slice(0, base.includes('-') ? base.indexOf('-') : base.lastIndexOf('.'));
  for (const f of BUNDLED_FONTS) if (f.family.replace(/ /g, '') === stem) return f.family;
  return null;
}

/** One `Runtime` per pool worker; sessions on it get their images per operation (`SessionOptions.images`). */
export function createNodeRuntime(opts: NodeRuntimeOptions): Runtime {
  const logger = opts.logger ?? SILENT_LOGGER;
  const canvas = opts.canvas;
  if (opts.fontFiles !== undefined && canvas.registerFont !== undefined) {
    let registered = 0;
    let unknown = 0;
    for (const [file, data] of opts.fontFiles) {
      const family = bundledFamilyOfFile(file);
      if (family === null) {
        unknown++;
        continue;
      }
      canvas.registerFont(data, family);
      registered++;
    }
    logger.info('fonts_registered', { registered, unknown });
  }
  return createRuntime({
    measurer: CanvasTextMeasurer.fromFactory(opts.canvas, logger),
    fonts: new NodeFontLoader(),
    catalog: opts.catalog,
    ...(opts.generators !== undefined ? { generators: opts.generators } : {}),
    ...(opts.clock !== undefined ? { clock: opts.clock } : {}),
    ...(opts.ids !== undefined ? { ids: opts.ids } : {}),
    logger,
    ...(opts.config !== undefined ? { config: opts.config } : {}),
    host: 'backend',
    ...(opts.testing !== undefined ? { testing: opts.testing } : {}),
    ...(opts.fallbackFamilies !== undefined ? { fallbackFamilies: opts.fallbackFamilies } : {}),
  });
}
