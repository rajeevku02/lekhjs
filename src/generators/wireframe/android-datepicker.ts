// `wireframe/android_datepicker` (spec 04 §5.3 row 3): hand port of `android_datepicker.lua`
// (template `avabodh.wireframe.androiddatepicker`). The year, a large "weekday, month year" header,
// a rule, the month grid with the selected day circled, and OK / CANCEL. The text is
// `year/month/day`.
//   - DR-GEN-05: a malformed text draws the default 2022/3/4 instead of raising or showing a stale
//     year (`wireframe-date.ts`).
//   - DR-GEN-06: month info is time-zone independent (the host's `monthInfo`).
//   - DR-GEN-07: Wednesday is 'Wed' (the script had 'Web').
//   - DR-GEN-08 (OQ-20): the header weekday is the selected day's, not the 1st's.
import type { DrawEntry, EmbedEntry, TextEntry, WireframeModule } from '../../template';
import { MONTHS, drawMonthGrid, parseWireframeDate } from '../wireframe-date';
import { indexList, num } from '../wireframe-lua';

const SHORT_MONTHS = Object.freeze([
  'Jan',
  'Feb',
  'March',
  'April',
  'May',
  'June',
  'July',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
]);
const WEEKDAYS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const action = () => ({ textfill: { color: -16776961, type: 2 } });

const androidDatepicker: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/android_datepicker',
  generate({ text }, h) {
    const data = ['-w/2', '-h/2', 'w/2', '-h/2', 'w/2', 'h/2', '-w/2', 'h/2'];
    const draw: DrawEntry[] = [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: { fillpaint: { color: -1, type: 2 } } }];
    const texts: TextEntry[] = [];
    const embeds: EmbedEntry[] = [];
    const date = parseWireframeDate(text, h);
    const weekday = (date.day - 1 + Math.trunc(date.d) - 1) % 7;

    const gap = 14;
    let yh = gap;
    const c = h.textSize('55');
    const cw = c.w + 2;
    const ch = c.h;

    let { w: tw, h: th } = h.textSize(date.ys);
    tw = tw + 2;
    data.push(`-w/2+${num(gap + tw / 2)}`, `-h/2+${num(yh + th / 2)}`, num(tw), num(th), '0');
    texts.push({ text: date.ys, location: '8 9 10 11 12', style: { textalignhorizontal: 2 } });
    yh = yh + th;

    let head = `${WEEKDAYS[weekday] ?? ''}, ${SHORT_MONTHS[date.m - 1] ?? ''} ${date.ys}`;
    ({ w: tw, h: th } = h.textSize(head));
    tw = (tw + 2) * 2;
    th = th * 2;
    data.push(`-w/2+${num(gap + tw / 2)}`, `-h/2+${num(yh + th / 2)}`, num(tw), num(th), '0');
    texts.push({ text: head, location: '13 14 15 16 17', style: { fontmultiplier: 2, textalignhorizontal: 2 } });
    yh = yh + th;

    data.push('-w/2', `-h/2+${num(yh + gap + gap)}`, 'w/2', 'd(19)');
    draw.push({ path: 'M 18 19 L 20 21' });
    yh = yh + 2 * gap;

    head = `${MONTHS[date.m - 1] ?? ''} ${date.ys}`;
    yh = yh + gap;
    data.push('0', `-h/2 + ${num(yh + ch / 2)}`, 'w', num(ch), '0');
    texts.push({ text: head, location: '22 23 24 25 26' });

    data.push(`-w/2+${num(gap)}+ ${num(cw / 2)}`, `-h/2+${num(yh + ch / 2)}`, num(ch), num(ch), '0');
    embeds.push({ name: 'avabodh.wireframe.icon_chevron-left', location: '27 28 29 30 31', mode: 'aspect' });
    data.push(`w/2-${num(gap)}-${num(cw / 2)}`, `-h/2+${num(yh + ch / 2)}`, num(ch), num(ch), '0');
    embeds.push({ name: 'avabodh.wireframe.icon_chevron-right', location: '32 33 34 35 36', mode: 'aspect' });
    yh = yh + ch + gap;

    const lhTop = yh + gap + ch;
    let dataEnd = drawMonthGrid({ data, draw, texts }, h, {
      date,
      dataEnd: 37,
      yh,
      lh: (n) => `(h-${num(lhTop)})/${String(n)}`,
      gap,
      cw,
    });

    const ok = h.textSize('OK');
    const okW = ok.w + 2;
    data.push(`w/2-${num(gap + okW / 2)}`, `h/2-${num(gap + ok.h / 2)}`, num(okW), num(ok.h), '0');
    texts.push({ location: indexList(dataEnd, 5), text: 'OK', style: action() });
    dataEnd += 5;

    const cancel = h.textSize('CANCEL');
    const cancelW = cancel.w + 2;
    data.push(
      `w/2-${num(gap + okW + gap + cancelW / 2)}`,
      `h/2-${num(gap + ok.h / 2)}`,
      num(cancelW),
      num(cancel.h),
      '0',
    );
    texts.push({ location: indexList(dataEnd, 5), text: 'CANCEL', style: action() });

    return { data, draw, texts, images: [], embeds, containers: [], minW: -1, minH: -1 };
  },
});

export default androidDatepicker;
