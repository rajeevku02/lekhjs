// `wireframe/menu` (spec 04 §5.3 row 20): hand port of `menu.lua` (template
// `avabodh.wireframe.menu`). One item per text line: `*` selects (filled), `-` disables, `[o]`
// draws a bullet and `[x]` a check (any other `[name]` that icon), `,text` is a right-aligned end
// text (a shortcut), and a line that reads `-`, `--`, `---`, `----` or `=` after the markup is
// parsed is a separator. As the script had it, the leading `-` of a separator line is the disabled
// marker, so a single `-` line is an empty disabled item and `--` is the shortest separator.
import type { DrawEntry, EmbedEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, int, lnum, num } from '../wireframe-lua';

const SELECTED = -10504995;
const LEFT_PAD = 5;
const SEPARATORS: readonly string[] = Object.freeze(['-', '--', '---', '----', '=']);

const menu: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/menu',
  generate({ text }, h) {
    const data: string[] = ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'];
    const draw: DrawEntry[] = [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: { fillpaint: { color: -1, type: 2 } } }];
    const texts: TextEntry[] = [];
    const embeds: EmbedEntry[] = [];
    const arr = h.split(text, {
      by: '\n',
      checkHeight: true,
      heightPad: 8,
      checkDisabled: true,
      checkStartIcon: true,
      checkSelection: true,
      checkEndText: true,
    });
    const lineHeight = h.textSize('AA').h;
    const icw = lineHeight * 0.7;
    let sum = 0;
    let prevSum = 0;
    // A sum is a Lua integer (0) until the first measured (float) height is added.
    let sumInt = true;
    let prevInt = true;
    let dataEnd = 8;
    let maxw = 0;
    for (const it of arr) {
      if (SEPARATORS.includes(it.word)) {
        data.push('-w/2', `-h/2+${lnum(sum, sumInt)}`, 'w/2', `-h/2+${lnum(sum, sumInt)}`);
        draw.push({ style: { disabled: true }, path: `M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)}` });
        dataEnd += 4;
        continue;
      }
      sum += it.height;
      sumInt = false;
      let width = h.textSize(it.word).w;
      if (it.endText !== undefined) width += h.textSize(it.endText).w;
      if (width > maxw) maxw = width;
      const cy = `-h/2+${num(prevSum + it.height / 2)}`;
      if (it.selected) {
        const top = `-h/2+${lnum(prevSum, prevInt)}`;
        const bottom = `-h/2+${num(prevSum + it.height)}`;
        data.push('-w/2', top, '-w/2', bottom, 'w/2', bottom, 'w/2', top);
        draw.push({
          path: `M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)} L ${indexList(dataEnd + 4, 2)} L ${indexList(dataEnd + 6, 2)} Z`,
          style: { strokepaint: { color: 0, type: 2 }, fillpaint: { color: SELECTED, type: 2 } },
        });
        dataEnd += 8;
      }
      const textBox = [num(icw + LEFT_PAD), cy, `w-${int(LEFT_PAD + 1)}`, num(it.height), '0'];
      let dc: number;
      if (it.startIcon !== undefined) {
        let icon = it.startIcon;
        let actualIcw = icw;
        if (icon === 'o' || icon === 'O') {
          icon = 'avabodh.wireframe.icon_circle';
          actualIcw = lineHeight * 0.4;
        } else if (icon === 'x' || icon === 'X') {
          icon = 'avabodh.wireframe.icon_check';
        }
        data.push(...textBox);
        data.push(`-w/2+${num(LEFT_PAD + icw / 2)}`, cy, num(actualIcw), num(actualIcw), '0');
        dc = 10;
        embeds.push({
          ...(it.disabled ? { style: { disabled: true } } : {}),
          name: icon,
          location: indexList(dataEnd + 5, 5),
          inheritstyle: true,
          mode: 'aspect',
        });
      } else {
        data.push(...textBox);
        dc = 5;
      }
      texts.push({
        style: it.disabled ? { textalignhorizontal: 2, disabled: true } : { textalignhorizontal: 2 },
        location: indexList(dataEnd, 5),
        text: it.word,
      });
      dataEnd += dc;
      if (it.endText !== undefined) {
        const sz = h.textSize(it.endText);
        data.push(`w/2-${num(sz.w / 2)}-${int(LEFT_PAD + 2)}`, cy, num(sz.w + 2), num(sz.h + 2), '0');
        texts.push({
          style: it.disabled ? { textalignhorizontal: 3, disabled: true } : { textalignhorizontal: 3 },
          location: indexList(dataEnd, 5),
          text: it.endText,
        });
        dataEnd += 5;
      }
      prevSum = sum;
      prevInt = sumInt;
    }
    return {
      data,
      draw,
      texts,
      images: [],
      embeds,
      containers: [],
      minW: maxw + icw + 2 * LEFT_PAD + 8,
      minH: sum + 8,
    };
  },
});

export default menu;
