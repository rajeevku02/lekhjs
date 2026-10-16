// The two colour palettes of C++ `LekhUtil::getColors` and `getBackgroundColors`
// (`L/LekhUtil.cpp:88-151`): the stroke/fill/text swatches of the colour editor (`edit/ColorEditor`)
// and the remote-pointer colours (`sync/PresenceTracker`), and the page background swatches.
import { Color } from './color';

const c = (r: number, g: number, b: number, a = 255): Color => Object.freeze(new Color(r, g, b, a));

/** C++ `LekhUtil::getColors()`, in its order. */
export const LEKH_COLORS: readonly Color[] = Object.freeze([
  c(255, 255, 255),
  c(0, 0, 0),
  c(255, 0, 0),
  c(241, 60, 8),
  c(255, 0, 102),
  c(255, 0, 255),
  c(255, 94, 170),
  c(169, 90, 116),
  c(183, 4, 166),
  c(130, 35, 135),
  c(0, 255, 0),
  c(127, 175, 27),
  c(135, 139, 16),
  c(95, 180, 22),
  c(73, 138, 85),
  c(37, 66, 39),
  c(0, 0, 255),
  c(44, 99, 191),
  c(24, 99, 138),
  c(0, 180, 255),
  c(95, 180, 221),
  c(78, 11, 209),
  c(1, 141, 175),
  c(0, 255, 255),
  c(210, 228, 252),
  c(255, 255, 0),
  c(195, 255, 104),
  c(185, 216, 26),
  c(206, 118, 5),
  c(133, 93, 57),
  c(198, 152, 100),
  c(210, 186, 128),
  c(225, 206, 163),
  c(251, 184, 41),
  c(255, 153, 0),
]);

/** C++ `LekhUtil::getBackgroundColors()`, in its order. */
export const BACKGROUND_COLORS: readonly Color[] = Object.freeze([
  c(255, 255, 255),
  c(204, 204, 204),
  c(255, 204, 204),
  c(204, 255, 204),
  c(204, 204, 255),
  c(255, 255, 204),
  c(255, 204, 255),
  c(204, 255, 255),
  c(210, 228, 252),
  c(225, 206, 163),
  c(195, 255, 104),
  c(255, 127, 127),
  c(127, 255, 127),
  c(127, 127, 255),
]);
