// `TableGenerator`, the `table-v1` native generator (spec 04 §6; hand port of
// `L/shapegen/CppShapeGenerator.cpp:777-1360`): a grid of rows and columns with an optional table
// header and column header, cells of text or one container, and vertex editing that resizes
// columns and rows by dragging their edges (the sizes are kept as hidden `col<i>` / `row<i>`
// parameters).
//
// Parameters: `nrows`, `ncols`, `row<i>`, `col<i>` (relative sizes), `show_row_lines`,
// `show_col_lines`, `table_header`, `col_header`, `line_below_header`, `cell_type`
// (`text` / `container`), `header_orientation` (`Normal` / anything else: along the lane),
// `default_table_header`, `default_col_header`.
//
// Like C++, the layout state (`nrows`, the sizes, the header flags) lives on the generator and
// survives a generation whose template lacks the parameter; a clone starts from the defaults and
// has no state until it generates. Cell texts are matched to their row and column, so editing the
// table keeps them; texts no cell claims are dropped. Unlike the BPMN generators, it keeps the
// stored `embedrefs` (C++ has no `updateEmbedRefs` override).
import type {
  DataStore,
  GeneratorBehavior,
  GeneratorContext,
  InterestingPoint,
  JsonObject,
  ShapeTemplate,
} from '../../template';
import { ParamEditorType, PathInfo, ShapeGenerator, TemplateParam, TextInfo } from '../../template';
import { Point, PointType, rotate } from '../../geometry';
import { FontWeight, Style, TextAlignHorizontal, TextAlignVertical } from '../../style';
import { intVal, nativeFieldsOf, nativeJson, sf, si, sv, type NativeFields } from './native-common';

/** C++ `delatDiff`: the closest two column (or row) edges may come while dragging. */
const MIN_GAP = 8;

/** The row (column) a table-header (column-header) text is matched by. */
const TABLE_HEADER_ROW = -2;
const COL_HEADER_ROW = -1;

export class TableGenerator extends ShapeGenerator {
  readonly behavior: GeneratorBehavior = 'onParamChange';
  private readonly fields_: NativeFields;

  private data_: string[] = [];
  private paths_: PathInfo[] = [];
  private textInfos_: TextInfo[] = [];
  private containers_: string[] = [];

  private topy1_ = 0;
  private topy2_ = 0;
  private tabHeaderHeightIdx_ = -1;
  private colHeaderHeightIdx_ = -1;

  private nrows_ = 1;
  private ncols_ = 1;
  private rowSum_ = 0;
  private colSum_ = 0;

  private showRowLines_ = true;
  private showColLines_ = true;
  private hasTableHeader_ = false;
  private hasColHeader_ = false;
  private showLineBelowHeader_ = true;

  private rowSizes_: number[] = [];
  private colSizes_: number[] = [];
  private colPoints_: number[] = [];
  private rowPoints_: number[] = [];

  private cellType_ = 'text';
  private headerOrientation_ = 'Normal';
  private tableHeaderText_ = 'Table';
  /** C++'s default, spelling included. */
  private colHeaderText_ = 'Colum';

  constructor(fields: NativeFields) {
    super();
    this.fields_ = { ...fields };
  }

  static fromJson(gen: JsonObject): TableGenerator {
    return new TableGenerator(nativeFieldsOf('table-v1', gen));
  }

  interpretText(): boolean {
    return this.fields_.interpretText;
  }

  interpretedText(): string {
    return this.fields_.text;
  }

  override setInterpretedText(text: string): void {
    this.fields_.text = text;
  }

  embedReferences(): readonly string[] {
    return this.fields_.embedRefs;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- C++ `savedw_`/`savedh_` are never set by a native generator
  setDimension(_ds: DataStore): void {
    /* no minimum size */
  }

  /** C++ `CppShapeGenerator::clone`: the block's fields only, no layout state. */
  clone(): TableGenerator {
    return new TableGenerator(this.fields_);
  }

  toJSON(): JsonObject {
    return nativeJson(this.fields_);
  }

  override canDoVertexEditing(): boolean {
    return true;
  }

  override doesPartialTextManipulation(): boolean {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the contract's signature
  generate(t: ShapeTemplate, _ctx: GeneratorContext): void {
    this.data_ = [];
    this.paths_ = [];
    this.containers_ = [];
    this.textInfos_ = [];
    this.rowSizes_ = [];
    this.colSizes_ = [];
    this.rowPoints_ = [];
    this.colPoints_ = [];
    this.tabHeaderHeightIdx_ = -1;
    this.colHeaderHeightIdx_ = -1;

    const vals = new Map<string, number>();
    for (const p of t.params) {
      const n = p.name;
      if (n === 'nrows') {
        this.nrows_ = intVal(p);
        if (this.nrows_ <= 0) this.nrows_ = 1;
      } else if (n === 'ncols') {
        this.ncols_ = intVal(p);
        if (this.ncols_ <= 0) this.ncols_ = 1;
      } else if (n === 'header_orientation') this.headerOrientation_ = p.stringValue();
      else if (n === 'cell_type') this.cellType_ = p.stringValue();
      else if (n === 'line_below_header') this.showLineBelowHeader_ = p.value === true;
      else if (n === 'col_header') this.hasColHeader_ = p.value === true;
      else if (n === 'table_header') this.hasTableHeader_ = p.value === true;
      else if (n === 'show_row_lines') this.showRowLines_ = p.value === true;
      else if (n === 'show_col_lines') this.showColLines_ = p.value === true;
      else if (n === 'default_table_header') this.tableHeaderText_ = p.stringValue();
      else if (n === 'default_col_header') this.colHeaderText_ = p.stringValue();
      else if ((n.startsWith('row') || n.startsWith('col')) && n.length > 3 && typeof p.value === 'number') {
        vals.set(n, p.value);
      }
    }

    this.rowSizes_ = sizesFrom(vals, 'row', this.nrows_);
    this.colSizes_ = sizesFrom(vals, 'col', this.ncols_);

    // The `row<i>` / `col<i>` parameters past the table's rows and columns go.
    for (const name of [...vals.keys()].sort()) {
      const i = t.params.findIndex((p) => p.name === name);
      if (i >= 0) t.params.splice(i, 1);
    }

    this.generateOutline(t);
    this.generateCells(t);
    this.genCellTextOrContainer(t);

    t.dataExpStrs = this.data_;
    t.pathData = this.paths_;
    t.containerPaths = this.containers_;
    t.textData = this.textInfos_;
  }

  private newPath(drawCmds: string): void {
    this.paths_.push(new PathInfo(drawCmds, new Style()));
  }

  /** C++ `generateOutline`: the box, or the table-header band and the box below it. */
  private generateOutline(t: ShapeTemplate): void {
    const data = this.data_;
    if (!this.hasTableHeader_) {
      const len = data.length;
      data.push('-w/2', '-h/2', 'w/2', '-h/2', 'w/2', 'h/2', '-w/2', 'h/2');
      this.newPath(
        `M ${sv([len, len + 1])} L ${sv([len + 2, len + 3])} L ${sv([len + 4, len + 5])} L ${sv([len + 6, len + 7])} Z`,
      );
      this.topy1_ = len + 1;
      return;
    }
    const ti = this.makeText(t, TABLE_HEADER_ROW, 0, this.tableHeaderText_);
    ti.style.setFontWeight(FontWeight.Bold);
    ti.style.setTextAlignVertical(TextAlignVertical.Center);
    ti.style.setTextAlignHorizontal(TextAlignHorizontal.Center);
    ti.style.addNonOverridables('textAlignHorizontal');
    ti.style.addNonOverridables('fontWeight');
    ti.style.addNonOverridables('textAlignVertical');

    const len = data.length;
    // C++ names the header's height `d(0)`: the outline comes first, so `len` is 0 here.
    data.push('th(0) + sw(-1) + 8', '0', `-h/2+d(${si(len)})/2`, 'w', 'd(0)', '0');
    this.tabHeaderHeightIdx_ = len;
    ti.location = sv([len + 1, len + 2, len + 3, len + 4, len + 5]);

    data.push('-w/2', '-h/2', 'w/2', '-h/2', 'w/2', `-h/2+d(${si(len)})`, '-w/2', `-h/2+d(${si(len)})`);
    this.newPath(
      `M ${sv([len + 6, len + 7])} L ${sv([len + 8, len + 9])} L ${sv([len + 10, len + 11])} L ${sv([len + 12, len + 13])} Z`,
    );
    data.push('w/2', 'h/2', '-w/2', 'h/2');
    this.newPath(
      `M ${sv([len + 10, len + 11])} L ${sv([len + 14, len + 15])} L ${sv([len + 16, len + 17])} L ${sv([len + 12, len + 13])}`,
    );
    this.topy1_ = len + 13;
  }

  /** C++ `generateCells`: the column lines, the column header, the row lines. */
  private generateCells(t: ShapeTemplate): void {
    const data = this.data_;
    this.colSum_ = this.colSizes_.reduce((a, b) => a + b, 0);
    if (this.colSum_ <= 0) this.colSum_ = 1;

    const colIndices: number[] = [];
    let len = data.length;
    let sum = 0;
    for (let i = 0; i < this.colSizes_.length; i++) {
      sum += this.colSizes_[i] ?? 0;
      const dix = len + i * 4;
      colIndices.push(dix);
      const xexp = `-w/2+w*${sf(sum / this.colSum_)}`;
      data.push(xexp, `d(${si(this.topy1_)})`, xexp, 'h/2');
      this.colPoints_.push(dix, dix + 1, dix + 2, dix + 3);
      if (i < this.colSizes_.length - 1 && this.showColLines_) {
        this.newPath(`M ${sv([dix, dix + 1])} L ${sv([dix + 2, dix + 3])}`);
      }
    }

    this.topy2_ = this.topy1_;

    if (this.hasColHeader_) {
      len = data.length;
      const textIdx = this.textInfos_.length;
      let textAngle = '0';
      let rotated = false;
      let fn = 'th';
      const padding = 'sw(-1) + 8';
      if (this.headerOrientation_ !== 'Normal') {
        fn = 'tw';
        textAngle = sf(Math.PI / 2);
        rotated = true;
      }
      if (this.ncols_ === 1) {
        data.push(`${fn}(${si(textIdx)})+${padding}`);
      } else {
        let exp = `max(${fn}(${si(textIdx)}), ${fn}(${si(textIdx + 1)}))`;
        for (let i = 2; i < this.ncols_; i++) exp = `max(${exp}, ${fn}(${si(textIdx + i)}))`;
        data.push(`${exp}+${padding}`);
      }
      this.colHeaderHeightIdx_ = len;

      const yexp = `d(${si(this.topy1_)}) + d(${si(len)})`;
      data.push('-w/2', yexp, 'w/2', yexp);
      this.topy2_ = len + 2;
      let leftx = len + 1;

      if (this.showLineBelowHeader_) this.newPath(`M ${sv([len + 1, len + 2])} L ${sv([len + 3, len + 4])}`);

      for (let i = 0; i < this.ncols_; i++) {
        const ti = this.makeText(t, COL_HEADER_ROW, i, this.colHeaderText_);
        const rightx = colIndices[i] ?? 0;
        len = data.length;
        let widthExp = `d(${si(rightx)})-d(${si(leftx)})`;
        // C++'s height expression has an unbalanced `)`; it is kept, the parser ignores it.
        let heightExp = `d(${si(this.topy2_)})-d(${si(this.topy1_)}))`;
        if (rotated) [widthExp, heightExp] = [heightExp, widthExp];
        data.push(
          `(d(${si(leftx)})+d(${si(rightx)}))/2`,
          `(d(${si(this.topy1_)})+d(${si(this.topy2_)}))/2`,
          widthExp,
          heightExp,
          textAngle,
        );
        ti.location = sv([len, len + 1, len + 2, len + 3, len + 4]);
        ti.style.setTextAlignVertical(TextAlignVertical.Center);
        ti.style.setTextAlignHorizontal(TextAlignHorizontal.Center);
        ti.style.addNonOverridables('textAlignHorizontal');
        ti.style.addNonOverridables('textAlignVertical');
        leftx = rightx;
      }
    }

    this.rowSum_ = this.rowSizes_.reduce((a, b) => a + b, 0);
    if (this.rowSum_ <= 0) this.rowSum_ = 1;

    len = data.length;
    sum = 0;
    const height = `(h/2-d(${si(this.topy2_)}))`;
    for (let i = 0; i < this.rowSizes_.length; i++) {
      sum += this.rowSizes_[i] ?? 0;
      const dix = len + i * 4;
      const yexp = `d(${si(this.topy2_)})+${height}*${sf(sum / this.rowSum_)}`;
      data.push('-w/2', yexp, 'w/2', yexp);
      this.rowPoints_.push(dix, dix + 1, dix + 2, dix + 3);
      if (i < this.rowSizes_.length - 1 && this.showRowLines_) {
        this.newPath(`M ${sv([dix, dix + 1])} L ${sv([dix + 2, dix + 3])}`);
      }
    }
  }

  /** C++ `genCellTextOrContainer`: one text per cell, or one container below the headers. */
  private genCellTextOrContainer(t: ShapeTemplate): void {
    const data = this.data_;
    let len = data.length;
    data.push('-w/2', `d(${si(this.topy2_)})`);

    if (this.cellType_ === 'container') {
      data.push('w/2', `d(${si(len + 1)})`, 'w/2', 'h/2', '-w/2', 'h/2');
      this.containers_.push(
        `M ${sv([len, len + 1])} L ${sv([len + 2, len + 3])} L${sv([len + 4, len + 5])} L ${sv([len + 6, len + 7])} Z`,
      );
      return;
    }
    // Any other cell type than `text` has no cells (C++'s per-cell container is commented out).
    if (this.cellType_ !== 'text') return;

    const startx = len;
    const starty = len + 1;
    const height = `(h/2-d(${si(this.topy2_)}))`;
    let sumr = 0;
    for (let r = 0; r < this.nrows_; r++) {
      let sumc = 0;
      const rowSize = this.rowSizes_[r] ?? 0;
      for (let c = 0; c < this.ncols_; c++) {
        const colSize = this.colSizes_[c] ?? 0;
        let xexp = `d(${si(startx)})`;
        if (sumc !== 0) xexp += `+w*${sf(sumc / this.colSum_)}`;
        let yexp = `d(${si(starty)})`;
        if (sumr !== 0) yexp += `+${height}*${sf(sumr / this.rowSum_)}`;
        len = data.length;
        const cellWidth = `w*${sf(colSize / this.colSum_)}`;
        const cellHeight = `${height}*${sf(rowSize / this.rowSum_)}`;
        data.push(`${xexp}+0.5*(${cellWidth})`, `${yexp}+0.5*(${cellHeight})`, cellWidth, cellHeight, '0');
        this.makeText(t, r, c).location = sv([len, len + 1, len + 2, len + 3, len + 4]);
        sumc += colSize;
      }
      sumr += rowSize;
    }
  }

  /** C++ `makeText`: the template's text of this cell (moved over), or a new one. */
  private makeText(t: ShapeTemplate, row: number, col: number, defaultText = ''): TextInfo {
    const i = t.textData.findIndex((x) => x.row === row && x.col === col);
    if (i >= 0) {
      const [ti] = t.textData.splice(i, 1);
      if (ti !== undefined) {
        this.textInfos_.push(ti);
        return ti;
      }
    }
    const ti = new TextInfo();
    ti.text = defaultText;
    ti.row = row;
    ti.col = col;
    this.textInfos_.push(ti);
    return ti;
  }

  /** The column edges along the bottom, then the row edges along the right (C++ `Point::Attr`). */

  override getInterestingPoints(_t: ShapeTemplate, ds: DataStore, out: InterestingPoint[]): void {
    if (this.colSizes_.length === 0 || this.rowSizes_.length === 0) return;
    let points = [...this.colVertexPoints(ds), ...this.rowVertexPoints(ds, false)];
    if (ds.angle() !== 0) points = rotate(points, ds.getCenter(), ds.angle());
    for (const point of points) out.push({ point, type: PointType.Attr });
  }

  /**
   * Drags edge `vid`: `0..ncols` are the column edges (the outer two also move the bottom edge),
   * the rest the row edges (the first also moves the right edge). Regenerates and reloads.
   */
  override moveVertexTo(t: ShapeTemplate, ds: DataStore, vid: number, pt: Point): Point {
    let at = pt;
    if (ds.angle() !== 0) at = rotate([at], ds.getCenter(), -ds.angle())[0] ?? at;

    let out: Point;
    if (vid <= this.ncols_) {
      out = this.resizeCol(t, vid, at, ds);
      if (vid === 0 || vid === this.ncols_) {
        const tmp = this.resizeRow(t, this.nrows_, at, ds);
        out = new Point(out.x, tmp.y);
      }
    } else {
      const id = vid - this.ncols_ - 1;
      out = this.resizeRow(t, id, at, ds);
      if (id === 0) {
        const tmp = this.resizeCol(t, this.ncols_, at, ds);
        out = new Point(tmp.x, out.y);
      }
    }

    if (ds.angle() !== 0) out = rotate([out], ds.getCenter(), ds.angle())[0] ?? out;
    // C++ generated, then loaded (which generates again); `load()` alone gives the same result.
    t.load();
    return out;
  }

  /** C++ `resizeCol`. */
  private resizeCol(t: ShapeTemplate, vid: number, toPt: Point, ds: DataStore): Point {
    let toX = toPt.x;
    const pts = this.colVertexPoints(ds).map((p) => p.x);
    const last = pts.length - 1;
    if (vid < last) toX = Math.min(toX, (pts[vid + 1] ?? 0) - MIN_GAP);
    if (vid > 0) toX = Math.max(toX, (pts[vid - 1] ?? 0) + MIN_GAP);

    if (vid === 0 || vid === last) {
      const delta = toX - (vid === 0 ? (pts[0] ?? 0) : (pts[last] ?? 0));
      ds.setWidth(vid === 0 ? ds.width() - delta : ds.width() + delta);
      ds.setCx(ds.cx() + (delta / 2) * Math.cos(ds.angle()));
      ds.setCy(ds.cy() + (delta / 2) * Math.sin(ds.angle()));
    }
    pts[vid] = toX;
    for (let i = 1; i < pts.length; i++) setSizeParam(t, `col${si(i - 1)}`, (pts[i] ?? 0) - (pts[i - 1] ?? 0));
    return new Point(toX, toPt.y);
  }

  /** C++ `resizeRow`. */
  private resizeRow(t: ShapeTemplate, vid: number, toPt: Point, ds: DataStore): Point {
    let toY = toPt.y;
    const pts = this.rowVertexPoints(ds, true).map((p) => p.y);
    const last = pts.length - 1;
    if (vid < last) toY = Math.min(toY, (pts[vid + 1] ?? 0) - MIN_GAP);
    if (vid > 0) toY = Math.max(toY, (pts[vid - 1] ?? 0) + MIN_GAP);

    if (vid === 0 || vid === last) {
      const delta = toY - (vid === 0 ? (pts[0] ?? 0) : (pts[last] ?? 0));
      ds.setHeight(vid === 0 ? ds.height() - delta : ds.height() + delta);
      ds.setCy(ds.cy() + (delta / 2) * Math.cos(ds.angle()));
      ds.setCx(ds.cx() - (delta / 2) * Math.sin(ds.angle()));
    }
    pts[vid] = toY;
    for (let i = 1; i < pts.length; i++) setSizeParam(t, `row${si(i - 1)}`, (pts[i] ?? 0) - (pts[i - 1] ?? 0));
    return new Point(toPt.x, toY);
  }

  /** C++ `getColVertexPoint`: the bottom-left corner, then each column's right edge on the bottom. */
  private colVertexPoints(ds: DataStore): Point[] {
    const left = ds.cx() - ds.width() / 2;
    const y = ds.cy() + ds.height() / 2;
    const pts = [new Point(left, y)];
    let sum = 0;
    for (const s of this.colSizes_) {
      sum += s;
      pts.push(new Point(left + (ds.width() * sum) / this.colSum_, y));
    }
    return pts;
  }

  /** C++ `getRowVertexPoint`: the top-right corner below the headers, then each row's bottom edge. */
  private rowVertexPoints(ds: DataStore, includeLast: boolean): Point[] {
    let header = 0;
    const v = ds.values;
    if (this.tabHeaderHeightIdx_ >= 0 && this.tabHeaderHeightIdx_ < v.length)
      header += v[this.tabHeaderHeightIdx_] ?? 0;
    if (this.colHeaderHeightIdx_ >= 0 && this.colHeaderHeightIdx_ < v.length)
      header += v[this.colHeaderHeightIdx_] ?? 0;
    const x = ds.cx() + ds.width() / 2;
    const top = ds.cy() - ds.height() / 2 + header;
    const pts = [new Point(x, top)];
    let last = this.rowSizes_.length - 1;
    if (includeLast) last++;
    let sum = 0;
    for (let i = 0; i < last; i++) {
      sum += this.rowSizes_[i] ?? 0;
      pts.push(new Point(x, top + ((ds.height() - header) * sum) / this.rowSum_));
    }
    return pts;
  }
}

/** `row<i>` / `col<i>` for `i < n` (consumed from `vals`); a missing one repeats the previous, the first `1/n`. */
function sizesFrom(vals: Map<string, number>, prefix: 'row' | 'col', n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const key = `${prefix}${si(i)}`;
    const v = vals.get(key);
    if (v !== undefined) {
      out.push(v);
      vals.delete(key);
    } else {
      out.push(i > 0 ? (out[out.length - 1] ?? 0) : 1 / n);
    }
  }
  return out;
}

/** Sets the hidden size parameter `name`, adding it (order 999) when the template lacks it. */
function setSizeParam(t: ShapeTemplate, name: string, value: number): void {
  const p = t.params.find((x) => x.name === name);
  if (p !== undefined) {
    p.value = value;
    return;
  }
  const np = new TemplateParam();
  np.name = name;
  np.order = 999;
  np.value = value;
  np.editor.type = ParamEditorType.Hidden;
  t.params.push(np);
}
