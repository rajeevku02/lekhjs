// `wireframe/ios_segmented` (spec 04 §5.3 row 17): hand port of `ios_segmented.lua` (template
// `avabodh.wireframe.iossegmented`). Comma-separated segments sized by their text, the outer two
// with rounded corners; the selected one (`*`) is filled blue with white text. No or one segment
// draws a single rounded rectangle.
import type { DrawEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, num } from '../wireframe-lua';

const RAD = 6;
const K = 0.4477152502;
const SELECTED = -16745729;

const iosSegmented: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/ios_segmented',
  generate({ text }, h) {
    const rads = num(RAD);
    const radk = num(RAD * K);
    let data: string[] = [
      `-w/2+${radk}`,
      '-h/2',
      '-w/2',
      `-h/2+${radk}`,
      '-w/2',
      `-h/2+${rads}`,
      '-w/2',
      `h/2-${rads}`,
      '-w/2',
      `h/2-${radk}`,
      `-w/2+${radk}`,
      'h/2',
      `-w/2+${rads}`,
      '-h/2',
      `-w/2+${rads}`,
      'h/2',
    ];
    const draw: DrawEntry[] = [];
    const texts: TextEntry[] = [];
    const arr = h.split(text, {
      by: ',',
      checkSelection: true,
      checkEscapeNewLine: true,
      checkWidth: true,
      widthPad: 2,
    });
    const ch = h.textSize('AA').h;
    let sum = 0;
    let totalSum = 0;
    let dataEnd = 16;
    let last = 12;
    let prevx = '-w/2';
    const out = (minW: number) => ({ data, draw, texts, images: [], embeds: [], containers: [], minW, minH: ch + 8 });
    if (arr.length <= 1) {
      data = ['0', '0', 'w', 'h', rads, rads, '0'];
      draw.push({ path: 'R 0 1 2 3 4 5 6' });
      const only = arr[0];
      if (only !== undefined) texts.push({ location: '0 1 2 3 6', text: only.word });
      return out(totalSum + 8);
    }
    arr.forEach((it, i) => {
      sum += it.widthRatio;
      totalSum += it.width;
      const fill = it.selected ? SELECTED : -1;
      const style = { fillpaint: { color: fill, type: 2 } };
      if (i === 0) {
        data.push(`-w/2+w*${num(sum)}`, '-h/2', `-w/2+w*${num(sum)}`, 'h/2');
        draw.push({ path: 'M 12 13 C 0 1 2 3 4 5 L 6 7 C 8 9 10 11 14 15 L 18 19 L 16 17 Z', style });
        dataEnd += 4;
      } else if (i === arr.length - 1) {
        data.push(
          `w/2-${rads}`,
          'h/2',
          `w/2-${radk}`,
          'h/2',
          'w/2',
          `h/2-${radk}`,
          'w/2',
          `h/2-${rads}`,
          'w/2',
          `-h/2 +${rads}`,
          'w/2',
          `-h/2+${radk}`,
          `w/2-${radk}`,
          '-h/2',
          `w/2-${rads}`,
          '-h/2',
        );
        const e = dataEnd;
        draw.push({
          path: `M ${indexList(last, 2)} L ${indexList(last + 2, 2)} L ${indexList(e, 2)} C ${indexList(e + 2, 6)} L ${indexList(e + 8, 2)} C ${indexList(e + 10, 6)} Z`,
          style,
        });
        dataEnd += 16;
      } else {
        data.push(`-w/2+w*${num(sum)}`, '-h/2', `-w/2+w*${num(sum)}`, 'h/2');
        draw.push({
          path: `M ${indexList(last, 2)} L ${indexList(last + 2, 2)} L ${indexList(dataEnd + 2, 2)} L ${indexList(dataEnd, 2)} Z`,
          style,
        });
        dataEnd += 4;
      }
      last = dataEnd - 4;
      data.push(`${prevx}+w*0.5*${num(it.widthRatio)}`, '0', `w*${num(it.widthRatio)}`, 'h', '0');
      prevx = `-w/2+w*${num(sum)}`;
      texts.push({
        location: indexList(dataEnd, 5),
        text: it.word,
        ...(it.selected ? { style: { textfill: { color: -1, type: 2 } } } : {}),
      });
      dataEnd += 5;
    });
    return out(totalSum + 8);
  },
});

export default iosSegmented;
