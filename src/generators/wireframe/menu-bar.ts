// `wireframe/menu_bar` (spec 04 §5.3 row 21): hand port of `menu_bar.lua` (template
// `avabodh.wireframe.menubar`). Comma-separated menu titles side by side, sized by their text, in a
// white bar; `*` fills the item and `-` disables it.
import type { DrawEntry, JsonObject, TextEntry, WireframeModule } from '../../template';
import { indexList, num } from '../wireframe-lua';

const SELECTED = -10504995;

const menuBar: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/menu_bar',
  generate({ text }, h) {
    const data: string[] = ['w/2', 'h/2', 'w/2', '-h/2', '-w/2', '-h/2', '-w/2', 'h/2'];
    const draw: DrawEntry[] = [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: { fillpaint: { color: -1, type: 2 } } }];
    const texts: TextEntry[] = [];
    const arr = h.split(text, {
      by: ',',
      checkSelection: true,
      checkDisabled: true,
      checkEscapeNewLine: true,
      checkWidth: true,
      widthPad: 18,
    });
    let sum = 0;
    let dataEnd = 8;
    let last = 4;
    let prevx = '-w/2';
    let height = 0;
    for (const it of arr) {
      if (it.height > height) height = it.height;
      sum += it.width;
      const disabled: JsonObject = it.disabled ? { disabled: true } : {};
      const style: JsonObject = {
        ...disabled,
        strokewidth: 0,
        ...(it.selected ? { fillpaint: { color: SELECTED, type: 2 } } : {}),
      };
      data.push(`-w/2+${num(sum)}`, '-h/2', `-w/2+${num(sum)}`, 'h/2');
      draw.push({
        path: `M ${indexList(last, 2)} L ${indexList(last + 2, 2)} L ${indexList(dataEnd + 2, 2)} L ${indexList(dataEnd, 2)} Z`,
        style,
      });
      last = dataEnd;
      dataEnd += 4;
      data.push(`${prevx}+0.5*${num(it.width)}`, '0', num(it.width), 'h', '0');
      prevx = `-w/2+${num(sum)}`;
      texts.push({ style: disabled, location: indexList(dataEnd, 5), text: it.word });
      dataEnd += 5;
    }
    return { data, draw, texts, images: [], embeds: [], containers: [], minW: sum + 8, minH: height + 8 };
  },
});

export default menuBar;
