// `createNodeRuntime({ fallbackFamilies })` (spec 06 §8.1, §11; spec 10 §7): the host's script
// families go into every font string after the primary family, because @napi-rs/canvas falls back
// only between families the string names. Without them a CJK run measures and draws as `.notdef`.
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { createNodeRuntime } from '../../src/headless';
import { FontStyle, FontWeight } from '../../src/style';
import { TemplateCatalog } from '../../src/template';
import { buildCanvasFont, buildFontKey } from '../../src/text';

const canvas = { createCanvas: (w: number, h: number) => createCanvas(w, h) };
const runtime = (fallbackFamilies?: readonly string[]) =>
  createNodeRuntime({
    canvas,
    catalog: TemplateCatalog.empty(),
    ...(fallbackFamilies !== undefined ? { fallbackFamilies } : {}),
  });
const stored = (family: string) => ({ family, modifier: '', weight: FontWeight.Normal, style: FontStyle.Normal });

// A CJK family this box has: the image's Noto CJK, else a CJK face fontconfig lists here.
const CJK = ['Noto Sans CJK JP', 'Noto Sans CJK SC', 'WenQuanYi Zen Hei', 'IPAGothic'].find((f) =>
  GlobalFonts.families.some((x) => x.family === f),
);

describe('createNodeRuntime fallbackFamilies', () => {
  it('are named after the primary family and before the generic keyword', () => {
    const r = runtime(['Noto Sans CJK JP', 'Noto Sans Arabic']).fontResolver.resolve(stored('Noto Sans'));
    expect(r.families).toEqual(['"Noto Sans"', '"Noto Sans CJK JP"', '"Noto Sans Arabic"', 'sans-serif']);
    expect(buildCanvasFont(r, 16)).toBe(
      'normal 400 16px "Noto Sans", "Noto Sans CJK JP", "Noto Sans Arabic", sans-serif',
    );
  });

  it('default to none', () => {
    expect(runtime().fontResolver.fallbackFamilies()).toEqual([]);
  });

  it.skipIf(CJK === undefined)('a CJK sample measures wider than .notdef with a CJK fallback', () => {
    const sample = '漢字かな';
    const tofu = '\u{E000}\u{E001}\u{E002}\u{E003}'; // private-use: .notdef in every face
    const rt = runtime([CJK ?? '']);
    const key = buildFontKey(rt.fontResolver.resolve(stored('Noto Sans')), 16);
    const width = rt.measurer.measureLine(sample, key).width;
    const notdef = rt.measurer.measureLine(tofu, key).width;
    expect(width).toBeGreaterThan(0);
    expect(width).not.toBeCloseTo(notdef, 3);
  });
});
