// `wireframe/tooltip` (spec 04 §5.3 row 30): hand port of `tooltip.lua` (template
// `avabodh.wireframe.tooltip`). A white rounded box (radius 8) with a 14-unit pointer on the side
// `pointer` names (`top` unless `left`, `right` or `bottom`), at `position` (0..1, clamped; nil is
// 0) along it, and the text in the box beside the pointer.
import type { WireframeModule } from '../../template';
import { BUBBLE_PATH, bubbleData } from '../wireframe-bubble';
import { int, num } from '../wireframe-lua';
import { clampPosition } from '../wireframe-lua-param';

const RAD = 8;
const PS = 14;

const tooltip: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/tooltip',
  generate({ params, text }) {
    const pos = clampPosition(params['position']);
    const pointer = params['pointer'];
    let textw = 'w';
    let texth = 'h';
    let textx = '0';
    let texty = '0';
    if (pointer === 'left' || pointer === 'right') {
      textw = `w-${int(PS)}`;
      textx = pointer === 'right' ? `-${num(PS / 2)}` : num(PS / 2);
    } else {
      texth = `h-${int(PS)}`;
      texty = pointer === 'bottom' ? `-${num(PS / 2)}` : num(PS / 2);
    }
    const data = bubbleData(pointer, pos, RAD, PS);
    data.push(textx, texty, textw, texth, '0');
    return {
      data,
      draw: [{ style: { fillpaint: { color: -1, type: 2 } }, path: BUBBLE_PATH }],
      texts: [{ location: ' 40 41 42 43 44', text }],
      images: [],
      embeds: [],
      containers: [],
      minW: PS + 2 * RAD,
      minH: PS + 2 * RAD,
    };
  },
});

export default tooltip;
