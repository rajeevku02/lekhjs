// `wireframe/ios_actionsheet` (spec 04 §5.3 row 12): hand port of `ios_actionsheet.lua` (template
// `avabodh.wireframe.iosactionsheet`). One button per text line: the last line is a separate
// button at the bottom (the cancel button), the others share a rounded box with separator lines.
// One line draws a single filled rectangle whose text is the whole shape text, as the script did.
import type { DrawEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, int, num } from '../wireframe-lua';

const GAP = 8;

const iosActionsheet: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/ios_actionsheet',
  generate({ text }, h) {
    const arr = h.splitLines(text);
    const out = { images: [], embeds: [], containers: [], minW: -1, minH: -1 };
    if (arr.length === 0) {
      return { ...out, data: ['0', '0', 'w', 'h', '1', '1', '0'], draw: [{ path: 'R 0 1 2 3 4 5 6' }], texts: [] };
    }
    if (arr.length === 1) {
      return {
        ...out,
        data: ['0', '0', 'w', 'h', '1', '1', '0'],
        draw: [{ path: 'R 0 1 2 3 4 5 6', style: { fillpaint: { color: -1, type: 2 } } }],
        texts: [{ location: '0 1 2 3 6', text }],
      };
    }
    const n = arr.length;
    const ht = `(h-${int(GAP)})/${int(n)}`;
    const data: string[] = [
      '0',
      `-h/2+${int(n - 1)}*0.5*${ht}`,
      'w',
      `${int(n - 1)}*${ht}`,
      '6',
      '6',
      '0',
      '0',
      `h/2-0.5*${ht}`,
      'w',
      ht,
      '6',
      '6',
      '0',
    ];
    const draw: DrawEntry[] = [
      { path: 'R 0 1 2 3 4 5 6', style: { strokewidth: 0.4 } },
      { path: 'R 7 8 9 10 11 12 13', style: { strokewidth: 0.4 } },
    ];
    const texts: TextEntry[] = [{ location: '7 8 9 10 13', text: arr[n - 1] ?? '' }];
    let dataEnd = 14;
    for (let id = 1; id <= n - 1; id++) {
      data.push('0', `-h/2+${num(id - 1 + 0.5)}*${ht}`, 'w', ht, '0');
      texts.push({ location: indexList(dataEnd, 5), text: arr[id - 1] ?? '' });
      dataEnd += 5;
      if (id < n - 1) {
        data.push('-w/2', `-h/2+${int(id)}*${ht}`, 'w/2', `-h/2+${int(id)}*${ht}`);
        draw.push({ style: { disabled: true }, path: `M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)}` });
        dataEnd += 4;
      }
    }
    return { ...out, data, draw, texts };
  },
});

export default iosActionsheet;
