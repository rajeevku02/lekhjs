// `wireframe/tree` (spec 04 §5.3 row 31): hand port of `tree.lua` (template `avabodh.wireframe.tree`).
// One tree item per text line, indented by its leading spaces, with an optional `[icon]` (`+`, `-`,
// `>`, `v`, `folder`, `folder-open`, `file`, or any icon name); `*` highlights the item and `-`
// disables it. `border` false drops the box outline.
import type { DrawEntry, EmbedEntry, JsonObject, TextEntry, WireframeModule } from '../../template';
import { indexList, lnum, num, truthy } from '../wireframe-lua';

/** The script's icon shorthands; any other name is used as is (own keys only: `constructor` is a name). */
const ICONS: Readonly<Record<string, string>> = Object.freeze({
  '+': 'avabodh.wireframe.icon_plus-square-o',
  '-': 'avabodh.wireframe.icon_minus-square-o',
  '>': 'avabodh.wireframe.icon_caret-right',
  v: 'avabodh.wireframe.icon_caret-down',
  V: 'avabodh.wireframe.icon_caret-down',
  folder: 'avabodh.wireframe.icon_folder',
  'folder-open': 'avabodh.wireframe.icon_folder-open',
  file: 'avabodh.wireframe.icon_file',
});

function iconName(icon: string): string {
  return Object.hasOwn(ICONS, icon) ? (ICONS[icon] ?? icon) : icon;
}

const LEFT_PAD = 12;
const UP_PAD = 6;

const tree: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/tree',
  generate({ params, text }, h) {
    const data = ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'];
    const box: JsonObject = truthy(params['border'])
      ? { fillpaint: { color: -1, type: 2 } }
      : { fillpaint: { color: -1, type: 2 }, strokepaint: { strokewidth: 0 } };
    const draw: DrawEntry[] = [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: box }];
    const texts: TextEntry[] = [];
    const embeds: EmbedEntry[] = [];
    const arr = h.split(text, {
      by: '\n',
      checkHeight: true,
      heightPad: 8,
      checkDisabled: true,
      checkStartIcon: true,
      checkSelection: true,
      checkIndent: true,
    });
    const a = h.textSize('A');
    const gap = a.w * 0.5;
    const icw = a.h * 0.9;
    let sum = 0;
    let maxw = 0;
    let dataEnd = 8;
    let prevSum = UP_PAD;
    // `prevSum` is Lua's integer `upPad` until the first measured (float) height is added.
    let prevInt = true;
    for (const it of arr) {
      sum += it.height;
      const indentGap = it.indent * (icw + LEFT_PAD);
      const linew = LEFT_PAD + indentGap + icw + gap + it.width + LEFT_PAD;
      if (linew > maxw) maxw = linew;
      if (it.selected) {
        const top = `-h/2+${lnum(prevSum, prevInt)}`;
        const bottom = `-h/2+${num(prevSum + it.height)}`;
        data.push('-w/2', top, '-w/2', bottom, 'w/2', bottom, 'w/2', top);
        draw.push({
          path: `M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)} L ${indexList(dataEnd + 4, 2)} L ${indexList(dataEnd + 6, 2)}  Z`,
          style: { strokepaint: { color: 0, type: 2 }, fillpaint: { color: -10504995, type: 2 } },
        });
        dataEnd += 8;
      }
      const cy = `-h/2+${num(prevSum + it.height / 2)}`;
      data.push(num(indentGap + LEFT_PAD + icw + gap), cy, 'w', num(it.height), '0');
      let dc = 5;
      if (it.startIcon !== undefined) {
        data.push(`-w/2+${num(LEFT_PAD + indentGap + icw / 2)}`, cy, num(icw), num(icw), '0');
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
      prevSum = sum + UP_PAD;
      prevInt = false;
    }
    return { data, draw, texts, images: [], embeds, containers: [], minW: maxw, minH: sum + 2 * UP_PAD };
  },
});

export default tree;
