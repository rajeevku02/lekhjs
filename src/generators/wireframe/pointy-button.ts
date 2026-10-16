// `wireframe/pointy_button` (spec 04 §5.3 row 23): hand port of `pointy_button.lua` (template
// `avabodh.wireframe.pointybutton`). A white box with an angle icon at the end the `pointer`
// parameter names (`right`; anything else is left) and the text beside it.
import type { WireframeModule } from '../../template';

const pointyButton: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/pointy_button',
  generate({ params, text }, h) {
    const sz = h.textSize(text);
    const data = ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'];
    let name: string;
    if (params['pointer'] === 'right') {
      data.push('w/2-h*0.3', '0', 'h*0.6', 'h*0.6', '0', '-h*0.3', '0', 'w-h*0.6', 'h', '0');
      name = 'avabodh.wireframe.icon_angle-right';
    } else {
      data.push('-w/2+h*0.3', '0', 'h*0.6', 'h*0.6', '0', 'h*0.3', '0', 'w-h*0.6', 'h', '0');
      name = 'avabodh.wireframe.icon_angle-left';
    }
    return {
      data,
      draw: [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: { fillpaint: { color: -1, type: 2 }, strokewidth: 0 } }],
      texts: [{ location: '13 14 15 16 17', text }],
      images: [],
      embeds: [{ location: '8 9 10 11 12', name, inheritstyle: true, mode: 'aspect' }],
      containers: [],
      minW: sz.w + 8,
      minH: sz.h + 8,
    };
  },
});

export default pointyButton;
