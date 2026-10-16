// `wireframe/vtabs` (spec 04 §5.3 row 33): hand port of `vtabs.lua` (template
// `avabodh.wireframe.vtabs`). The vertical `tabs`: one tab per text line down the left (or the
// right, by `position`), aligned top, center or bottom, as wide as the widest; unselected tabs are
// grey, the selected one (`*`) opens into the panel, and `-` disables a tab. The panel is a
// container, and the first point is the shape's align point.
import type { DrawEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, num } from '../wireframe-lua';

const PANEL = -637534209;
const UNSELECTED = -1184275;

function line(at: number): DrawEntry {
  return { path: `M ${String(at)} ${String(at + 1)} L ${String(at + 2)} ${String(at + 3)}` };
}

const vtabs: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/vtabs',
  generate({ params, text }, h) {
    const arr = h.split(text, {
      by: '\n',
      checkDisabled: true,
      checkSelection: true,
      checkWidth: true,
      widthPad: 20,
      heightPad: 18,
    });
    // The script measures "AA" and never reads it.
    h.textSize('AA');
    let maxw = 0;
    let sum = 0;
    for (const it of arr) {
      sum += it.height;
      if (it.width > maxw) maxw = it.width;
    }
    let starty = '-h/2';
    let endy = `-h/2+${num(sum)}`;
    if (params['align'] === 'center') {
      starty = num(-sum / 2);
      endy = num(sum / 2);
    } else if (params['align'] === 'bottom') {
      starty = `h/2 - ${num(sum)}`;
      endy = 'h/2';
    }
    const right = params['position'] === 'right';
    const boxx = right ? `w/2 - ${num(maxw)}` : `-w/2 + ${num(maxw)}`;
    const lastx = right ? 'w/2' : '-w/2';
    const htw = right ? `-${num(maxw / 2)}` : `+${num(maxw / 2)}`;
    const far = right ? '-w/2' : 'w/2';
    const data = [
      boxx,
      '-h/2',
      boxx,
      starty,
      lastx,
      starty,
      lastx,
      endy,
      boxx,
      endy,
      boxx,
      'h/2',
      far,
      'h/2',
      far,
      '-h/2',
    ];
    const draw: DrawEntry[] = [
      {
        path: 'M 0 1 L 2 3 L 4 5 L 6 7 L 8 9 L 10 11 L 12 13 L 14 15 Z',
        style: { fillpaint: { color: PANEL, type: 2 } },
      },
    ];
    const texts: TextEntry[] = [];
    let dataEnd = 16;
    let prevy = starty;
    arr.forEach((it, i) => {
      const cury = `${prevy}+${num(it.height)}`;
      if (i < arr.length - 1) {
        data.push(lastx, cury, boxx, cury);
        draw.push(line(dataEnd));
        dataEnd += 4;
      }
      if (!it.selected) {
        data.push(boxx, prevy, boxx, cury);
        draw.push(line(dataEnd));
        dataEnd += 4;
        data.push(lastx, prevy, lastx, cury, boxx, cury, boxx, prevy);
        draw.push({
          style: { fillpaint: { color: UNSELECTED, type: 2 } },
          path: ` M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)} L ${indexList(dataEnd + 4, 2)} L ${indexList(dataEnd + 6, 2)} Z`,
        });
        dataEnd += 8;
      }
      data.push(`${lastx}${htw}`, `${prevy}+${num(it.height / 2)}`, num(maxw), num(it.height), '0');
      texts.push({
        ...(it.disabled ? { style: { disabled: true } } : {}),
        location: `${indexList(dataEnd, 5)} `,
        text: it.word,
      });
      dataEnd += 5;
      prevy = cury;
    });
    return {
      data,
      draw,
      texts,
      images: [],
      embeds: [],
      containers: ['M 0 1 L 10 11 L 12 13 L 14 15 Z'],
      alignPoints: '0 1',
      minW: maxw,
      minH: sum,
    };
  },
});

export default vtabs;
