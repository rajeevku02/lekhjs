// `wireframe/button` (spec 04 §5.3 row 6): hand port of `button.lua` (template
// `avabodh.wireframe.button`). A box, an optional menu triangle, and the text, or the text and an
// icon side by side. The leaked globals `style`, `halfIconSize` and `halfTw` are locals here
// (DR-GEN-09: each was assigned before every read, so nothing visible changes).
import type { DrawEntry, EmbedEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, num, str, truthy } from '../wireframe-lua';

const WHITE = -1;
const FOCUS = -10504995;

const button: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/button',
  generate({ params, text }, h) {
    const data = ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'];
    let embeds: EmbedEntry[] = [];
    let dataEnd = 8;
    let style;
    if (params['state'] === 'in focus') {
      style = { fillpaint: { color: FOCUS, type: 2 } };
    } else if (params['state'] === 'selected') {
      style = { fillpaint: { color: WHITE, type: 2 }, strokepaint: { color: FOCUS, type: 2 } };
    } else {
      style = { fillpaint: { color: WHITE, type: 2 } };
    }
    const draw: DrawEntry[] = [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style }];
    if (truthy(params['menu'])) {
      data.push('w/2 - 12', '-4', 'w/2 - 4', '-4', 'w/2-8', '3');
      dataEnd += 6;
      draw.push({
        path: 'M 8 9 L 10 11 L 12 13 Z',
        style: { fillpaint: { color: -436207616, type: 2 }, joinstyle: 1, capstyle: 3 },
      });
    }
    let { w: tw, h: th } = h.textSize(text);
    let texts: TextEntry[];
    const icon = params['icon'];
    if (truthy(icon) && icon !== '') {
      let halfIconSize: string;
      if (params['icon size'] === 'propotional to shape') {
        halfIconSize = 'h/3';
      } else {
        halfIconSize = num(h.textSize('AA').h * 0.5);
        ({ w: tw, h: th } = h.textSize(text));
      }
      tw = tw + 4;
      data.push(halfIconSize, '0', num(tw), 'h', '0');
      const textLocation = indexList(dataEnd, 5);
      dataEnd += 5;
      const halfTw = num(tw / 2);
      data.push(`-${halfTw}-2`, '0', `2*${halfIconSize}`, `2*${halfIconSize}`, '0');
      texts = [{ location: textLocation, style: { textalignhorizontal: 2 }, text }];
      embeds = [{ name: str(icon), location: indexList(dataEnd, 5), inheritstyle: true, mode: 'aspect' }];
    } else {
      texts = [{ location: 'default', text }];
    }
    return {
      data,
      draw,
      texts,
      images: [],
      embeds,
      containers: [],
      minW: tw + 16,
      minH: th + 4,
      disabled: params['state'] === 'disabled',
    };
  },
});

export default button;
