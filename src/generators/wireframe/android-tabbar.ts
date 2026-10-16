// `wireframe/android_tabbar` (spec 04 §5.3 row 4): hand port of `android_tabbar.lua` (template
// `avabodh.wireframe.androidtabbar`). Comma-separated tabs sized by their text; the selected tab
// (`*`) is underlined.
import type { DrawEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, num } from '../wireframe-lua';

const androidTabbar: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/android_tabbar',
  generate({ text }, h) {
    const data = ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'];
    const draw: DrawEntry[] = [
      { path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: { strokewidth: 0, fillpaint: { color: -1644826, type: 2 } } },
    ];
    const texts: TextEntry[] = [];
    const arr = h.split(text, {
      by: ',',
      checkSelection: true,
      checkEscapeNewLine: true,
      checkWidth: true,
      widthPad: 2,
    });
    const th = h.textSize('AA').h;
    let sum = 0;
    let totalSum = 0;
    let dataEnd = 8;
    const sw = h.strokeWidth();
    let prevx = '-w/2';
    for (const it of arr) {
      totalSum += it.width;
      sum += it.widthRatio;
      data.push(`${prevx}+w*0.5*${num(it.widthRatio)}`, '0', `w*${num(it.widthRatio)}`, 'h', '0');
      texts.push({ location: indexList(dataEnd, 5), text: it.word });
      dataEnd += 5;
      if (it.selected) {
        const wd = it.width + 6;
        const y = `h/2-${num(sw)}`;
        const c = `${prevx}+w*0.5*${num(it.widthRatio)}`;
        data.push(`${c}-${num(wd / 2)}`, y, `${c}+${num(wd / 2)}`, y);
        draw.push({
          path: `M ${String(dataEnd)} ${String(dataEnd + 1)} L ${String(dataEnd + 2)} ${String(dataEnd + 3)}`,
        });
        dataEnd += 4;
      }
      prevx = `-w/2+w*${num(sum)}`;
    }
    return { data, draw, texts, images: [], embeds: [], containers: [], minW: totalSum + 8, minH: th + 8 };
  },
});

export default androidTabbar;
