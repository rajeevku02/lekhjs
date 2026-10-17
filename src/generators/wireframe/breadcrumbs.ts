// `wireframe/breadcrumbs` (spec 04 §5.3 row 5): hand port of `breadcrumbs.lua` (template
// `avabodh.wireframe.breadcrumbs`). Comma-separated crumbs with a chevron between each pair; the
// last crumb is black. A leading `-` is stripped (the script parses it and draws nothing for it).
import type { EmbedEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, lnum, num } from '../wireframe-lua';

const breadcrumbs: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/breadcrumbs',
  generate({ text }, h) {
    const data = ['-w/2', '-h/2', '-w/2', 'h/2'];
    const texts: TextEntry[] = [];
    const embeds: EmbedEntry[] = [];
    const arr = h.split(text, { by: ',', checkWidth: true, checkDisabled: true, widthPad: 12 });
    const ch = h.textSize('AA').h;
    const icw = ch * 0.7;
    let sum = 0;
    let dataEnd = 4;
    arr.forEach((it, i) => {
      const last = i === arr.length - 1;
      data.push(`-w/2+${lnum(sum, i === 0)}+${num(it.width / 2)}`, '0', num(it.width), 'h', '0');
      texts.push({
        ...(last ? { style: { textfill: { color: -16777216, type: 2 } } } : {}),
        location: indexList(dataEnd, 5),
        text: it.word,
      });
      dataEnd += 5;
      sum += it.width;
      if (!last) {
        data.push(`-w/2+${num(sum + icw / 2)}`, '0', num(icw), num(icw), '0');
        embeds.push({
          name: 'avabodh.wireframe.icon_chevron-right',
          location: indexList(dataEnd, 5),
          inheritstyle: true,
          mode: 'aspect',
        });
        dataEnd += 5;
      }
      sum += icw;
    });
    return { data, draw: [], texts, images: [], embeds, containers: [], minW: sum, minH: ch };
  },
});

export default breadcrumbs;
