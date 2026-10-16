// `wireframe/checkbox` (spec 04 §5.3 row 9): hand port of `checkbox.lua` (template
// `avabodh.wireframe.checkbox`). A square (checked or not) and the text; the `state` parameter
// disables the whole shape.
import type { WireframeModule } from '../../template';
import { num, truthy } from '../wireframe-lua';

const checkbox: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/checkbox',
  generate({ params, text }, h) {
    const aa = h.textSize('AA');
    const th = (aa.h + 6) * 0.7;
    const half = num(th / 2);
    const data = [`-w/2+${half}`, '0', num(th), num(th), '0', num(aa.w), '0', 'w', 'h', '0'];
    const icon = truthy(params['checked'])
      ? 'avabodh.wireframe.icon_check-square-o'
      : 'avabodh.wireframe.icon_square-o';
    const sz = h.textSize(text);
    return {
      data,
      draw: [],
      texts: [{ location: '5 6 7 8 9', text, style: { textalignhorizontal: 2 } }],
      images: [],
      embeds: [{ name: icon, location: '0 1 2 3 4', inheritstyle: true, mode: 'aspect' }],
      containers: [],
      minW: sz.w + 8,
      minH: sz.h + 8,
      disabled: params['state'] === 'disabled',
    };
  },
});

export default checkbox;
