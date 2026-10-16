// `wireframe/ios_menu` (spec 04 §5.3 row 14): hand port of `ios_menu.lua` (template
// `avabodh.wireframe.iosmenu`). One row per text line, separated by lines, in a rounded box: `*`
// selects (filled), `-` disables, `[o]`/`[x]`/`[+]`/`[-]` (or any `[name]`) is a start icon, a
// trailing `[>]`/`[on]`/`[off]`/`[=]` (or any `[name]`) an end icon, and `,text` an end text.
// Kept as the script had it: the row height is at least `min row height` (24 when unset), and the
// minimum width adds the widest row's text (or its end icon only, when it has one).
import type { DrawEntry, EmbedEntry, JsonObject, TextEntry, WireframeModule } from '../../template';
import { indexList, num, str, truthy } from '../wireframe-lua';

const SELECTED = -10504995;
const LEFT_PAD = 5;

function startIconName(icon: string): string {
  if (icon === 'x' || icon === 'X') return 'avabodh.wireframe.icon_check';
  if (icon === '+') return 'avabodh.wireframe.icon_plus-circle';
  if (icon === '-') return 'avabodh.wireframe.icon_minus-circle';
  return icon;
}

const iosMenu: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/ios_menu',
  generate({ params, text }, h) {
    let rad = params['corner radius'];
    let border = params['border'];
    if (border === null || border === undefined) border = true;
    if (!truthy(rad)) rad = 0.1;
    const rectStyle: JsonObject = truthy(border)
      ? { fillpaint: { color: -1, type: 2 } }
      : { fillpaint: { color: -1, type: 2 }, strokepaint: { strokewidth: 0 } };
    const data: string[] = ['0', '0', 'w', 'h', str(rad), 'd(4)', '0'];
    const draw: DrawEntry[] = [{ path: 'R 0 1 2 3 4 5 6', style: rectStyle }];
    const texts: TextEntry[] = [];
    const embeds: EmbedEntry[] = [];
    const arr = h.split(text, {
      by: '\n',
      checkHeight: true,
      heightPad: 8,
      checkDisabled: true,
      checkStartIcon: true,
      checkEndIcon: true,
      checkSelection: true,
      checkEndText: true,
      checkEscapeNewLine: true,
    });
    const lineHeight = h.textSize('AA').h;
    const icw = lineHeight * 0.9;
    let sum = 0;
    let prevSum = 0;
    let dataEnd = 7;
    let maxw = 0;
    const minParam = params['min row height'];
    const minHeight = truthy(minParam) ? minParam : 24;

    arr.forEach((it, i) => {
      if (i > 0) {
        data.push('-w/2', `-h/2+${num(sum)}`, 'w/2', `-h/2+${num(sum)}`);
        draw.push({ style: { disabled: true }, path: `M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)}` });
        dataEnd += 4;
      }
      if (typeof minHeight !== 'number') throw new TypeError(`attempt to compare number with ${typeof minHeight}`);
      const height = it.height < minHeight ? minHeight : it.height;
      sum += height;
      const cy = `-h/2+${num(prevSum + height / 2)}`;
      if (it.selected) {
        const top = `-h/2+${num(prevSum)}`;
        const bottom = `-h/2+${num(prevSum + height)}`;
        data.push('-w/2', top, '-w/2', bottom, 'w/2', bottom, 'w/2', top);
        draw.push({
          path: `M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)} L ${indexList(dataEnd + 4, 2)} L ${indexList(dataEnd + 6, 2)} Z`,
          style: { strokepaint: { color: 0, type: 2 }, fillpaint: { color: SELECTED, type: 2 } },
        });
        dataEnd += 8;
      }
      const textBox = [num(icw + LEFT_PAD), cy, `w-${num(LEFT_PAD + 1)}`, num(height), '0'];
      let dc: number;
      if (it.startIcon !== undefined) {
        let actualIcw = icw;
        let icon = startIconName(it.startIcon);
        if (it.startIcon === 'o' || it.startIcon === 'O') {
          icon = 'avabodh.wireframe.icon_circle';
          actualIcw = lineHeight * 0.4;
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
      let linew = it.width;
      if (it.endIcon !== undefined) {
        let icon = it.endIcon;
        let eicw = lineHeight * 0.7;
        let ich = eicw;
        const lower = icon.toLowerCase();
        if (icon === '>') {
          icon = 'avabodh.wireframe.icon_chevron-right';
        } else if (lower === 'off') {
          eicw = lineHeight * 1.5;
          ich = eicw * 2;
          icon = 'avabodh.wireframe.icon_toggle-off';
        } else if (lower === 'on') {
          eicw = lineHeight * 1.5;
          ich = eicw * 2;
          icon = 'avabodh.wireframe.icon_toggle-on';
        } else if (icon === '=') {
          icon = 'avabodh.wireframe.icon_bars';
        }
        linew = eicw;
        data.push(`w/2-${num(eicw / 2 + LEFT_PAD)}`, cy, num(eicw), num(ich), '0');
        embeds.push({
          ...(it.disabled ? { style: { disabled: true } } : {}),
          name: icon,
          location: indexList(dataEnd, 5),
          inheritstyle: true,
          mode: 'aspect',
        });
        dataEnd += 5;
      } else if (it.endText !== undefined) {
        const sz = h.textSize(it.endText);
        linew += sz.w;
        data.push(`w/2-${num(sz.w / 2)}-${num(LEFT_PAD + 2)}`, cy, num(sz.w + 2), num(sz.h + 2), '0');
        texts.push({
          style: it.disabled ? { textalignhorizontal: 3, disabled: true } : { textalignhorizontal: 3 },
          location: indexList(dataEnd, 5),
          text: it.endText,
        });
        dataEnd += 5;
      }
      prevSum = sum;
      if (maxw < linew) maxw = linew;
    });
    return {
      data,
      draw,
      texts,
      images: [],
      embeds,
      containers: [],
      minW: LEFT_PAD + icw + maxw + LEFT_PAD,
      minH: sum + 8,
    };
  },
});

export default iosMenu;
