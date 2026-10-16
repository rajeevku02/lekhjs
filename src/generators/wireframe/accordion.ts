// `wireframe/accordion` (spec 04 §5.3 row 1): hand port of `accordion.lua` (template
// `avabodh.wireframe.accordion`). One header per text line; the lines up to the first selected one
// stack from the top, the selected header is filled, and the rest stack from the bottom. As the
// script, the bottom loop measures `maxw` from the first remaining line, not the line it draws.
import type { DrawEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, num } from '../wireframe-lua';

const SELECTED = -10504995;

function line(dataEnd: number): DrawEntry {
  return { path: `M ${String(dataEnd)} ${String(dataEnd + 1)} L ${String(dataEnd + 2)} ${String(dataEnd + 3)}` };
}

const accordion: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/accordion',
  generate({ text }, h) {
    const data = ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'];
    const draw: DrawEntry[] = [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: { fillpaint: { color: -1, type: 2 } } }];
    const texts: TextEntry[] = [];
    const arr = h.split(text, {
      by: '\n',
      checkSelection: true,
      checkHeight: true,
      checkWidth: true,
      heightPad: 12,
      checkDisabled: true,
    });
    let dataEnd = 8;
    let id = 0;
    let prevy = '-h/2';
    let sum = 0;
    let maxw = 0;
    while (id < arr.length) {
      const it = arr[id];
      if (it === undefined) break;
      if (it.width > maxw) maxw = it.width;
      data.push('0', `${prevy}+${num(it.height / 2)}`, 'w', num(it.height), '0');
      texts.push({
        ...(it.disabled ? { style: { disabled: true } } : {}),
        text: it.word,
        location: indexList(dataEnd, 5),
      });
      dataEnd += 5;
      if (it.selected) {
        const nexty = `${prevy}+${num(it.height)}`;
        data.push('-w/2', prevy, '-w/2', nexty, 'w/2', nexty, 'w/2', prevy);
        let path = `M ${String(dataEnd)} ${String(dataEnd + 1)}`;
        for (let i = 1; i <= 3; i++) path += ` L ${String(dataEnd + 2 * i)} ${String(dataEnd + 2 * i + 1)}`;
        draw.push({ style: { fillpaint: { color: SELECTED, type: 2 } }, path: `${path} Z` });
        dataEnd += 8;
      }
      sum += it.height;
      prevy = `-h/2 + ${num(sum)}`;
      data.push('-w/2', prevy, 'w/2', prevy);
      draw.push(line(dataEnd));
      dataEnd += 4;
      id++;
      if (it.selected) break;
    }
    prevy = 'h/2';
    let totalSum = sum;
    sum = 0;
    for (let endId = arr.length - 1; endId >= id; endId--) {
      const first = arr[id];
      const it = arr[endId];
      if (first === undefined || it === undefined) break;
      if (first.width > maxw) maxw = first.width;
      data.push('0', `${prevy}-${num(it.height / 2)}`, 'w', num(it.height), '0');
      texts.push({
        ...(it.disabled ? { style: { disabled: true } } : {}),
        text: it.word,
        location: indexList(dataEnd, 5),
      });
      dataEnd += 5;
      sum += it.height;
      prevy = `h/2 - ${num(sum)}`;
      data.push('-w/2', prevy, 'w/2', prevy);
      draw.push(line(dataEnd));
      dataEnd += 4;
    }
    totalSum += sum;
    return { data, draw, texts, images: [], embeds: [], containers: [], minW: maxw + 8, minH: totalSum + 12 };
  },
});

export default accordion;
