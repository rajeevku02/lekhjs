// `wireframe/radiobutton_group` (spec 04 §5.3 row 26): hand port of `radiobutton_group.lua`
// (template `avabodh.wireframe.radiobuttongroup`). One row per text line; `[ ]` (or `[]`, `[()]`,
// `[( )]`), `[o]` and `[-]` draw an empty, selected or minus circle (any other `[name]` draws that
// icon), `-` disables the row, and a line without brackets is plain text.
import type { EmbedEntry, TextEntry, WireframeModule } from '../../template';
import { indexList, num } from '../wireframe-lua';

function iconName(icon: string): string {
  if (icon === '' || icon === '()' || icon === '( )') return 'avabodh.wireframe.icon_circle-o';
  if (icon === 'o' || icon === 'O') return 'avabodh.wireframe.icon_dot-circle-o';
  if (icon === '-') return 'avabodh.wireframe.icon_minus-circle';
  return icon;
}

const radiobuttonGroup: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/radiobutton_group',
  generate({ text }, h) {
    const arr = h.split(text, { by: '\n', checkHeight: true, heightPad: 6, checkDisabled: true, checkStartIcon: true });
    const data: string[] = [];
    const texts: TextEntry[] = [];
    const embeds: EmbedEntry[] = [];
    let sum = 0;
    let maxw = 0;
    let prevSum = 0;
    let dataEnd = 0;
    const aa = h.textSize('AA');
    const gap = aa.w;
    const icw = (aa.h + 6) * 0.7;
    for (const it of arr) {
      if (it.width > maxw) maxw = it.width;
      sum += it.height;
      const cy = `-h/2+${num(prevSum + it.height / 2)}`;
      let dc: number;
      if (it.startIcon === undefined) {
        data.push('0', cy, 'w', num(it.height), '0');
        dc = 5;
      } else {
        data.push(num(gap), cy, 'w', num(it.height), '0');
        data.push(`-w/2+${num(icw / 2)}`, cy, num(icw), num(icw), '0');
        dc = 10;
        embeds.push({
          ...(it.disabled ? { style: { disabled: true } } : {}),
          name: iconName(it.startIcon),
          location: indexList(dataEnd + 5, 5),
          inheritstyle: true,
          mode: 'aspect',
        });
      }
      texts.push({
        style: it.disabled ? { textalignhorizontal: 2, disabled: true } : { textalignhorizontal: 2 },
        location: indexList(dataEnd, 5),
        text: it.word,
      });
      dataEnd += dc;
      prevSum = sum;
    }
    return { data, draw: [], texts, images: [], embeds, containers: [], minW: maxw + 8, minH: sum + 8 };
  },
});

export default radiobuttonGroup;
