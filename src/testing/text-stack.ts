// A ready text stack for tests: registry, resolver, line-width cache, layout and painter over a
// measurer (a `CanvasTextMeasurer` over the caller's canvas, or a `RecordedWidthMeasurer`).
// `createTestRuntime` (spec 01 §4.1) will build on it once `session/` exists.
import {
  FontNameResolver,
  FontRegistry,
  LineWidthCache,
  NO_PLATFORM_FONTS,
  TextLayout,
  TextPainter,
  type FontHost,
  type FontsManifest,
  type PlatformFontSource,
  type TextMeasurer,
} from '../text';
import { setTestConfig, type TestConfig, type TestConfigOverrides } from './test-config';

export interface TestTextStackOptions {
  measurer: TextMeasurer;
  host?: FontHost;
  manifest?: FontsManifest;
  platform?: PlatformFontSource;
  fallbackFamilies?: readonly string[];
  testing?: TestConfigOverrides;
  cacheCapacity?: number;
}

export interface TestTextStack {
  readonly measurer: TextMeasurer;
  readonly registry: FontRegistry;
  readonly resolver: FontNameResolver;
  readonly cache: LineWidthCache;
  readonly layout: TextLayout;
  readonly painter: TextPainter;
  readonly testing: TestConfig;
}

export function createTestTextStack(opts: TestTextStackOptions): TestTextStack {
  const testing = setTestConfig(opts.testing);
  const registry =
    opts.manifest !== undefined ? FontRegistry.fromManifest(opts.manifest, (p) => p) : new FontRegistry();
  const resolver = new FontNameResolver(opts.host ?? 'backend', registry, opts.platform ?? NO_PLATFORM_FONTS, {
    ...(opts.fallbackFamilies !== undefined ? { fallbackFamilies: opts.fallbackFamilies } : {}),
    testing,
  });
  const cache = new LineWidthCache(opts.cacheCapacity);
  const layout = new TextLayout({ measurer: opts.measurer, cache, fonts: registry, testing });
  return { measurer: opts.measurer, registry, resolver, cache, layout, painter: new TextPainter(), testing };
}
