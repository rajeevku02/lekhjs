// The rounded box with a pointer that `popover.lua` and `tooltip.lua` both draw (spec 04 §5.3 rows
// 24 and 30): the same 40 data values in both scripts, with the corner radius and pointer size
// their only difference. Shared by the two hand-ported modules and bundled into each one's text.
import { num } from './wireframe-lua';

/** The scripts' Bézier circle constant. */
const K = 0.5522847498;

/** The draw path over the 40 values: four sides and four corners. */
export const BUBBLE_PATH =
  'M 0 1 L 2 3 L 4 5 L 6 7 L 8 9 C 10 11 12 13 14 15 L 16 17 C 18 19 20 21 22 23 L 24 25 C 26 27 28 29 30 31 L 32 33 C 34 35 36 37 38 39 Z';

/**
 * The outline's 40 data values. `pointer` is `left`, `right`, `bottom`, or anything else for top;
 * `pos` (0..1) places the pointer along its side; `rad` is the corner radius and `ps` the pointer
 * size.
 */
export function bubbleData(pointer: unknown, pos: number, rad: number, ps: number): string[] {
  const r = num(rad);
  const k = num(rad * (1 - K));
  const span = num(-2 * rad - ps);
  if (pointer === 'left' || pointer === 'right') {
    const right = pointer === 'right';
    const topx = right ? 'w/2' : '-w/2';
    const boxx = right ? `w/2 - ${num(ps)}` : `-w/2 + ${num(ps)}`;
    const starty = `-h/2 +${r}+${num(pos)}*(h ${span})`;
    const data = [
      boxx,
      `-h/2+${r}`,
      boxx,
      starty,
      topx,
      `${starty}+${num(ps / 2)}`,
      boxx,
      `${starty}+${num(ps)}`,
      boxx,
      `h/2 - ${r}`,
    ];
    if (right) {
      data.push(
        boxx,
        `h/2 - ${k}`,
        `${boxx}-${k}`,
        'h/2',
        `${boxx}-${r}`,
        'h/2',
        `-w/2+${r}`,
        'h/2',
        `-w/2+${k}`,
        'h/2',
        '-w/2',
        `h/2-${k}`,
        '-w/2',
        `h/2-${r}`,
        '-w/2',
        `-h/2 +${r}`,
        '-w/2',
        `-h/2 + ${k}`,
        `-w/2+${k}`,
        '-h/2',
        `-w/2+${r}`,
        '-h/2',
        `${boxx}-${r}`,
        '-h/2',
        `${boxx}-${k}`,
        '-h/2',
        boxx,
        `-h/2+${k}`,
        boxx,
        `-h/2+${r}`,
      );
    } else {
      data.push(
        boxx,
        `h/2 - ${k}`,
        `${boxx}+${k}`,
        'h/2',
        `${boxx}+${r}`,
        'h/2',
        `w/2-${r}`,
        'h/2',
        `w/2-${k}`,
        'h/2',
        'w/2',
        `h/2-${k}`,
        'w/2',
        `h/2-${r}`,
        'w/2',
        `-h/2 +${r}`,
        'w/2',
        `-h/2 + ${k}`,
        `w/2-${k}`,
        '-h/2',
        `w/2-${r}`,
        '-h/2',
        `${boxx}+${r}`,
        '-h/2',
        `${boxx}+${k}`,
        '-h/2',
        boxx,
        `-h/2+${k}`,
        boxx,
        `-h/2+${r}`,
      );
    }
    return data;
  }
  const bottom = pointer === 'bottom';
  const topy = bottom ? 'h/2' : '-h/2';
  const boxy = bottom ? `h/2 - ${num(ps)}` : `-h/2 + ${num(ps)}`;
  const startx = `-w/2 +${r}+${num(pos)}*(w ${span})`;
  const data = [
    `-w/2+${r}`,
    boxy,
    startx,
    boxy,
    `${startx}+${num(ps / 2)}`,
    topy,
    `${startx}+${num(ps)}`,
    boxy,
    `w/2-${r}`,
    boxy,
  ];
  if (bottom) {
    data.push(
      `w/2 -${k}`,
      boxy,
      'w/2',
      `${boxy}-${k}`,
      'w/2',
      `${boxy}-${r}`,
      'w/2',
      `-h/2 +${r}`,
      'w/2',
      `-h/2+${k}`,
      `w/2-${k}`,
      '-h/2',
      `w/2-${r}`,
      '-h/2',
      `-w/2+${r}`,
      '-h/2',
      `-w/2+${k}`,
      '-h/2',
      '-w/2',
      `-h/2+${k}`,
      '-w/2',
      `-h/2+${r}`,
      '-w/2',
      `${boxy}-${r}`,
      '-w/2',
      `${boxy}-${k}`,
      `-w/2+${k}`,
      boxy,
      `-w/2+${r}`,
      boxy,
    );
  } else {
    data.push(
      `w/2 -${k}`,
      boxy,
      'w/2',
      `${boxy}+${k}`,
      'w/2',
      `${boxy}+${r}`,
      'w/2',
      `h/2 -${r}`,
      'w/2',
      `h/2-${k}`,
      `w/2-${k}`,
      'h/2',
      `w/2-${r}`,
      'h/2',
      `-w/2+${r}`,
      'h/2',
      `-w/2+${k}`,
      'h/2',
      '-w/2',
      `h/2-${k}`,
      '-w/2',
      `h/2-${r}`,
      '-w/2',
      `${boxy}+${r}`,
      '-w/2',
      `${boxy}+${k}`,
      `-w/2+${k}`,
      boxy,
      `-w/2+${r}`,
      boxy,
    );
  }
  return data;
}
