// AC-TXT-13: the resolver table of spec 06 §8.2, per host: a bundled name in mixed case, "",
// "System", "system", sans, serif, monospace, a legacy PostScript name, an available platform
// family (fake source) and an unknown family → Noto Sans. Plus the host fallback families of
// spike b (backend: the Noto script families after the primary, before the generic; browser:
// none) and `fontFallbackCompat` (spec 06 §3.6).
import { describe, expect, it } from 'vitest';
import { FontStyle, FontWeight } from '../../src/style';
import { setTestConfig } from '../../src/testing';
import {
  FontNameResolver,
  FontRegistry,
  buildCanvasFont,
  type FontHost,
  type PlatformFontSource,
  type ResolvedFont,
} from '../../src/text';
import { MANIFEST } from './helpers';

const HOSTS: FontHost[] = ['web', 'ios', 'mac', 'android', 'backend'];
const platform: PlatformFontSource = {
  families: () => ['Avenir Next', 'Bodoni 72', 'Noteworthy'],
  isAvailable: (f) => ['avenir next', 'bodoni 72', 'noteworthy'].includes(f.toLowerCase()),
};
const registry = FontRegistry.fromManifest(MANIFEST, (p) => `/fonts/${p}`);
const resolve = (
  host: FontHost,
  family: string,
  extra: Partial<{ modifier: string; weight: FontWeight; style: FontStyle }> = {},
) =>
  new FontNameResolver(host, registry, host === 'android' || host === 'backend' ? undefined : platform).resolve({
    family,
    modifier: extra.modifier ?? '',
    weight: extra.weight ?? FontWeight.Normal,
    style: extra.style ?? FontStyle.Normal,
  });
const pick = (r: ResolvedFont) => ({ families: r.families, weight: r.weight, style: r.style, source: r.source });

const PLATFORM_DEFAULT: Record<FontHost, readonly string[]> = {
  web: ['sans-serif'],
  ios: ['-apple-system', 'system-ui'],
  mac: ['-apple-system', 'system-ui'],
  android: ['sans-serif'],
  backend: ['"Noto Sans"', 'sans-serif'],
};

describe('FontNameResolver rules (AC-TXT-13)', () => {
  for (const host of HOSTS) {
    describe(host, () => {
      it('rule 1: a bundled family in any case', () => {
        expect(pick(resolve(host, 'noto SERIF'))).toEqual({
          families: ['"Noto Serif"', 'serif'],
          weight: 400,
          style: 'normal',
          source: 'bundled',
        });
        expect(resolve(host, 'CAVEAT').families).toEqual(['"Caveat"', 'cursive']);
        expect(resolve(host, 'Noto Sans Mono').families).toEqual(['"Noto Sans Mono"', 'monospace']);
      });

      it('rule 2: "", "System" and "system" are the platform default', () => {
        for (const f of ['', 'System', 'system']) {
          expect(pick(resolve(host, f))).toEqual({
            families: PLATFORM_DEFAULT[host],
            weight: 400,
            style: 'normal',
            source: 'platform-default',
          });
        }
      });

      it('rule 3: Android generic names', () => {
        expect(resolve(host, 'sans').families).toEqual(['sans-serif']);
        expect(resolve(host, 'serif').families).toEqual(['serif']);
        expect(resolve(host, 'monospace').families).toEqual(['monospace']);
        expect(resolve(host, 'sans').source).toBe('platform');
      });

      it('rule 4: a legacy PostScript name gives its family and face', () => {
        const r = resolve(host, 'Noteworthy-Bold');
        expect(r.weight).toBe(700);
        if (host === 'web' || host === 'ios' || host === 'mac') {
          expect(pick(r)).toEqual({
            families: ['"Noteworthy"', 'sans-serif'],
            weight: 700,
            style: 'normal',
            source: 'platform',
          });
        } else {
          expect(pick(r)).toEqual({
            families: ['"Noto Sans"', 'sans-serif'],
            weight: 700,
            style: 'normal',
            source: 'fallback-default',
          });
        }
      });

      it('rule 5: a family the host has (none on Android and the backend)', () => {
        const r = resolve(host, 'Bodoni 72');
        if (host === 'android' || host === 'backend') expect(r.source).toBe('fallback-default');
        else
          expect(pick(r)).toEqual({
            families: ['"Bodoni 72"', 'sans-serif'],
            weight: 400,
            style: 'normal',
            source: 'platform',
          });
      });

      it('rule 6: an unknown family is Noto Sans, keeping weight and italic (DR-TXT-07)', () => {
        expect(pick(resolve(host, 'Unknown Family', { weight: FontWeight.Bold, style: FontStyle.Italic }))).toEqual({
          families: ['"Noto Sans"', 'sans-serif'],
          weight: 700,
          style: 'italic',
          source: 'fallback-default',
        });
      });
    });
  }

  it('the modifier sets weight, style and stretch; the larger weight wins', () => {
    const r = resolve('web', 'Noto Sans', { modifier: 'CondensedLight', weight: FontWeight.Bold });
    expect([r.weight, r.style, r.stretch]).toEqual([700, 'normal', 'condensed']);
    expect(resolve('web', 'Noto Sans', { modifier: 'Black' }).weight).toBe(900);
    expect(resolve('web', 'Noto Sans', { modifier: 'Light' }).weight).toBe(300);
    expect(resolve('web', 'Noto Sans', { modifier: 'Light', weight: FontWeight.Bold }).weight).toBe(700);
    expect(resolve('web', 'Noto Sans', { modifier: 'Fancy' }).weight).toBe(400);
    expect(resolve('web', 'Noteworthy-Light').weight).toBe(300);
    expect(resolve('web', 'Noto Sans', { modifier: 'Italic' }).style).toBe('italic');
    expect(resolve('web', 'Noto Sans', { style: FontStyle.Oblique }).style).toBe('oblique');
  });

  it('"System" is matched case-insensitively (iOS compared it case-sensitively, spec 06 §14)', () => {
    expect(resolve('ios', 'SYSTEM').source).toBe('platform-default');
  });

  it('accepts the on-device PostScript table in place of the seed (H-TXT-1)', () => {
    const r = new FontNameResolver('web', registry, platform, {
      postScriptNames: new Map([
        ['AvenirNext-UltraLight', { family: 'Avenir Next', weight: 200, italic: false, stretch: 'normal' }],
      ]),
    }).resolve({ family: 'AvenirNext-UltraLight', modifier: '', weight: FontWeight.Normal, style: FontStyle.Normal });
    expect(pick(r)).toEqual({
      families: ['"Avenir Next"', 'sans-serif'],
      weight: 200,
      style: 'normal',
      source: 'platform',
    });
  });
});

describe('host fallback families (spike b)', () => {
  const NOTO_SCRIPTS = ['Noto Sans CJK SC', 'Noto Sans Arabic', 'Noto Color Emoji'];
  const backend = new FontNameResolver('backend', registry, undefined, { fallbackFamilies: NOTO_SCRIPTS });
  const web = new FontNameResolver('web', registry, platform, { fallbackFamilies: [] });
  const s = (family: string) => ({ family, modifier: '', weight: FontWeight.Normal, style: FontStyle.Normal });

  it('backend: inserted after the primary family and before the generic keyword, in order', () => {
    expect(backend.resolve(s('Noto Serif')).families).toEqual([
      '"Noto Serif"',
      '"Noto Sans CJK SC"',
      '"Noto Sans Arabic"',
      '"Noto Color Emoji"',
      'serif',
    ]);
    expect(backend.resolve(s('')).families).toEqual([
      '"Noto Sans"',
      '"Noto Sans CJK SC"',
      '"Noto Sans Arabic"',
      '"Noto Color Emoji"',
      'sans-serif',
    ]);
    expect(backend.resolve(s('Whatever')).primary).toBe('Noto Sans');
    expect(backend.resolve(s('sans')).families).toEqual([...NOTO_SCRIPTS.map((f) => `"${f}"`), 'sans-serif']);
    expect(buildCanvasFont(backend.resolve(s('Caveat')), 15)).toBe(
      'normal 400 15px "Caveat", "Noto Sans CJK SC", "Noto Sans Arabic", "Noto Color Emoji", cursive',
    );
    expect(backend.fallbackFamilies()).toEqual(NOTO_SCRIPTS);
  });

  it('browser: none — the browser falls back per character itself', () => {
    expect(web.resolve(s('Noto Serif')).families).toEqual(['"Noto Serif"', 'serif']);
    expect(web.resolve(s('')).families).toEqual(['sans-serif']);
  });
});

describe('fontFallbackCompat (spec 06 §3.6)', () => {
  it('off by default; on, an unknown family falls back to sans-serif as the C++ web did', () => {
    const off = new FontNameResolver('web', registry, platform);
    const on = new FontNameResolver('web', registry, platform, {
      testing: setTestConfig({ fontFallbackCompat: true }),
    });
    const s = { family: 'Unknown Family', modifier: '', weight: FontWeight.Normal, style: FontStyle.Normal };
    expect(off.resolve(s).families).toEqual(['"Noto Sans"', 'sans-serif']);
    expect(on.resolve(s).families).toEqual(['sans-serif']);
    expect(on.resolve({ ...s, family: 'Noto Serif' }).families).toEqual(['"Noto Serif"', 'serif']);
  });

  it('on the backend, on, "" (the platform default) is sans-serif as the C++ backend drew it (DR-BE-01)', () => {
    const s = { family: '', modifier: '', weight: FontWeight.Normal, style: FontStyle.Normal };
    const off = new FontNameResolver('backend', registry, platform);
    const on = new FontNameResolver('backend', registry, platform, {
      testing: setTestConfig({ fontFallbackCompat: true }),
    });
    expect(off.resolve(s).families[0]).toBe('"Noto Sans"');
    expect(on.resolve(s).families).toEqual(['sans-serif']);
  });
});
