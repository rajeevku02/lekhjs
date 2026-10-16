// `wireframe/radio_button` (spec 04 §5.3 row 25): hand port of `radio_button.lua` (template
// `avabodh.wireframe.radiobutton`). A circle (dotted when `checked`) and the text; the `state`
// parameter disables the whole shape. The minimum size is that of "AA", not of the text, as the
// script computes it.
import type { WireframeModule } from '../../template';
import { num, truthy } from '../wireframe-lua';

const radioButton: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/radio_button',
  generate({ params, text }, h) {
    const aa = h.textSize('AA');
    const th = (aa.h + 6) * 0.7;
    const data = [`-w/2+${num(th / 2)}`, '0', num(th), num(th), '0', num(aa.w), '0', 'w', 'h', '0'];
    const icon = truthy(params['checked']) ? 'avabodh.wireframe.icon_dot-circle-o' : 'avabodh.wireframe.icon_circle-o';
    return {
      data,
      draw: [],
      texts: [{ location: '5 6 7 8 9', text, style: { textalignhorizontal: 2 } }],
      images: [],
      embeds: [{ name: icon, location: '0 1 2 3 4', inheritstyle: true, mode: 'aspect' }],
      containers: [],
      minW: aa.w + 8,
      minH: th + 8,
      disabled: params['state'] === 'disabled',
    };
  },
});

export default radioButton;
