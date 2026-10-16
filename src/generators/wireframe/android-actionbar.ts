// `wireframe/android_actionbar` (spec 04 §5.3 row 2): hand port of `android_actionbar.lua` (template
// `avabodh.wireframe.androidactionbar`). A grey bar with an optional menu or back icon on the left,
// an optional overflow icon on the right, and the title.
import type { EmbedEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, num, truthy } from '../wireframe-lua';

const androidActionbar: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/android_actionbar',
  generate({ params, text }, h) {
    const data = ['-w/2', '-h/2', 'w/2', '-h/2', 'w/2', 'h/2', '-w/2', 'h/2'];
    const draw = [
      { path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: { fillpaint: { color: -2434342, type: 2 }, strokewidth: 0 } },
    ];
    const embeds: EmbedEntry[] = [];
    let dataEnd = 8;
    const icon = params['icon'];
    if (truthy(icon)) {
      data.push('-w/2 + 5 + h/4', '0', 'h/2', 'h/2', '0');
      const name = icon === 'back' ? 'avabodh.wireframe.icon_chevron-left' : 'avabodh.wireframe.icon_bars';
      embeds.push({ name, location: '8 9 10 11 12', mode: 'aspect' });
      dataEnd += 5;
    }
    if (truthy(params['overflow'])) {
      data.push('w/2 - 5 - h/4', '0', 'h/2', 'h/2', '0');
      embeds.push({ name: 'avabodh.wireframe.icon_ellipsis-v', mode: 'aspect', location: indexList(dataEnd, 5) });
      dataEnd += 5;
    }
    const sz = h.textSize(text);
    const tw = sz.w + 2;
    data.push(`-w/2 + 5 + h/2 + 10 + ${num(tw / 2)}`, '0', num(tw), 'h', '0');
    const texts: TextEntry[] = [{ style: { textalignhorizontal: 2 }, text, location: indexList(dataEnd, 5) }];
    return { data, draw, texts, images: [], embeds, containers: [], minW: tw + 32, minH: sz.h + 8 };
  },
});

export default androidActionbar;
