// `wireframe/calendar` (spec 04 §5.3 row 8): hand port of `calendar.lua` (template
// `avabodh.wireframe.calendar`). A month header between two chevrons, then the month grid with the
// selected day circled. The text is `year/month/day`.
//   - DR-GEN-05: a malformed text draws the default 2022/3/4 instead of raising or showing a stale
//     year (`wireframe-date.ts`).
//   - DR-GEN-06: month info is time-zone independent (the host's `monthInfo`).
//   - DR-GEN-09: the leaked global `head` is a local (assigned before its read: no visible change).
import type { DrawEntry, EmbedEntry, TextEntry, WireframeModule } from '../../template';
import { MONTHS, drawMonthGrid, parseWireframeDate } from '../wireframe-date';
import { num } from '../wireframe-lua';

const calendar: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/calendar',
  generate({ text }, h) {
    const data = ['-w/2', '-h/2', 'w/2', '-h/2', 'w/2', 'h/2', '-w/2', 'h/2'];
    const draw: DrawEntry[] = [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: { fillpaint: { color: -1, type: 2 } } }];
    const texts: TextEntry[] = [];
    const embeds: EmbedEntry[] = [];
    const date = parseWireframeDate(text, h);

    const gap = 14;
    let yh = gap;
    const c = h.textSize('55');
    const cw = c.w + 2;
    const ch = c.h;

    const head = `${MONTHS[date.m - 1] ?? ''} ${date.ys}`;
    data.push('0', `-h/2 + ${num(yh + ch / 2)}`, 'w', num(ch), '0');
    texts.push({ text: head, location: '8 9 10 11 12' });

    data.push(`-w/2+${num(gap)}+ ${num(cw / 2)}`, `-h/2+${num(yh + ch / 2)}`, num(ch), num(ch), '0');
    embeds.push({ name: 'avabodh.wireframe.icon_chevron-left', location: '13 14 15 16 17', mode: 'aspect' });
    data.push(`w/2-${num(gap)}-${num(cw / 2)}`, `-h/2+${num(yh + ch / 2)}`, num(ch), num(ch), '0');
    embeds.push({ name: 'avabodh.wireframe.icon_chevron-right', location: '18 19 20 21 22', mode: 'aspect' });
    yh = yh + ch + gap;

    const lhTop = yh + gap;
    drawMonthGrid({ data, draw, texts }, h, {
      date,
      dataEnd: 23,
      yh,
      lh: (n) => `(h-${num(lhTop)})/${String(n)}`,
      gap,
      cw,
    });

    return { data, draw, texts, images: [], embeds, containers: [], minW: -1, minH: -1 };
  },
});

export default calendar;
