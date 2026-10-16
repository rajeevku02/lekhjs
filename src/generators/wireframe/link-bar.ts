// `wireframe/link_bar` (spec 04 §5.3 row 18): hand port of `link_bar.lua` (template
// `avabodh.wireframe.linkbar`). Comma-separated links side by side, sized by their text, with a
// short vertical line between two when `separator line` is set. As the script had it, `-` is
// parsed (and removed from the text) but not drawn differently.
import type { DrawEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, num, truthy } from '../wireframe-lua';

const linkBar: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/link_bar',
  generate({ params, text }, h) {
    const data: string[] = ['-w/2', '-h/2', '-w/2', 'h/2'];
    const draw: DrawEntry[] = [];
    const texts: TextEntry[] = [];
    const arr = h.split(text, { by: ',', checkWidth: true, checkDisabled: true, widthPad: 18 });
    const ch = h.textSize('AA').h;
    let sum = 0;
    let dataEnd = 4;
    arr.forEach((it, i) => {
      data.push(`-w/2+${num(sum)}+${num(it.width / 2)}`, '0', num(it.width), 'h', '0');
      texts.push({ location: indexList(dataEnd, 5), text: it.word });
      dataEnd += 5;
      sum += it.width;
      if (i < arr.length - 1 && truthy(params['separator line'])) {
        data.push(`-w/2+${num(sum)}`, `-${num(ch / 2)}`, `-w/2+${num(sum)}`, num(ch / 2));
        draw.push({ path: `M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)}` });
        dataEnd += 4;
      }
    });
    return { data, draw, texts, images: [], embeds: [], containers: [], minW: sum, minH: ch };
  },
});

export default linkBar;
