// `wireframe/datagrid` (spec 04 §5.3 row 11): hand port of `datagrid.lua` (template
// `avabodh.wireframe.datagrid`). One row per text line and one cell per comma; a line that is a
// size spec (`{10c, 20r, 30}`) ends the rows and sets the column widths and alignments (0 = fit
// the content; all 0 = share the width by content). Cells take the markup of `split`: `*` selects
// the row (filled; as the script, only a row that has a rule below it, so never the last), `-`
// disables, `[x]` / `[ ]` / `[-]` / `[o]` / `[()]` at the start draws that icon instead of the text,
// and `[v]` / `[^]` at the end draws a chevron.
//
// As the script: a size spec whose relative columns sum to 0 draws only the frame; `min row height`
// must be a number when there is a cell (Lua raised comparing a number with anything else).
// DR-GEN-09: the leaked globals `hprev` and `selDraw`, and the four helper functions the script
// defined as globals on every call, are locals (each was assigned before its read).
import type { DrawEntry, EmbedEntry, JsonObject, TextEntry, WireframeModule } from '../../template';
import { indexList, num, truthy } from '../wireframe-lua';

const SELECTED = -10504995;

interface Cell {
  readonly startIcon: string | undefined;
  readonly endIcon: string | undefined;
  readonly disabled: boolean;
  readonly word: string;
}

interface Column {
  size: number;
  align: 'left' | 'center' | 'right';
  relative: boolean;
  ratio: number;
}

function startIconName(icon: string | undefined): string | undefined {
  if (icon === undefined) return undefined;
  if (icon === '') return 'avabodh.wireframe.icon_square-o';
  if (icon === 'x' || icon === 'X') return 'avabodh.wireframe.icon_check-square-o';
  if (icon === '-') return 'avabodh.wireframe.icon_minus-square-o';
  if (icon === 'o' || icon === 'O') return 'avabodh.wireframe.icon_dot-circle-o';
  if (icon === '()' || icon === '( )') return 'avabodh.wireframe.icon_circle-o';
  return icon;
}

function endIconName(icon: string | undefined): string | undefined {
  if (icon === 'v' || icon === 'V') return 'avabodh.wireframe.icon_chevron-down';
  if (icon === '^') return 'avabodh.wireframe.icon_chevron-up';
  return undefined;
}

function line(d: number): DrawEntry {
  return { path: `M${String(d)} ${String(d + 1)} L ${String(d + 2)} ${String(d + 3)}` };
}

const datagrid: WireframeModule = Object.freeze<WireframeModule>({
  key: 'wireframe/datagrid',
  generate({ params, text }, h) {
    const lines = h.splitLines(text);
    const data = ['-w/2', '-h/2', '-w/2', 'h/2', 'w/2', 'h/2', 'w/2', '-h/2'];
    const rectStyle: JsonObject = truthy(params['border'])
      ? { fillpaint: { color: -1, type: 2 } }
      : { fillpaint: { color: -1, type: 2 }, strokepaint: { strokewidth: 0 } };
    const draw: DrawEntry[] = [{ path: 'M 0 1 L 2 3 L 4 5 L 6 7 Z', style: rectStyle }];
    const texts: TextEntry[] = [];
    const embeds: EmbedEntry[] = [];
    let dataEnd = 8;
    const pad = 4;
    const pad2 = 2;
    const charHeight = h.textSize('AA').h;
    const icw = charHeight * 0.9;
    const sw = h.strokeWidth();
    const items: Cell[][] = [];
    const cols: number[] = [];
    const rows: number[] = [];
    let ncols = 0;
    /** 1-based, as the script's row ids. */
    let selectedRow: number | null = null;
    let prevHLine = '-h/2';
    let szSpec: Column[] = [];
    const minParam = params['min row height'];
    const minHeight = truthy(minParam) ? minParam : 26;

    for (const ln of lines) {
      const sp = h.parseSizeSpec(ln);
      if (sp.parsed) {
        szSpec = sp.specs.map((s) => ({ size: s.size, align: s.align, relative: false, ratio: 0 }));
        break;
      }
      const row: Cell[] = [];
      items.push(row);
      const rid = items.length;
      const cells = h.split(ln, {
        by: ',',
        checkEscapeNewLine: true,
        checkHeight: true,
        checkWidth: true,
        heightPad: 1,
        widthPad: 2,
        checkDisabled: true,
        checkSelection: true,
        checkStartIcon: true,
        checkEndIcon: true,
      });
      if (cells.length > ncols) ncols = cells.length;
      cells.forEach((cell, c) => {
        row.push({ startIcon: cell.startIcon, endIcon: cell.endIcon, disabled: cell.disabled, word: cell.word });
        if (cell.selected) selectedRow = rid;
        if (typeof minHeight !== 'number') throw new TypeError('attempt to compare number with ' + typeof minHeight);
        const height = cell.height < minHeight ? minHeight : cell.height;
        let width = cell.width;
        if (cell.startIcon !== undefined) width += icw + pad2;
        if (cell.endIcon !== undefined) width += icw + pad2;
        const cw = cols[c];
        if (cw === undefined || cw < width) cols[c] = width;
        const rh = rows[rid - 1];
        if (rh === undefined || rh < height) rows[rid - 1] = height;
      });
      if (rows[rid - 1] === undefined) rows[rid - 1] = charHeight;
    }
    const nrows = items.length;
    const colWidth = (c: number) => cols[c] ?? 0;
    while (szSpec.length < ncols) szSpec.push({ size: 0, align: 'left', relative: false, ratio: 0 });
    szSpec.length = ncols;
    const allZero = szSpec.every((s) => s.size === 0);
    szSpec.forEach((s, c) => {
      if (allZero) {
        s.size = colWidth(c);
        s.relative = true;
      } else if (s.size === 0) {
        s.size = colWidth(c);
        s.relative = false;
      } else {
        s.relative = true;
      }
    });
    let csum = 0;
    let rsum = 0;
    for (const s of szSpec) {
      if (s.relative) rsum += s.size;
      else csum += s.size;
    }
    // The script's `goto done`: a relative column with nothing to share draws no rows.
    const drawRows = !(rsum === 0 && szSpec.some((s) => s.relative));
    for (const s of szSpec) s.ratio = s.relative ? s.size / rsum : 1;
    const wa = `w-${num(ncols * sw + 2 * ncols * pad + csum)}`;

    const generateItem = (rid: number, cid: number, cx0: string, cy: string, wd0: string, ht: string) => {
      const item = items[rid - 1]?.[cid - 1];
      const spec = szSpec[cid - 1];
      if (item === undefined || spec === undefined) return;
      let cx = cx0;
      let wd = wd0;
      const disabled = item.disabled ? { style: { disabled: true } } : {};
      const end = endIconName(item.endIcon);
      if (end !== undefined) {
        data.push(`${cx}+(${wd})/2-${num(icw / 2)}`, cy, num(icw), num(icw), '0');
        embeds.push({ ...disabled, name: end, location: indexList(dataEnd, 5), inheritstyle: true, mode: 'aspect' });
        dataEnd += 5;
        cx = `${cx}-${num((icw + pad2) / 2)}`;
        wd = `${wd}-${num(icw + pad2)}`;
      }
      const start = startIconName(item.startIcon);
      if (start !== undefined) {
        let x = cx;
        if (spec.align === 'right') x = `${cx}+(${wd})/2-${num(icw / 2)}`;
        else if (spec.align === 'left') x = `${cx}-(${wd})/2+${num(icw / 2)}`;
        data.push(x, cy, num(icw), num(icw), '0');
        embeds.push({ ...disabled, name: start, location: indexList(dataEnd, 5), inheritstyle: true, mode: 'aspect' });
        dataEnd += 5;
        return;
      }
      data.push(cx, cy, wd, ht, '0');
      const style: JsonObject = {
        strokewidth: 0,
        ...(item.disabled ? { disabled: true } : {}),
        ...(spec.align === 'left'
          ? { textalignhorizontal: 2 }
          : spec.align === 'right'
            ? { textalignhorizontal: 3 }
            : {}),
      };
      texts.push({ style, location: indexList(dataEnd, 5), text: item.word });
      dataEnd += 5;
    };

    const drawHLine = (at: string, rid: number) => {
      if (truthy(params['horizontal grid lines'])) {
        data.push('-w/2', at, 'w/2', at);
        draw.push(line(dataEnd));
        dataEnd += 4;
      }
      if (selectedRow === rid) {
        data.push('-w/2', prevHLine, '-w/2', at, 'w/2', at, 'w/2', prevHLine);
        let path = `M ${String(dataEnd)} ${String(dataEnd + 1)}`;
        for (let ct = 1; ct <= 3; ct++) path += ` L ${String(dataEnd + 2 * ct)} ${String(dataEnd + 2 * ct + 1)}`;
        // Right after the frame, under the rules and the cells.
        draw.splice(1, 0, { style: { strokewidth: 0, fillpaint: { color: SELECTED, type: 2 } }, path: `${path} Z` });
        dataEnd += 8;
      }
      prevHLine = at;
    };

    const drawVLine = (at: string) => {
      if (!truthy(params['vertical grid lines'])) return;
      data.push(at, '-h/2', at, 'h/2');
      draw.push(line(dataEnd));
      dataEnd += 4;
    };

    if (drawRows) {
      let vprev: number | null = null;
      for (let rid = 1; rid <= nrows; rid++) {
        const rowH = rows[rid - 1] ?? 0;
        const ht = num(rowH);
        let cy = vprev === null ? `-h/2 + ${num(sw / 2 + pad)}` : `-h/2 + ${num(sw / 2 + pad + vprev)}`;
        if (rid < nrows) drawHLine(`${cy}+${ht}+${num(pad + sw / 2)}`, rid);
        cy = `${cy}+${ht}/2`;
        let hprev: string | null = null;
        for (let cid = 1; cid <= ncols; cid++) {
          const spec = szSpec[cid - 1];
          if (spec === undefined) break;
          let cx = `-w/2 + ${num((cid - 0.5) * sw + (2 * (cid - 1) + 1) * pad)}`;
          if (hprev !== null) cx = `${cx}+${hprev}`;
          const wd = spec.relative ? `${num(spec.ratio)}*(${wa})` : num(spec.size);
          if (rid === 1 && cid < ncols) drawVLine(`${cx}+${wd}+${num(pad + sw / 2)}`);
          cx = `${cx}+${wd}/2`;
          hprev = hprev === null ? wd : `${hprev}+${wd}`;
          generateItem(rid, cid, cx, cy, wd, ht);
        }
        vprev = (vprev ?? 0) + sw + 2 * pad + rowH;
      }
    }

    let colsSum = 0;
    for (let c = 0; c < ncols; c++) colsSum += colWidth(c);
    let rowsSum = 0;
    for (const r of rows) rowsSum += r;
    return {
      data,
      draw,
      texts,
      images: [],
      embeds,
      containers: [],
      minW: colsSum + ncols * sw + 2 * ncols * pad,
      minH: rowsSum + nrows * sw + 2 * nrows * pad,
    };
  },
});

export default datagrid;
