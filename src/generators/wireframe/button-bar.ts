// `wireframe/button_bar` (spec 04 §5.3 row 7): hand port of `button_bar.lua` (template
// `avabodh.wireframe.buttonbar`). Comma-separated buttons side by side, sized by their text; the
// selected one (`*`) is filled. An empty text draws a plain rectangle.
import type { DrawEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, num } from '../wireframe-lua';

const SELECTED = -10504995;
const WHITE = -1;

const buttonBar: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/button_bar',
  generate({ text }, h) {
    let data = ['-w/2', '-h/2', '-w/2', 'h/2'];
    let draw: DrawEntry[] = [];
    const texts: TextEntry[] = [];
    const arr = h.split(text, {
      by: ',',
      checkSelection: true,
      checkEscapeNewLine: true,
      checkWidth: true,
      widthPad: 2,
    });
    let sum = 0;
    const th = h.textSize('A').h;
    let totalWidth = 0;
    let dataEnd = 4;
    let last = 0;
    let prevx = '-w/2';
    if (arr.length === 0) {
      data = ['0', '0', 'w', 'h', '0.001', '0.001', '0'];
      draw = [{ path: 'R 0 1 2 3 4 5 6' }];
    }
    for (const it of arr) {
      totalWidth += it.width + 8;
      sum += it.widthRatio;
      const fill = it.selected ? SELECTED : WHITE;
      data.push(`-w/2+w*${num(sum)}`, '-h/2', `-w/2+w*${num(sum)}`, 'h/2');
      const s = (n: number) => String(n);
      draw.push({
        path: `M ${s(last)} ${s(last + 1)} L ${s(last + 2)} ${s(last + 3)} L ${s(dataEnd + 2)} ${s(dataEnd + 3)} L ${s(dataEnd)} ${s(dataEnd + 1)} Z`,
        style: { fillpaint: { color: fill, type: 2 } },
      });
      last = dataEnd;
      dataEnd += 4;
      data.push(`${prevx}+w*0.5*${num(it.widthRatio)}`, '0', `w*${num(it.widthRatio)}`, 'h', '0');
      prevx = `-w/2+w*${num(sum)}`;
      texts.push({ location: indexList(dataEnd, 5), text: it.word });
      dataEnd += 5;
    }
    return { data, draw, texts, images: [], embeds: [], containers: [], minW: totalWidth + 8, minH: th + 4 };
  },
});

export default buttonBar;
