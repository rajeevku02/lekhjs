// `wireframe/slider` (spec 04 §5.3 row 27): hand port of `slider.lua`, used by two templates,
// `avabodh.wireframe.slider` and `avabodh.wireframe.iosslider`. A horizontal track, its filled part
// up to `position` (0..1, clamped; nil is 0) and an indicator there: `circular`, `rectangular`, or
// otherwise a pointer. The script returns -1 for the minimum size (no minimum).
import type { DrawEntry, WireframeModule } from '../../template';
import { num } from '../wireframe-lua';
import { clampPosition } from '../wireframe-lua-param';

const slider: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/slider',
  generate({ params }) {
    const pos = clampPosition(params['position']);
    const indicator = params['position indicator'];
    const xp = `-w/2 + h/2 + ${num(pos)}*(w-h)`;
    const data = ['-w/2', '0', 'w/2', '0', xp, '0'];
    const draw: DrawEntry[] = [{ path: 'M 0 1 L 2 3' }, { path: 'M 4 5 L 2 3', style: { disabled: true } }];
    if (indicator === 'circular') {
      data.push(xp, '0', 'h', 'h', '0');
      draw.push({ path: 'E 6 7 8 9 10' });
    } else if (indicator === 'rectangular') {
      data.push(xp, '0', 'h/2', 'h', '3', '3', '0');
      draw.push({ path: 'R 6 7 8 9 10 11 12' });
    } else {
      data.push(`${xp}-h/2`, '-h/2', 'd(6)', '0', xp, 'h/2', 'd(6)+h', '0', 'd(12)', '-h/2');
      draw.push({ path: 'M 6 7 L 8 9 L 10 11 L 12 13 L 14 15 Z' });
    }
    return { data, draw, texts: [], images: [], embeds: [], containers: [], minW: -1, minH: -1 };
  },
});

export default slider;
