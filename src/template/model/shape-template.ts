// A live template on one object (port of C++ `ShapeTemplate`, `L/ShapeTemplate.{h,cpp}`): it owns
// the compiled data expressions, the elements built from the template data, the master
// `GroupStyle` and its generator, and runs `load()` and `generateData()`.
//
// Rules beyond a straight translation (spec 04 §2, spec 03 §5):
//   - `load()` order is unchanged: `clear()` → `generator.generate()` → compile data → build
//     elements → title layout. `load()` is the only caller of `generator.generate()`;
//   - `generateData(ds)` order is unchanged: `generator.setDimension(ds)` → evaluate in order →
//     translate and rotate the vertex and floating points;
//   - an expression that does not parse evaluates to 0, with one `expression_invalid` warning per
//     template (DR-GEN-01);
//   - compiled expressions come from the catalog's `TemplateDef` when the data strings match it
//     (`useCompiled`), so catalog templates compile once per JS realm;
//   - C++ `draw` is `layout(ds)` + `paint(dp, ds, textEditIndex)`; layout never generates;
//   - the C++ globals arrive through the template's `TemplateEnv`.
import { Point, PointType, Rect, getPointsBound, rectDistanceFrom, rotate, rotateAboutMid } from '../../geometry';
import type { Size } from '../../geometry';
import type { DrawingPlatform } from '../../render';
import { Color, GroupStyle, GroupStyleMode, Style } from '../../style';
import { formatG6 } from '../../base';
import { DataExpressionParser, isCSpace } from '../expr/data-expression-parser';
import { DataStore } from '../expr/data-store';
import {
  BinaryExpression,
  BinaryOperator,
  PrimitiveExpression,
  VariableAccessExpression,
  type Expression,
  type ExpressionScope,
} from '../expr/expression';
import type { TemplateEnv } from '../env';
import { MoveToCommand } from './primitive-shape';
import { ShapeImageElement, ShapePathElement, ShapeTextElement, TextSide } from './shape-element';
import { PathInfo, TemplateData } from './template-data';

/** A point a selection shows on a shape (C++ `std::pair<Point, Point::Type>`). */
export interface InterestingPoint {
  readonly point: Point;
  readonly type: PointType;
}

/** C++ `LibraryViewAttr`: how the shape library cell shows the template. */
export class LibraryViewAttr {
  width = -1;
  height = -1;
  text = '';
  scale = false;
  priority = 0;

  clone(): LibraryViewAttr {
    return Object.assign(new LibraryViewAttr(), this);
  }
}

/** C++ `DefaultAttr`: the size and angle of a new instance. */
export class DefaultAttr {
  width = 10;
  height = 10;
  angle = 0;

  clone(): DefaultAttr {
    return Object.assign(new DefaultAttr(), this);
  }
}

/** C++ `AttrParamInfo`: a parameter set from an expression when a point attribute moves. */
export interface AttrParamInfo {
  readonly expressionIndex: number;
  readonly name: string;
}

/** C++ `PointAttribute`: a draggable point (data indices) and its constraint box (expression indices). */
export interface PointAttribute {
  readonly cx: number;
  readonly cy: number;
  readonly minx: number;
  readonly maxx: number;
  readonly miny: number;
  readonly maxy: number;
  readonly params: readonly AttrParamInfo[];
}

/** What a resolver hands `load()` for an embed: a fresh, loaded template and its frame. */
export interface EmbeddedShapeSource {
  readonly template: ShapeTemplate;
  /** The source object's box (a template's default size at the origin). */
  readonly rect: Rect;
  readonly angle: number;
}

/**
 * A template embedded in another (C++ `EmbeddedTemplate`, whose `shape` was a `TemplatedObject`;
 * here the template and its own `DataStore`, since `template/` sits below `model/`).
 */
export class EmbeddedShape {
  readonly template: ShapeTemplate;
  readonly ds = new DataStore();
  /** Data indices of the embed's centre, size and angle in the host's data. */
  cx = 0;
  cy = 0;
  width = 0;
  height = 0;
  angle = 0;
  /** 0: keep aspect ("aspect"); 1: stretch. */
  mode = 1;
  origWidth = 0;
  origHeight = 0;

  /** C++ `TemplatedObject(tmpl, rect, angle, false)`: min size 1, generate, apply defaults. */
  constructor(template: ShapeTemplate, rect: Rect, angle: number) {
    this.template = template;
    this.ds.setAngle(angle);
    this.ds.setRect(rect.checkMinDimension(1, 1));
    template.generateData(this.ds);
    template.setDefaults(this.ds);
  }

  /** C++ `EmbeddedTemplate::generateData`: placed from the host's data. */
  generateData(host: DataStore): void {
    const w = host.value(this.width);
    const h = host.value(this.height);
    let nw = w;
    let nh = h;
    if (this.mode === 0) {
      const aspect = this.origHeight !== 0 ? this.origWidth / this.origHeight : 1;
      nw = aspect * h;
      nh = h;
      if (nw > w && aspect !== 0) {
        nh = w / aspect;
        nw = w;
      }
    }
    this.ds.setCx(host.value(this.cx));
    this.ds.setCy(host.value(this.cy));
    this.ds.setWidth(nw);
    this.ds.setHeight(nh);
    this.ds.setAngle(host.value(this.angle) + host.angle());
    this.template.generateData(this.ds);
  }
}

/** C++ `kTitleGap`: the gap between a shape and its title. */
const TITLE_GAP = 8;

/** C++ `LekhUtil::trim` (C whitespace). */
function trim(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && isCSpace(s[a])) a++;
  while (b > a && isCSpace(s[b - 1])) b--;
  return s.slice(a, b);
}

/** Compiled expressions to reuse: valid while the data string at the same index is unchanged. */
export interface CompiledData {
  readonly strs: readonly string[];
  readonly exprs: readonly (Expression | null)[];
}

export class ShapeTemplate extends TemplateData implements ExpressionScope {
  protected readonly env_: TemplateEnv;
  protected groupStyle_ = new GroupStyle(GroupStyleMode.Master);
  protected expressions_: (Expression | null)[] = [];
  protected paths_: ShapePathElement[] = [];
  protected texts_: ShapeTextElement[] = [];
  protected images_: ShapeImageElement[] = [];
  protected boundPath_: ShapePathElement | null = null;
  protected pointAttributes_: PointAttribute[] = [];
  protected containers_: ShapePathElement[] = [];
  protected embeddedObjects_: EmbeddedShape[] = [];
  protected vertexPts_: number[] = [];
  /** Rotated with the shape like `vertexPts_`, but not vertices: the title. */
  protected floatingPts_: number[] = [];
  protected noFillPathIds_: number[] = [];
  protected editableVerticesPts_: number[] = [];
  protected alignPoints_: number[] = [];
  protected laidOut_ = false;
  private compiled_: CompiledData | null = null;
  private warnedInvalid_ = false;

  libraryViewAttr = new LibraryViewAttr();
  defaultAttr = new DefaultAttr();

  constructor(env: TemplateEnv) {
    super();
    this.env_ = env;
  }

  /** C++ `ShapeTemplate::get(data, draw)`: one path, a fresh style. */
  static fromDataAndDraw(env: TemplateEnv, data: readonly string[], draw: string): ShapeTemplate {
    const t = new ShapeTemplate(env);
    t.dataExpStrs = data.slice();
    t.pathData.push(new PathInfo(draw, new Style()));
    return t;
  }

  env(): TemplateEnv {
    return this.env_;
  }

  id(): string {
    return this.templateId;
  }

  /** Reuse `compiled` for every data string equal to the one it was compiled from. */
  useCompiled(compiled: CompiledData | null): void {
    this.compiled_ = compiled;
  }

  // ---- ExpressionScope ----

  paramValue(name: string): number | undefined {
    for (const p of this.params) {
      if (p.name === name) return p.numberValue();
    }
    return undefined;
  }

  textSize(index: number, constraint: Size): Size | null {
    const te = this.texts_[index];
    const style = te?.style() ?? null;
    if (te === undefined || style === null) return null;
    return this.env_.text.measure(te.text(), style, constraint);
  }

  strokeWidth(index: number): number {
    const st = this.paths_[index]?.style() ?? null;
    if (st !== null) return st.effectiveStrokeWidth();
    return this.groupStyle_.effectiveStrokeWidth();
  }

  // ---- load ----

  clone(): ShapeTemplate {
    const other = new ShapeTemplate(this.env_);
    this.copy(other);
    return other;
  }

  protected copy(other: ShapeTemplate): void {
    other.copyFrom(this);
    other.libraryViewAttr = this.libraryViewAttr.clone();
    other.defaultAttr = this.defaultAttr.clone();
    other.groupStyle_.copyFrom(this.groupStyle_);
    other.groupStyle_.setMode(GroupStyleMode.Master);
    other.compiled_ = this.compiled_;
  }

  load(): void {
    this.clear();
    if (this.generator !== null) this.generator.generate(this, this.env_.generatorContext(this));

    this.loadDataExpressions();
    for (const pi of this.pathData) {
      const path = new ShapePathElement();
      path.setStyle(pi.style);
      path.setDrawCmdStr(pi.drawCmds);
      this.paths_.push(path);
    }
    for (const cp of this.containerPaths) {
      const path = new ShapePathElement();
      path.setStyle(null);
      path.setDrawCmdStr(cp);
      this.containers_.push(path);
    }

    const title = this.titleIndex();
    for (let i = 0; i < this.textData.length; i++) {
      const td = this.textData[i];
      if (td === undefined) continue;
      if (i === title) {
        // The title's box is not its stored location, which it may lack.
        const st = new ShapeTextElement();
        st.setText(td.text);
        st.setStyle(td.style);
        st.setExternal(td.external);
        st.setFloating(true);
        this.texts_.push(st);
      } else if (td.location !== '') {
        const st = new ShapeTextElement();
        st.setText(td.text);
        st.setStyle(td.style);
        st.setLocationStr(td.location);
        st.setIsDefaultText(this.isTextLocationDefault(i));
        this.texts_.push(st);
      } else if (td.external !== TextSide.None) {
        // A side on a template that cannot have a title: an ordinary text in the shape box, so
        // texts stay aligned with textData.
        const st = new ShapeTextElement();
        st.setText(td.text);
        st.setStyle(td.style);
        st.setLocationStr('default');
        st.setIsDefaultText(true);
        this.texts_.push(st);
      }
    }
    this.loadTitleLayout();

    for (const ii of this.imageData) {
      if (ii.location === '') continue;
      const ie = new ShapeImageElement();
      ie.setStyle(ii.style);
      ie.setInlineImage(ii.base64, ii.format);
      ie.setResourceUrl(ii.src);
      ie.setLocationStr(ii.location);
      this.images_.push(ie);
    }

    this.noFillPathIds_ = DataExpressionParser.parseList(this.noFillPathStr);
    for (const pid of this.noFillPathIds_) {
      const pi = this.pathData[pid];
      if (pi !== undefined) {
        pi.style.setNoFill();
        pi.style.addNonOverridables('fillPaint');
      }
    }
    this.editableVerticesPts_ = DataExpressionParser.parseList(this.editableVerticesStr);
    this.alignPoints_ = DataExpressionParser.parseList(this.alignPointsStr);

    if (this.boundPathStr !== '') {
      const bp = new ShapePathElement();
      bp.parse(this.boundPathStr);
      bp.onLoad();
      this.boundPath_ = bp;
    } else {
      this.boundPath_ = null;
    }

    this.loadEmbeds();

    for (const p of this.paths_) p.getPositionPoints(this.vertexPts_);
    for (const t of this.texts_) {
      if (t.external() === TextSide.None) t.getPositionPoints(this.vertexPts_);
    }
    for (const im of this.images_) im.getPositionPoints(this.vertexPts_);
    for (const c of this.containers_) c.getPositionPoints(this.vertexPts_);
    // Align points become vertex points through a MoveTo's dedup (as C++).
    for (let i = 0; i + 1 < this.alignPoints_.length; i += 2) {
      new MoveToCommand(this.alignPoints_[i] ?? 0, this.alignPoints_[i + 1] ?? 0, false, null).getPositionPoints(
        this.vertexPts_,
      );
    }
    this.loadPointAttributes();
    this.initGroupStyle();
  }

  private loadEmbeds(): void {
    for (const ei of this.embedData) {
      let tname = ei.name;
      if (tname === '' && ei.param !== '') {
        const p = this.params.find((q) => q.name === ei.param);
        if (p !== undefined) tname = p.stringValue();
      }
      if (tname === '') continue;
      const src = this.env_.resolver.getEmbed(tname);
      if (src === null) continue;
      const loc = DataExpressionParser.parseList(ei.location);
      if (loc.length < 5) continue;

      const et = new EmbeddedShape(src.template, src.rect, src.angle);
      et.template.getStyle().setParent(ei.style);
      if (ei.inheritStyle && ei.style !== null) ei.style.setParent(this.groupStyle_);
      et.cx = loc[0] ?? 0;
      et.cy = loc[1] ?? 0;
      // The embed's centre is a vertex point.
      this.vertexPts_.push(et.cx, et.cy);
      et.width = loc[2] ?? 0;
      et.height = loc[3] ?? 0;
      et.angle = loc[4] ?? 0;
      et.mode = ei.mode === 'aspect' ? 0 : 1;
      et.origWidth = et.ds.width();
      et.origHeight = et.ds.height();
      this.embeddedObjects_.push(et);
    }
  }

  private loadPointAttributes(): void {
    const parser = new DataExpressionParser();
    for (const s of this.pointAttrStrs) {
      if (s === '') continue;
      const nodes = parser.parseIntStrList(s);
      if (nodes === null || nodes.length < 8) continue;
      const ids: number[] = [];
      let idx = 0;
      for (; idx < 6; idx++) {
        const n = nodes[idx];
        if (typeof n !== 'number') break;
        ids.push(n);
      }
      if (ids.length !== 6) continue;
      const params: AttrParamInfo[] = [];
      let error = false;
      while (idx + 1 < nodes.length) {
        const name = nodes[idx];
        const ex = nodes[idx + 1];
        if (typeof name !== 'string' || typeof ex !== 'number') {
          error = true;
          break;
        }
        params.push({ name, expressionIndex: ex });
        idx += 2;
      }
      if (error) continue;
      const [cx = 0, cy = 0, minx = 0, maxx = 0, miny = 0, maxy = 0] = ids;
      this.pointAttributes_.push({ cx, cy, minx, maxx, miny, maxy, params });
    }
  }

  /** The title's runtime layout: five expressions appended after every declared index. */
  protected loadTitleLayout(): void {
    this.floatingPts_ = [];
    const k = this.texts_.findIndex((t) => t.external() !== TextSide.None);
    const te = this.texts_[k];
    if (te === undefined) return;
    const tw = `tw(${String(k)})`;
    const th = `th(${String(k)})`;
    const gap = String(TITLE_GAP);
    const w = `${tw} + ${gap}`;
    const h = `${th} + ${gap}`;
    let cx = '0';
    let cy = '0';
    switch (te.external()) {
      case TextSide.Bottom:
        cy = `h/2 + ${gap} + ${th}/2`;
        break;
      case TextSide.Top:
        cy = `-h/2 - ${gap} - ${th}/2`;
        break;
      case TextSide.Left:
        cx = `-w/2 - ${gap} - ${tw}/2`;
        break;
      case TextSide.Right:
        cx = `w/2 + ${gap} + ${tw}/2`;
        break;
    }
    const parser = new DataExpressionParser();
    const n = this.expressions_.length;
    for (const str of [cx, cy, w, h, '0']) this.expressions_.push(parser.compile(str));
    te.setLocationIndices(n, n + 1, n + 2, n + 3, n + 4);
    this.floatingPts_.push(n, n + 1);
  }

  protected initGroupStyle(): void {
    const styles: Style[] = [];
    for (const e of [...this.paths_, ...this.texts_, ...this.images_]) {
      const st = e.style();
      if (st !== null) styles.push(st);
    }
    for (const st of styles) st.setParent(this.groupStyle_);
    this.groupStyle_.setProfiles(styles);
  }

  protected clear(): void {
    this.expressions_ = [];
    this.laidOut_ = false;
    this.paths_ = [];
    this.texts_ = [];
    this.images_ = [];
    this.containers_ = [];
    this.embeddedObjects_ = [];
    this.pointAttributes_ = [];
    this.boundPath_ = null;
    this.vertexPts_ = [];
    this.floatingPts_ = [];
    this.alignPoints_ = [];
  }

  protected loadDataExpressions(): void {
    const parser = new DataExpressionParser();
    const cache = this.compiled_;
    this.expressions_ = this.dataExpStrs.map((s, i) =>
      cache !== null && cache.strs[i] === s ? (cache.exprs[i] ?? null) : parser.compile(s),
    );
    const bad = this.expressions_.findIndex((e) => e === null);
    if (bad >= 0 && !this.warnedInvalid_) {
      this.warnedInvalid_ = true;
      this.env_.warn('expression_invalid', { templateId: this.templateId, index: bad });
    }
  }

  setDataExpressions(exprs: readonly string[]): void {
    this.dataExpStrs = exprs.slice();
    this.loadDataExpressions();
    // loadDataExpressions dropped the title's runtime expressions.
    this.loadTitleLayout();
  }

  dataExprs(): readonly string[] {
    return this.dataExpStrs;
  }

  /** The compiled expressions: the declared data, then the title's runtime layout. */
  expressionCount(): number {
    return this.expressions_.length;
  }

  // ---- data ----

  generateData(ds: DataStore): void {
    this.generator?.setDimension(ds);
    // Evaluated in order into the cleared list: d(j) of a later index reads 0 (C++ read past the end).
    ds.values = [];
    for (const e of this.expressions_) ds.values.push(e !== null ? e.value(ds, this) : 0);

    const pts: Point[] = [];
    for (let i = 0; i < this.vertexPts_.length; i += 2) {
      pts.push(new Point(ds.value(this.vertexPts_[i] ?? -1), ds.value(this.vertexPts_[i + 1] ?? -1)));
    }
    for (let i = 0; i + 1 < this.floatingPts_.length; i += 2) {
      pts.push(new Point(ds.value(this.floatingPts_[i] ?? -1), ds.value(this.floatingPts_[i + 1] ?? -1)));
    }
    let moved = pts.map((p) => p.withDelta(ds.cx(), ds.cy()));
    if (ds.angle() !== 0) moved = rotate(moved, new Point(ds.cx(), ds.cy()), ds.angle());

    this.setVertices(ds, moved);
    const nv = this.vertexPts_.length / 2;
    for (let i = 0; i + 1 < this.floatingPts_.length; i += 2) {
      const p = moved[nv + i / 2];
      const fx = this.floatingPts_[i];
      const fy = this.floatingPts_[i + 1];
      if (p === undefined || fx === undefined || fy === undefined) continue;
      ds.values[fx] = p.x;
      ds.values[fy] = p.y;
    }
    for (const et of this.embeddedObjects_) et.generateData(ds);
    this.computeArrowPoints(ds);
  }

  protected setVertices(ds: DataStore, pts: readonly Point[]): void {
    for (let i = 0; i < this.vertexPts_.length; i += 2) {
      const x = this.vertexPts_[i] ?? -1;
      const y = this.vertexPts_[i + 1] ?? -1;
      const p = pts[i / 2];
      if (p === undefined) continue;
      if (x >= 0 && x < ds.values.length) ds.values[x] = p.x;
      if (y >= 0 && y < ds.values.length) ds.values[y] = p.y;
    }
  }

  vertices(ds: DataStore): Point[] {
    const out: Point[] = [];
    for (let i = 0; i < this.vertexPts_.length; i += 2) {
      out.push(new Point(ds.value(this.vertexPts_[i] ?? -1), ds.value(this.vertexPts_[i + 1] ?? -1)));
    }
    return out;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- overridden with the parameter
  computeArrowPoints(_ds: DataStore): void {
    /* only open shapes have arrows */
  }

  // ---- vertex editing ----

  afterVertexEditing(ds: DataStore): void {
    let vpts = this.vertices(ds);
    const onePt = vpts[0];
    if (onePt === undefined) return;
    if (ds.angle() !== 0) vpts = rotateAboutMid(vpts, -ds.angle());
    let bound = getPointsBound(vpts);
    if (bound.width < 1) bound = new Rect(bound.x, bound.y, 1, bound.height);
    if (bound.height < 1) bound = new Rect(bound.x, bound.y, bound.width, 1);
    const c = bound.center();
    for (let i = 0; i < vpts.length; i++) {
      const pt = vpts[i] ?? new Point();
      this.moveDataPoint(2 * i, 2 * i + 1, (pt.x - c.x) / bound.width, (pt.y - c.y) / bound.height);
    }
    ds.setRect(bound);
    this.generateData(ds);
    // Translate back by the shift the rotation introduced.
    if (ds.angle() !== 0) {
      const pt = this.vertices(ds)[0] ?? onePt;
      ds.setCx(ds.cx() + onePt.x - pt.x);
      ds.setCy(ds.cy() + onePt.y - pt.y);
      this.generateData(ds);
    }
  }

  private movePointAttr(vid: number, to: Point, ds: DataStore): Point {
    const pa = this.pointAttributes_[vid];
    const values = ds.values;
    const ex = this.expressions_;
    if (
      pa === undefined ||
      pa.cx >= values.length ||
      pa.cy >= values.length ||
      pa.minx >= ex.length ||
      pa.maxx >= ex.length ||
      pa.miny >= ex.length ||
      pa.maxy >= ex.length
    ) {
      return to;
    }
    const curx = values[pa.cx] ?? 0;
    const cury = values[pa.cy] ?? 0;
    let pt = to;
    if (ds.angle() !== 0) pt = rotate([pt], new Point(ds.cx(), ds.cy()), -ds.angle())[0] ?? pt;
    const ev = (i: number) => ex[i]?.value(ds, this) ?? 0;
    const minx = ev(pa.minx) + ds.cx();
    const maxx = ev(pa.maxx) + ds.cx();
    const miny = ev(pa.miny) + ds.cy();
    const maxy = ev(pa.maxy) + ds.cy();
    const rect = new Rect(minx, miny, maxx - minx, maxy - miny);
    // The nearest point on the constraint rect.
    if (!rect.contains(pt)) pt = rectDistanceFrom(rect, pt).near;
    values[pa.cx] = pt.x;
    values[pa.cy] = pt.y;
    for (const api of pa.params) {
      if (api.expressionIndex >= ex.length) continue;
      for (const param of this.params) {
        if (param.name !== api.name) continue;
        const val = ev(api.expressionIndex);
        if (Number.isFinite(val)) param.value = val;
      }
    }
    values[pa.cx] = curx;
    values[pa.cy] = cury;
    this.generateData(ds);
    return new Point(ds.value(pa.cx), ds.value(pa.cy));
  }

  /** C++ `moveVertexTo(int vid, wfactor, hfactor)`: through the editable-vertex list. */
  protected moveEditableVertex(vid: number, wfactor: number, hfactor: number): void {
    if (this.editableVerticesPts_.length <= 2 * vid + 1) return;
    this.moveDataPoint(
      this.editableVerticesPts_[2 * vid] ?? 0,
      this.editableVerticesPts_[2 * vid + 1] ?? 0,
      wfactor,
      hfactor,
    );
  }

  /** C++ `moveVertexTo(int ptx, int pty, wfactor, hfactor)`: the point's data become `wf*w`, `hf*h`. */
  protected moveDataPoint(ptx: number, pty: number, wfactor: number, hfactor: number): void {
    if (ptx >= this.dataExpStrs.length || pty >= this.dataExpStrs.length) return;
    this.expressions_[ptx] = new BinaryExpression(
      new PrimitiveExpression(wfactor),
      new VariableAccessExpression('w'),
      BinaryOperator.Multiply,
    );
    this.expressions_[pty] = new BinaryExpression(
      new PrimitiveExpression(hfactor),
      new VariableAccessExpression('h'),
      BinaryOperator.Multiply,
    );
    this.dataExpStrs[ptx] = `${formatG6(wfactor)}*w`;
    this.dataExpStrs[pty] = `${formatG6(hfactor)}*h`;
  }

  /** Moves vertex `vid` to `pt`; returns where it went (C++ `out`). */
  moveVertexTo(vid: number, pt: Point, ds: DataStore): Point {
    if (this.generator?.canDoVertexEditing() === true) return this.generator.moveVertexTo(this, ds, vid, pt);
    if (vid < this.pointAttributes_.length) return this.movePointAttr(vid, pt, ds);
    const v = vid - this.pointAttributes_.length;
    let p = pt;
    if (ds.angle() !== 0) p = rotate([p], new Point(ds.savedCx(), ds.savedCy()), -ds.angle())[0] ?? p;
    const w = ds.savedWidth() < 1 ? 1 : ds.savedWidth();
    const h = ds.savedHeight() < 1 ? 1 : ds.savedHeight();
    this.moveEditableVertex(v, (p.x - ds.savedCx()) / w, (p.y - ds.savedCy()) / h);
    this.generateData(ds);
    return pt;
  }

  getInterestingPoints(ds: DataStore, out: InterestingPoint[]): void {
    if (this.generator?.canDoVertexEditing() === true) {
      this.generator.getInterestingPoints(this, ds, out);
      return;
    }
    for (const pa of this.pointAttributes_) {
      out.push({ point: new Point(ds.value(pa.cx), ds.value(pa.cy)), type: PointType.Attr });
    }
    for (let i = 0; i + 1 < this.editableVerticesPts_.length; i += 2) {
      const vx = this.editableVerticesPts_[i] ?? -1;
      const vy = this.editableVerticesPts_[i + 1] ?? -1;
      if (vx < ds.values.length && vy < ds.values.length) {
        out.push({ point: new Point(ds.value(vx), ds.value(vy)), type: PointType.Vertex });
      }
    }
    out.push({ point: new Point(ds.cx(), ds.cy()), type: PointType.Center });
  }

  // ---- elements and their accessors ----

  paths(): readonly ShapePathElement[] {
    return this.paths_;
  }
  texts(): readonly ShapeTextElement[] {
    return this.texts_;
  }
  images(): readonly ShapeImageElement[] {
    return this.images_;
  }
  embeds(): readonly EmbeddedShape[] {
    return this.embeddedObjects_;
  }
  containers(): readonly ShapePathElement[] {
    return this.containers_;
  }
  boundPath(): ShapePathElement | null {
    return this.boundPath_;
  }
  pointAttributes(): readonly PointAttribute[] {
    return this.pointAttributes_;
  }
  /** The master style every element style inherits from (C++ `getStyle`). */
  getStyle(): GroupStyle {
    return this.groupStyle_;
  }

  /** Replaces the first path with `str`, keeping its style (C++ `replacePath`). */
  protected replacePath(str: string): void {
    const style = this.pathData[0]?.style ?? new Style();
    this.pathData = [new PathInfo(str, style)];
  }

  setText(index: number, text: string): void {
    const td = this.textData[index];
    if (td === undefined) return;
    td.text = text;
    this.texts_[index]?.setText(text);
  }

  /** The index into `textData` of the title, or -1 (always -1 under a regenerating or text-interpreting generator). */
  titleIndex(): number {
    const g = this.generator;
    if (g !== null && (g.behavior !== 'onParamChange' || g.interpretText())) return -1;
    return this.textData.findIndex((t) => t.external !== TextSide.None);
  }

  titleSide(): TextSide {
    const idx = this.titleIndex();
    return idx < 0 ? TextSide.None : (this.textData[idx]?.external ?? TextSide.None);
  }

  /** Requires `titleIndex() >= 0`. The caller runs `load()` and `generateData()`. */
  setTitleSide(side: TextSide): void {
    const td = this.textData[this.titleIndex()];
    if (td === undefined || side === TextSide.None) return;
    td.external = side;
  }

  titleElement(): ShapeTextElement | null {
    return this.texts_.find((t) => t.external() !== TextSide.None) ?? null;
  }

  setImageData(index: number, data: string, format: string): void {
    const ii = this.imageData[index];
    if (ii === undefined) return;
    ii.base64 = data;
    ii.format = format;
    this.images_[index]?.setInlineImage(data, format);
  }

  setImageSrc(index: number, url: string): void {
    const ii = this.imageData[index];
    if (ii !== undefined) ii.src = url;
  }

  interpretText(): boolean {
    return this.generator?.interpretText() ?? false;
  }

  setInterpretedText(txt: string): void {
    if (this.generator !== null && this.interpretText()) {
      this.generator.setInterpretedText(txt);
      this.load();
    }
  }

  interpretedText(): string {
    return this.generator?.interpretedText() ?? '';
  }

  getAlignPoints(ds: DataStore): Point[] {
    const out: Point[] = [];
    for (let i = 0; i + 1 < this.alignPoints_.length && i + 1 < ds.values.length; i += 2) {
      out.push(new Point(ds.value(this.alignPoints_[i] ?? -1), ds.value(this.alignPoints_[i + 1] ?? -1)));
    }
    return out;
  }

  isPointInsideContainer(pt: Point, ds: DataStore): boolean {
    return this.containers_.some((c) => c.isPointInside(pt, ds));
  }

  isRectInsideContainer(rect: Rect, ds: DataStore): boolean {
    // A little smaller, so a shape touching the container's edge still counts.
    const delta = 3.0;
    let r = rect;
    if (r.width > delta) r = new Rect(r.x + delta / 2, r.y, r.width - delta, r.height);
    if (r.height > delta) r = new Rect(r.x, r.y + delta / 2, r.width, r.height - delta);
    const corners = r.getPoints();
    return this.containers_.some((c) => corners.every((p) => c.isPointInside(p, ds)));
  }

  protected isTextLocationDefault(idx: number): boolean {
    const td = this.textData[idx];
    if (td === undefined) return false;
    if (td.location === 'default') return true;
    const list = DataExpressionParser.parseList(td.location);
    const cmp = (i: number | undefined, val: string) => {
      const s = i !== undefined ? this.dataExpStrs[i] : undefined;
      return s !== undefined && trim(s) === val;
    };
    return (
      list.length > 4 &&
      cmp(list[0], '0') &&
      cmp(list[1], '0') &&
      cmp(list[2], 'w') &&
      cmp(list[3], 'h') &&
      cmp(list[4], '0')
    );
  }

  usePathForDistance(): boolean {
    return this.usePrimitiveForDistance;
  }
  usePathForIntersection(): boolean {
    return this.usePrimitiveForIntersection;
  }
  usePathForInsideCheck(): boolean {
    return this.usePrimitiveForInsideCheck;
  }

  /* eslint-disable @typescript-eslint/no-unused-vars -- default hooks take the parameters their overrides use */
  setDefaults(_ds: DataStore): void {
    /* per subclass */
  }
  afterRotation(_ds: DataStore): void {
    /* per subclass */
  }
  canFlip(_type: number, _ds: DataStore): boolean {
    return false;
  }
  flip(_type: number, _ds: DataStore): void {
    /* per subclass */
  }
  drawExtraWhenSelected(_dp: DrawingPlatform, _ds: DataStore, _selectionStyle: Style): void {
    /* per subclass */
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  // ---- layout and paint ----

  /** True once a layout ran over the current path elements (`load()` rebuilds them unlaid). */
  isLaidOut(): boolean {
    return this.laidOut_;
  }

  /** The computing half of C++ `draw`: every element's geometry and text layout. */
  layout(ds: DataStore): void {
    for (const p of this.paths_) p.layout(ds);
    this.laidOut_ = true;
    for (const t of this.texts_) t.layout(ds, this.env_);
    for (const im of this.images_) im.layout(ds);
    for (const et of this.embeddedObjects_) et.template.layout(et.ds);
  }

  /** The drawing half of C++ `draw`, from the last `layout`. `textEditIndex` is the slot being edited (-1: none). */
  paint(dp: DrawingPlatform, ds: DataStore, textEditIndex = -1): void {
    if (this.interpretText() && textEditIndex >= 0) {
      // While its text is edited, a text-interpreting shape is a white box.
      const w = ds.width();
      const h = ds.height();
      const cx = ds.cx();
      const cy = ds.cy();
      const tmp = new Style();
      tmp.setFillColor(new Color(255, 255, 255, 255));
      dp.startDrawing(new Point(cx - w / 2, cy - h / 2), tmp);
      dp.addLineTo(new Point(cx - w / 2, cy + h / 2));
      dp.addLineTo(new Point(cx + w / 2, cy + h / 2));
      dp.addLineTo(new Point(cx + w / 2, cy - h / 2));
      dp.closePath();
      dp.endDrawing();
      return;
    }
    for (const p of this.paths_) p.paint(dp);
    this.texts_.forEach((t, i) => {
      if (i !== textEditIndex) t.paint(dp);
    });
    for (const im of this.images_) im.paint(dp, this.env_);
    for (const et of this.embeddedObjects_) et.template.paint(dp, et.ds, -1);
  }

  /** C++ `draw`: `layout` then `paint`. */
  draw(dp: DrawingPlatform, ds: DataStore, textEditIndex = -1): void {
    this.layout(ds);
    this.paint(dp, ds, textEditIndex);
  }
}
