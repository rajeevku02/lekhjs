// `wireframe/ios_picker` (spec 04 §5.3 row 16): hand port of `ios_picker.lua` (template
// `avabodh.wireframe.iospicker`). A wheel of 7 rows (text lines, comma-separated columns): the
// middle line of the text is row 4, between two lines, and the other rows are dimmed; missing rows
// are a blank. As the script had it, only the first 7 lines are read, and an empty line is a row
// of no cells with the bare line height.
//
// DR-GEN-04: the script assigned the global `selectedRow` from `cells[cid].selected`; the split
// does not check selection, so it was never set and never read. The port has no such state.
import type { DrawEntry, JsonObject, TextEntry, WireframeModule } from '../../template';
import { indexList, num, truthy } from '../wireframe-lua';

const MIDDLE = 4;

const iosPicker: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/ios_picker',
  generate({ params, text }, h) {
    const data: string[] = ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'];
    const rectStyle: JsonObject = truthy(params['border'])
      ? { fillpaint: { color: -1, type: 2 } }
      : { strokewidth: 0, fillpaint: { color: -1, type: 2 } };
    const draw: DrawEntry[] = [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: rectStyle }];
    const texts: TextEntry[] = [];
    let dataEnd = 8;
    const charHeight = h.textSize('AA').h;

    const lns = h.splitLines(text).slice(0, 7);
    // lines[0..6] are the script's lines[1..7]; lns[k-1] is its lns[k].
    const at = (k: number): string => (k >= 1 && k <= lns.length ? (lns[k - 1] ?? ' ') : ' ');
    const mid = Math.floor(lns.length / 2) + 1;
    const lines: string[] = [];
    for (let i = 0; i <= 3; i++) lines[MIDDLE - 1 - i] = at(mid - i);
    for (let i = 0; i <= 2; i++) lines[MIDDLE + i] = at(mid + 1 + i);

    const items: string[][] = [];
    const cols: number[] = [];
    const rows: number[] = [];
    let ncols = 0;
    lines.forEach((line, r) => {
      const cells = h.split(line, { by: ',', checkHeight: true, checkWidth: true, heightPad: 8, widthPad: 12 });
      if (cells.length > ncols) ncols = cells.length;
      const row: string[] = [];
      items.push(row);
      cells.forEach((cell, c) => {
        row.push(cell.word);
        const cw = cols[c];
        if (cw === undefined || cw < cell.width) cols[c] = cell.width;
        const rh = rows[r];
        if (rh === undefined || rh < cell.height) rows[r] = cell.height;
      });
      if (rows[r] === undefined) rows[r] = charHeight;
    });

    let colsSum = 0;
    let rowsSum = 0;
    for (let c = 0; c < ncols; c++) colsSum += cols[c] ?? 0;
    for (const rh of rows) rowsSum += rh;
    const topx = num(-colsSum / 2);
    const topy = num(-rowsSum / 2);
    let vsum = 0;
    rows.forEach((rh, r) => {
      const ht = num(rh);
      const cy = `${topy}+${num(vsum + rh / 2)}`;
      let hsum = 0;
      for (let c = 0; c < ncols; c++) {
        const cw = cols[c] ?? 0;
        const word = items[r]?.[c];
        if (word !== undefined) {
          data.push(`${topx}+${num(hsum + cw / 2)}`, cy, num(cw), ht, '0');
          texts.push({
            style: r + 1 !== MIDDLE ? { strokewidth: 0, disabled: true } : { strokewidth: 0 },
            location: indexList(dataEnd, 5),
            text: word,
          });
          dataEnd += 5;
        }
        hsum += cw;
      }
      if (r + 1 === MIDDLE) {
        data.push('-w/2', `${topy}+${num(vsum)}`, 'w/2', `${topy}+${num(vsum)}`);
        data.push('-w/2', `${topy}+${num(vsum + rh)}`, 'w/2', `${topy}+${num(vsum + rh)}`);
        draw.push({ path: `M ${indexList(dataEnd, 2)} L ${indexList(dataEnd + 2, 2)}` });
        draw.push({ path: `M ${indexList(dataEnd + 4, 2)} L ${indexList(dataEnd + 6, 2)}` });
        dataEnd += 8;
      }
      vsum += rh;
    });
    return { data, draw, texts, images: [], embeds: [], containers: [], minW: colsSum, minH: rowsSum };
  },
});

export default iosPicker;
