// `wireframe/listbox` (spec 04 §5.3 row 19): hand port of `listbox.lua` (template
// `avabodh.wireframe.listbox`). One item per text line, at least `min item height` high (24 when
// unset): `*` selects (filled), `-` disables, `[name]` draws that icon before the text, and when
// any item has an icon the others are indented to match.
import type { DrawEntry, EmbedEntry, JsonObject, TextEntry, WireframeModule } from '../../template';
import { indexList, int, lnum, num, truthy } from '../wireframe-lua';

const SELECTED = -10504995;
const LEFT_PAD = 4;

const listbox: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/listbox',
  generate({ params, text }, h) {
    const data: string[] = ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'];
    const rectStyle: JsonObject = truthy(params['border'])
      ? { fillpaint: { color: -1, type: 2 } }
      : { fillpaint: { color: -1, type: 2 }, strokepaint: { strokewidth: 0 } };
    const draw: DrawEntry[] = [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: rectStyle }];
    const texts: TextEntry[] = [];
    const embeds: EmbedEntry[] = [];
    const arr = h.split(text, {
      by: '\n',
      checkHeight: true,
      heightPad: 8,
      checkDisabled: true,
      checkStartIcon: true,
      checkSelection: true,
    });
    const iconGap = arr.some((it) => it.startIcon !== undefined);
    let sum = 0;
    let prevSum = 0;
    // Lua integer or float (`tostring` prints `.0` only on a float): a default 24 or an integral
    // parameter is an integer, a measured height a float, and a sum is an integer until a float joins.
    let sumInt = true;
    let prevInt = true;
    let dataEnd = 8;
    let maxw = 0;
    const minParam = params['min item height'];
    const minHeight = truthy(minParam) ? minParam : 24;
    for (const it of arr) {
      if (typeof minHeight !== 'number') throw new TypeError(`attempt to compare number with ${typeof minHeight}`);
      const height = it.height < minHeight ? minHeight : it.height;
      const heightInt = it.height < minHeight && Number.isInteger(minHeight);
      sum += height;
      sumInt = sumInt && heightInt;
      if (it.width > maxw) maxw = it.width;
      const icw = height * 0.7;
      const cy = `-h/2+${num(prevSum + height / 2)}`;
      if (it.selected) {
        const top = `-h/2+${lnum(prevSum, prevInt)}`;
        const bottom = `-h/2+${lnum(prevSum + height, prevInt && heightInt)}`;
        data.push('-w/2', top, '-w/2', bottom, 'w/2', bottom, 'w/2', top);
        draw.push({
          path: `M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)} L ${indexList(dataEnd + 4, 2)} L ${indexList(dataEnd + 6, 2)} Z`,
          style: { strokepaint: { color: 0, type: 2 }, fillpaint: { color: SELECTED, type: 2 } },
        });
        dataEnd += 8;
      }
      let dc: number;
      if (it.startIcon !== undefined) {
        data.push(num(icw + LEFT_PAD), cy, `w-${num(icw + LEFT_PAD)}`, lnum(height, heightInt), '0');
        data.push(`-w/2+${num(LEFT_PAD + icw / 2)}`, cy, num(icw), num(icw), '0');
        dc = 10;
        embeds.push({
          ...(it.disabled ? { style: { disabled: true } } : {}),
          name: it.startIcon,
          location: indexList(dataEnd + 5, 5),
          inheritstyle: true,
          mode: 'aspect',
        });
      } else {
        if (iconGap) data.push(num(icw + LEFT_PAD), cy, `w-${num(icw + LEFT_PAD)}`, lnum(height, heightInt), '0');
        else data.push(int(LEFT_PAD), cy, `w-${int(LEFT_PAD)}`, lnum(height, heightInt), '0');
        dc = 5;
      }
      texts.push({
        style: it.disabled ? { textalignhorizontal: 2, disabled: true } : { textalignhorizontal: 2 },
        location: indexList(dataEnd, 5),
        text: it.word,
      });
      dataEnd += dc;
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
      minW: maxw + 2 * LEFT_PAD,
      minH: sum + 2 * LEFT_PAD,
    };
  },
});

export default listbox;
