// `wireframe/popover` (spec 04 §5.3 row 24): hand port of `popover.lua` (template
// `avabodh.wireframe.iospopover`). A translucent rounded box (radius 15) with a 20-unit pointer on
// the side `pointer` names (`top` by default), at `position` (0..1, clamped; nil is 0) along it.
// The region inside the box is a container. The script reads no text.
import type { WireframeModule } from '../../template';
import { BUBBLE_PATH, bubbleData } from '../wireframe-bubble';
import { clampPosition } from '../wireframe-lua-param';

const RAD = 15;
const PS = 20;

const popover: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/popover',
  generate({ params }) {
    const pos = clampPosition(params['position']);
    return {
      data: bubbleData(params['pointer'], pos, RAD, PS),
      draw: [{ style: { fillpaint: { color: -637534209, type: 2 } }, path: BUBBLE_PATH }],
      texts: [],
      images: [],
      embeds: [],
      containers: ['M 0 1 L 8 9 L 14 15 L 16 17 L 22 23 L 24 25 L 30 31 L 32 33 L 38 39 Z'],
      minW: PS + 2 * RAD,
      minH: PS + 2 * RAD,
    };
  },
});

export default popover;
