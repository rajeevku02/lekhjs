// `wireframe/ios_pagecontrol` (spec 04 §5.3 row 15): hand port of `ios_pagecontrol.lua` (template
// `avabodh.wireframe.iospagecontrol`, `interprettext: false`). A row of `number of pages` dots of
// `radius`; the dot of `current page` is dark. As the script had it, a current page below 0 (or
// unset) is 1, one past the last is the last, and 0 highlights none.
import type { DrawEntry, WireframeModule } from '../../template';
import { indexList, int, lnum, truthy, type ParamValue } from '../wireframe-lua';

const DOT = -3026479;
const CURRENT = -436207616;

/** A number parameter the script does arithmetic or comparisons on (anything else raised in Lua). */
function number(v: ParamValue, name: string): number {
  if (typeof v !== 'number')
    throw new TypeError(
      `'${name}': attempt to perform arithmetic on a ${v === null || v === undefined ? 'nil' : typeof v} value`,
    );
  return v;
}

const iosPagecontrol: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/ios_pagecontrol',
  generate({ params }) {
    const n = params['number of pages'];
    const curParam = params['current page'];
    const radius = number(params['radius'], 'radius');
    const diam = radius * 2;
    let cur = truthy(curParam) ? number(curParam, 'current page') : 1;
    if (cur < 0) cur = 1;
    if (cur >= number(n, 'number of pages')) cur = n as number;
    const pages = n as number;
    // An integral radius was pushed as a Lua integer, so its double is one too; the loop index is.
    const d = lnum(diam, Number.isInteger(radius));
    const data: string[] = [];
    const draw: DrawEntry[] = [];
    let dataEnd = 0;
    for (let i = 0; i <= pages - 1; i++) {
      const color = cur - 1 === i ? CURRENT : DOT;
      data.push(`-w/2+${int(2 * i)}*${d}+${d}/2`, '0', d, d, '0');
      draw.push({ path: `E ${indexList(dataEnd, 5)}`, style: { strokewidth: 0, fillpaint: { color, type: 2 } } });
      dataEnd += 5;
    }
    return { data, draw, texts: [], images: [], embeds: [], containers: [], minW: diam * 2 * pages, minH: diam };
  },
});

export default iosPagecontrol;
