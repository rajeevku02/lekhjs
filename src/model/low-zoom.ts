// Low-zoom simplification (spec 03 §13; decision Q6): a flag, off by default. When
// `config.render.lowZoomSimplify` is on and a text slot's screen-space glyph height
// (`effectiveFontSize × multiplier × zoom`) is below `config.render.minGlyphPx`, `paint()` skips
// that text's fill calls. Layout and hit testing are unaffected, and it never applies to export.
// Humans decide visually whether to turn it on after the app runs.
import type { DrawingPlatform } from '../render';
import type { Style } from '../style';
import type { LaidOutText } from '../text';
import type { PaintEnv } from './lekh-object';

/** True when the text of this size is too small on screen to fill (and the flag is on). */
export function skipTextAtLowZoom(effectiveFontSize: number, multiplier: number, env: PaintEnv): boolean {
  const r = env.config.render;
  if (!r.lowZoomSimplify || env.forExport) return false;
  return effectiveFontSize * multiplier * env.zoom < r.minGlyphPx;
}

/**
 * `dp`, or (flag on, not export) a wrapper that drops the text whose screen glyph height is under
 * `minGlyphPx`. Only text fills are skipped; paths and images draw as usual.
 */
export function lowZoomTextFilter(dp: DrawingPlatform, env: PaintEnv): DrawingPlatform {
  const r = env.config.render;
  if (!r.lowZoomSimplify || env.forExport) return dp;
  return new Proxy(dp, {
    get(target, prop, receiver) {
      if (prop === 'drawText') {
        return (text: LaidOutText, style: Style) => {
          if (skipTextAtLowZoom(style.effectiveFontSize(), style.effectiveFontMultiplier(), env)) return;
          target.drawText(text, style);
        };
      }
      const v: unknown = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
