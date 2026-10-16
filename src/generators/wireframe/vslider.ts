// `wireframe/vslider` (spec 04 §5.3 row 32): hand port of `vslider.lua` (template
// `avabodh.wireframe.vslider`). The vertical `slider`: a track, its filled part down to `position`
// (0..1, clamped; nil is 0) and a `circular`, `rectangular` or pointer indicator. The script
// returns -1 for the minimum size (no minimum).
import type { DrawEntry, WireframeModule } from '../../template';
import { num } from '../wireframe-lua';
import { clampPosition } from '../wireframe-lua-param';

const vslider: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/vslider',
  generate({ params }) {
    const pos = clampPosition(params['position']);
    const indicator = params['position indicator'];
    const yp = `-h/2 + w/2 + ${num(pos)}*(h-w)`;
    const data = ['0', '-h/2', '0', 'h/2', '0', yp];
    const draw: DrawEntry[] = [{ path: 'M 0 1 L 2 3' }, { path: 'M 4 5 L 2 3', style: { disabled: true } }];
    if (indicator === 'circular') {
      data.push('0', yp, 'w', 'w', '0');
      draw.push({ path: 'E 6 7 8 9 10' });
    } else if (indicator === 'rectangular') {
      data.push('0', yp, 'w', 'w/2', '3', '3', '0');
      draw.push({ path: 'R 6 7 8 9 10 11 12' });
    } else {
      data.push('-w/2', `${yp}-w/2`, '0', 'd(7)', 'w/2', 'd(7)+w/2', '0', 'd(7)+w', '-w/2', 'd(7)+w');
      draw.push({ path: 'M 6 7 L 8 9 L 10 11 L 12 13 L 14 15 Z' });
    }
    return { data, draw, texts: [], images: [], embeds: [], containers: [], minW: -1, minH: -1 };
  },
});

export default vslider;
