// The low-zoom simplification flag (spec 03 §13; AC-ENG-31 unit part): off by default; when on,
// text below minGlyphPx on screen is skipped; never on export.
import { describe, expect, it } from 'vitest';
import { EngineConfig } from '../../src/base';
import { skipTextAtLowZoom } from '../../src/model';

const env = (config: EngineConfig, zoom: number, forExport = false) => ({ config, zoom, forExport, images: null });

describe('lowZoomSimplify', () => {
  it('is off by default: nothing is skipped at any zoom', () => {
    const cfg = new EngineConfig();
    expect(cfg.render.lowZoomSimplify).toBe(false);
    expect(skipTextAtLowZoom(12, 1, env(cfg, 0.01))).toBe(false);
  });

  it('when on, skips text whose glyph height × zoom is below minGlyphPx, never on export', () => {
    const cfg = new EngineConfig({ render: { lowZoomSimplify: true } });
    expect(cfg.render.minGlyphPx).toBe(2);
    expect(skipTextAtLowZoom(12, 1, env(cfg, 0.1))).toBe(true);
    expect(skipTextAtLowZoom(12, 2, env(cfg, 0.1))).toBe(false);
    expect(skipTextAtLowZoom(20, 1, env(cfg, 0.1))).toBe(false);
    expect(skipTextAtLowZoom(12, 1, env(cfg, 0.1, true))).toBe(false);
  });
});
