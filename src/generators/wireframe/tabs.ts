// `wireframe/tabs` (spec 04 §5.3 row 29): hand port of `tabs.lua` (template `avabodh.wireframe.tabs`).
// A tabbed panel: comma-separated tabs sized by their text along the top (or the bottom, by
// `position`), aligned left, center or right; unselected tabs are grey and separated from the
// panel, the selected one (`*`) opens into it, and `-` disables a tab. The panel below the tabs is
// a container, and the first point is the shape's align point.
import type { DrawEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, num } from '../wireframe-lua';

const PANEL = -637534209;
const UNSELECTED = -1184275;

function line(at: number): DrawEntry {
  return { path: `M ${String(at)} ${String(at + 1)} L ${String(at + 2)} ${String(at + 3)}` };
}

const tabs: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/tabs',
  generate({ params, text }, h) {
    const arr = h.split(text, { by: ',', checkDisabled: true, checkSelection: true, checkWidth: true, widthPad: 20 });
    const lineHeight = h.textSize('AA').h;
    const tabHeight = 30 + lineHeight * 0.2;
    let sum = 0;
    for (const it of arr) sum += it.width;
    let startx = '-w/2';
    let endx = `-w/2+${num(sum)}`;
    if (params['align'] === 'center') {
      startx = num(-sum / 2);
      endx = num(sum / 2);
    } else if (params['align'] === 'right') {
      startx = `w/2 - ${num(sum)}`;
      endx = 'w/2';
    }
    const bottom = params['position'] === 'bottom';
    const boxy = bottom ? `h/2 - ${num(tabHeight)}` : `-h/2 + ${num(tabHeight)}`;
    const topy = bottom ? 'h/2' : '-h/2';
    const hth = bottom ? `-${num(tabHeight / 2)}` : `+${num(tabHeight / 2)}`;
    const far = bottom ? '-h/2' : 'h/2';
    const data = [
      '-w/2',
      boxy,
      startx,
      boxy,
      startx,
      topy,
      endx,
      topy,
      endx,
      boxy,
      'w/2',
      boxy,
      'w/2',
      far,
      '-w/2',
      far,
    ];
    const draw: DrawEntry[] = [
      {
        path: 'M 0 1 L 2 3 L 4 5 L 6 7 L 8 9 L 10 11 L 12 13 L 14 15 Z',
        style: { fillpaint: { color: PANEL, type: 2 } },
      },
    ];
    const texts: TextEntry[] = [];
    let prevx = startx;
    let dataEnd = 16;
    arr.forEach((it, i) => {
      const curx = `${prevx}+${num(it.width)}`;
      if (i < arr.length - 1) {
        data.push(curx, topy, curx, boxy);
        draw.push(line(dataEnd));
        dataEnd += 4;
      }
      if (!it.selected) {
        data.push(prevx, boxy, curx, boxy);
        draw.push(line(dataEnd));
        dataEnd += 4;
        data.push(prevx, boxy, curx, boxy, curx, topy, prevx, topy);
        draw.push({
          style: { fillpaint: { color: UNSELECTED, type: 2 } },
          path: ` M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)} L ${indexList(dataEnd + 4, 2)} L ${indexList(dataEnd + 6, 2)} Z`,
        });
        dataEnd += 8;
      }
      data.push(`${prevx}+${num(it.width / 2)}`, `${topy}${hth}`, num(it.width), num(tabHeight), '0');
      texts.push({
        ...(it.disabled ? { style: { disabled: true } } : {}),
        location: `${indexList(dataEnd, 5)} `,
        text: it.word,
      });
      dataEnd += 5;
      prevx = curx;
    });
    return {
      data,
      draw,
      texts,
      images: [],
      embeds: [],
      containers: ['M 0 1 L 10 11 L 12 13 L 14 15 Z'],
      alignPoints: '0 1',
      minW: sum,
      minH: tabHeight,
    };
  },
});

export default tabs;
