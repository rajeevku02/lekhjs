// `wireframe/ios_contextmenu` (spec 04 §5.3 row 13): hand port of `ios_contextmenu.lua` (template
// `avabodh.wireframe.ioscontextmenu`). A dark bar of comma-separated items with white separators;
// the selected item (`*`) gets a pointer triangle below it.
import type { DrawEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, int, lnum, num } from '../wireframe-lua';

const DARK = -11447725;
const PS = 12;

const iosContextmenu: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/ios_contextmenu',
  generate({ text }, h) {
    const arr = h.split(text, {
      by: ',',
      checkSelection: true,
      checkEscapeNewLine: true,
      checkWidth: true,
      widthPad: 20,
    });
    const th = h.textSize('AA').h;
    let sum = 0;
    for (const it of arr) sum += it.width;
    const data: string[] = [
      `-w/2 + ${num(sum / 2)}`,
      `-${num(PS / 2)}`,
      lnum(sum, arr.length === 0),
      `h-${int(PS)}`,
      '4',
      '4',
      '0',
    ];
    const draw: DrawEntry[] = [
      { path: 'R 0 1 2 3 4 5 6', style: { strokewidth: 0, fillpaint: { color: DARK, type: 2 } } },
    ];
    const texts: TextEntry[] = [];
    let dataEnd = 7;
    let xc = 0;
    arr.forEach((it, i) => {
      const w = it.width;
      data.push(`-w/2 + ${num(xc + w / 2)}`, 'd(1)', num(w), 'd(3)', '0');
      texts.push({ style: { textfill: { color: -1, type: 2 } }, location: indexList(dataEnd, 5), text: it.word });
      dataEnd += 5;
      xc += w;
      if (i !== arr.length - 1) {
        data.push(`-w/2 +${num(xc)}`, '-h/2', `-w/2+${num(xc)}`, 'h/2');
        draw.push({
          path: `M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)}`,
          style: { strokewidth: 2, strokepaint: { color: -1, type: 2 } },
        });
        dataEnd += 4;
      }
      if (it.selected) {
        const d = `d(${String(dataEnd)})`;
        data.push(
          `-w/2 + ${num(xc - w / 2)}-${int(PS)}`,
          `h/2-${int(PS)}`,
          `${d}+${num(PS / 2)}`,
          'h/2',
          `${d}+${int(PS)}`,
          `h/2-${int(PS)}`,
        );
        draw.push({
          path: `M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)} L ${indexList(dataEnd + 4, 2)} Z`,
          style: { strokewidth: 0, fillpaint: { color: DARK, type: 2 } },
        });
        dataEnd += 6;
      }
    });
    return { data, draw, texts, images: [], embeds: [], containers: [], minW: sum, minH: th };
  },
});

export default iosContextmenu;
