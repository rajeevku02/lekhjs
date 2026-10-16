// `wireframe/tabbar` (spec 04 §5.3 row 28): hand port of `tabbar.lua` (template
// `avabodh.wireframe.tabshead`). Comma-separated tabs across the width, each in proportion to its
// text, with rounded top corners of `corner radius`; the selected tab (`*`) is grey. No tabs draw a
// plain rectangle. The radius is spliced into the expressions as Lua's `tostring` wrote it (a nil
// radius is the name `nil`, which evaluates to 0).
import type { DrawEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, num } from '../wireframe-lua';
import { luaToString } from '../wireframe-lua-param';

/** `rad * K` as the script hard-codes it (for the default radius). */
const RADK = '3.5817220016';

/** The script's `seq(from, count)`: each index preceded by a space. */
function seq(from: number, count: number): string {
  return ` ${indexList(from, count)}`;
}

const tabbar: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/tabbar',
  generate({ params, text }, h) {
    const rad = luaToString(params['corner radius']);
    const arr = h.split(text, {
      by: ',',
      checkSelection: true,
      checkEscapeNewLine: true,
      checkWidth: true,
      widthPad: 2,
    });
    const th = h.textSize('AA').h;
    if (arr.length === 0) {
      return {
        data: ['0', '0', 'w', 'h', '0.001', '0.001', '0'],
        draw: [{ path: 'R 0 1 2 3 4 5 6' }],
        texts: [],
        images: [],
        embeds: [],
        containers: [],
        minW: 8,
        minH: th + 8,
      };
    }
    const data: string[] = [];
    const draw: DrawEntry[] = [];
    const texts: TextEntry[] = [];
    let sum = 0;
    let totalSum = 0;
    let dataEnd = 0;
    let prevx = '-w/2';
    for (const it of arr) {
      sum += it.widthRatio;
      totalSum += it.width;
      const fill = it.selected ? -1710619 : -1;
      const curx = `-w/2+w*${num(sum)}`;
      data.push(
        `${prevx}+${rad}`,
        '-h/2',
        `${prevx}+${RADK}`,
        '-h/2',
        prevx,
        `-h/2+${RADK}`,
        prevx,
        `-h/2+${rad}`,
        prevx,
        'h/2',
        curx,
        'h/2',
        curx,
        `-h/2+${rad}`,
        curx,
        `-h/2+${RADK}`,
        `${curx}-${RADK}`,
        '-h/2',
        `${curx}-${rad}`,
        '-h/2',
      );
      draw.push({
        path: `M ${seq(dataEnd, 2)} C ${seq(dataEnd + 2, 6)} L${seq(dataEnd + 8, 2)} L ${seq(dataEnd + 10, 2)} L ${seq(dataEnd + 12, 2)} C${seq(dataEnd + 14, 6)} Z`,
        style: { fillpaint: { color: fill, type: 2 } },
      });
      dataEnd += 20;
      data.push(`${prevx}+w*0.5*${num(it.widthRatio)}`, '0', `w*${num(it.widthRatio)}`, 'h', '0');
      texts.push({ location: indexList(dataEnd, 5), text: it.word });
      dataEnd += 5;
      prevx = curx;
    }
    return { data, draw, texts, images: [], embeds: [], containers: [], minW: totalSum + 8, minH: th + 8 };
  },
});

export default tabbar;
