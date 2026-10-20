// Owner round UI8 #3: the swatch a colour picker ticks. C++ `ColorEditor::setColor` picks the swatch
// with the smallest `cdist` (ColorEditor.cpp:58-80, 96-102), and `cdist` subtracts `unsigned`
// channels (`color_t`, base/TypeDefinitions.h), so a swatch brighter than the colour in any channel
// wraps to a distance near 2^32. Measured on the C++ web build: a rectangle filled (204, 204, 255)
// opens its Fill popup with swatch 21 ticked, (95, 180, 221); the port ticked 25, (210, 228, 252),
// the true RGB nearest. The same editor backs the stroke, text and background pickers.
import { describe, expect, it } from 'vitest';
import { ColorEditor, ColorType } from '../../src/edit/editors';
import { BACKGROUND_COLORS, Color, LEKH_COLORS } from '../../src/style';

/** Swatch index of a palette colour in a picker of `type` (line / text / fill have a first swatch). */
const at = (type: ColorType, c: Color): number =>
  (type === ColorType.Background ? 0 : 1) +
  (type === ColorType.Background ? BACKGROUND_COLORS : LEKH_COLORS).findIndex(
    (x) => x.red === c.red && x.green === c.green && x.blue === c.blue,
  );

function picked(type: ColorType, c: Color): number {
  const ce = new ColorEditor();
  ce.init(type, 6, null);
  ce.setColor(c);
  return ce.currentIndex();
}

describe('UI8 #3: ColorEditor ticks the swatch C++ cdist picks', () => {
  it('fill (204, 204, 255) ticks swatch 21, (95, 180, 221), as the C++ build', () => {
    expect(picked(ColorType.Fill, new Color(204, 204, 255))).toBe(21);
    expect(at(ColorType.Fill, new Color(95, 180, 221))).toBe(21);
  });

  it('the stroke and text pickers use the same rule', () => {
    for (const t of [ColorType.Line, ColorType.Text]) {
      expect(picked(t, new Color(204, 204, 255))).toBe(at(t, new Color(95, 180, 221)));
      // (250, 5, 5): red (255, 0, 0) is brighter in red, so C++ lands on black.
      expect(picked(t, new Color(250, 5, 5))).toBe(at(t, new Color(0, 0, 0)));
    }
  });

  it('an exact palette colour still ticks its own swatch, and the colour is shown in it', () => {
    const ce = new ColorEditor();
    ce.init(ColorType.Fill, 6, null);
    const c = new Color(210, 228, 252, 230);
    ce.setColor(c);
    expect(ce.currentIndex()).toBe(25);
    expect(ce.currentColor().equals(c)).toBe(true);
  });

  it('cdist is the C++ unsigned, float distance', () => {
    expect(ColorEditor.cdist(new Color(204, 204, 255), new Color(95, 180, 221))).toBeCloseTo(
      Math.sqrt(109 ** 2 + 24 ** 2 + 34 ** 2),
      3,
    );
    // a channel larger in the swatch wraps: 2^32 - 6 as a float
    expect(ColorEditor.cdist(new Color(204, 204, 255), new Color(210, 204, 255))).toBe(Math.fround(2 ** 32 - 6));
  });

  it('background: same rule over the background palette', () => {
    const ce = new ColorEditor();
    ce.init(ColorType.Background, 6, null);
    ce.setColor(new Color(255, 255, 255));
    expect(ce.currentIndex()).toBe(at(ColorType.Background, new Color(255, 255, 255)));
  });
});
