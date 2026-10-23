// Owner round UF2: "When a shape is selected, then on the selection rectangle we show connection
// draggers. We basically draw a circle for it. In the dark mode the circle becomes full solid."
// A connect handle is a ring (radius 6, 1 px stroke in `selection_rectangle_corner_color`) filled
// under a dot (radius 3.5, the same colour). The corner colour is black in both themes
// (WidgetStyle.cpp:374), and the ring was filled with the theme's `system_background_color`,
// black in dark mode, so ring and dot were one black disc. The ring is now white in both themes.
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import { overlayTokens, type OverlayTheme } from '../../src/interaction/overlay-tokens';
import { ConnectHandle } from '../../src/interaction/selection/connect-handles';
import { Color } from '../../src/style';
import { RecordingPlatform } from '../render/helpers';

function drawn(theme: OverlayTheme): { ringFill: Color | null; ringStroke: Color | null; dotFill: Color | null } {
  const dp = new RecordingPlatform();
  const h = new ConnectHandle(0);
  h.place(new Point(50, 50), true);
  h.draw(dp, overlayTokens(theme));
  expect(dp.paths).toHaveLength(2);
  const [ring, dot] = dp.paths;
  return {
    ringFill: ring?.style.effectiveFillPaint().solidColor ?? null,
    ringStroke: ring?.style.effectiveStrokePaint().solidColor ?? null,
    dotFill: dot?.style.effectiveFillPaint().solidColor ?? null,
  };
}

const WHITE = new Color(255, 255, 255);
const BLACK = new Color(0, 0, 0);

describe('connect handle colours (owner round UF2)', () => {
  it('light: a white ring, black stroke and dot (unchanged)', () => {
    const d = drawn('light');
    expect(d.ringFill?.equals(WHITE)).toBe(true);
    expect(d.ringStroke?.equals(BLACK)).toBe(true);
    expect(d.dotFill?.equals(BLACK)).toBe(true);
  });

  it('dark: the same white ring, so the dot does not merge with it into a solid disc', () => {
    const d = drawn('dark');
    expect(d.ringFill?.equals(WHITE)).toBe(true);
    expect(d.ringFill?.equals(d.dotFill ?? WHITE)).toBe(false);
    expect(d.dotFill?.equals(BLACK)).toBe(true);
  });
});
