// The engine half of the five C++ editors (`L/editor/{Style,Color,Connection,Page,Property}Editor`;
// spec 02 §11, spec 05 §6.3 `*EditorApi`). React panels call these; they never touch a `Style`
// themselves. What C++ read from the selection widget arrives as the editor's target, and what it
// did to the selection rectangle or a picker is the caller's (C11). Each change is one undo step
// with its realtime update, as today; a continued change of the same kind (dragging a slider)
// extends the last step instead of adding one.
import { Rect } from '../geometry';
import {
  CanvasSizeType,
  ConnectionObject,
  ConnectionType,
  PageSize,
  TemplatedObject,
  type LekhObject,
  type Page,
  type PageBackground,
  type PageMargin,
  type CanvasSize,
} from '../model';
import type { Paint } from '../style';
import {
  BACKGROUND_COLORS,
  Color,
  FontStyle,
  FontWeight,
  LEKH_COLORS,
  PaintType,
  TextDecoration,
  type Style,
  type TextAlignHorizontal,
  type TextAlignVertical,
} from '../style';
import {
  ParamEditorType,
  jsonEquals,
  type JsonValue,
  type ShapeTemplate,
  type TemplateParam,
  type TemplateParamEditor,
  type TextInfo,
} from '../template';
import { cloneObjects } from './clone';
import { isMulti, targetObjects, type EditTarget } from './edit-target';
import type { EditorContext } from './editor-context';
import {
  ArrowChangeAction,
  ChangeConnectionAction,
  DrawingProfileChangeAction,
  TemplateParamChangeAction,
} from './object-actions';
import {
  AddPageAction,
  BackgroundChangeAction,
  ChangeGridAction,
  DeletePageAction,
  PageSizeChangeAction,
  ReorderPageAction,
  SetPageMarginAction,
  SetPageNameAction,
} from './page-actions';
import { arrowsOf, arrowPointCount } from './user-action';

// ---------------------------------------------------------------------------------------------
// StyleEditor

/** C++ `StyleEditor::ChangeType`: changes of one of these kinds in a row extend one undo step. */
const ChangeType = Object.freeze({
  Other: 0,
  StrokeWidth: 1,
  StrokeColor: 2,
  FontSize: 3,
  FontColor: 4,
  FillColor: 5,
} as const);
type ChangeType = (typeof ChangeType)[keyof typeof ChangeType];

/** C++ `StyleEditor`: stroke, fill, dash and text attributes of the selection or of the canvas style. */
export class StyleEditor {
  private readonly ctx_: EditorContext;
  /** The session's current drawing style (C++ `LekhGlobal::currentStyle`), what new shapes get. */
  private readonly currentStyle_: Style;
  private style_: Style;
  private target_: EditTarget | null = null;
  private lastChange_: ChangeType = ChangeType.Other;

  constructor(ctx: EditorContext, currentStyle: Style) {
    this.ctx_ = ctx;
    this.currentStyle_ = currentStyle;
    this.style_ = currentStyle;
  }

  /** The style being edited. */
  style(): Style {
    return this.style_;
  }

  /**
   * C++ `start()` / `start(style)`: edit `target`'s `style` (its drawing profile), or with no
   * target the canvas style.
   */
  start(target: EditTarget | null = null, style?: Style): void {
    this.target_ = target;
    this.style_ = style ?? this.currentStyle_;
    this.lastChange_ = ChangeType.Other;
  }

  finish(): void {
    this.lastChange_ = ChangeType.Other;
  }

  private changingObjectStyle(): boolean {
    return this.style_ !== this.currentStyle_;
  }

  /** C++ `change(lambda)`: one new undo step for the selection, or a canvas-style change. */
  change(fn: (s: Style) => void): void {
    this.lastChange_ = ChangeType.Other;
    const target = this.target_;
    if (this.changingObjectStyle() && target !== null) {
      const objs = targetObjects(target);
      const olds: Style[] = [];
      const news: Style[] = [];
      for (const o of objs) {
        olds.push(o.getDrawingProfile().deepClone());
        fn(o.getDrawingProfile());
        news.push(o.getDrawingProfile().deepClone());
        o.invalidate();
      }
      if (objs.length > 1) fn(this.style_);
      this.ctx_.tx.record(new DrawingProfileChangeAction(this.ctx_.env, this.ctx_.doc, objs, olds, news));
    } else {
      fn(this.style_);
    }
  }

  /** C++ `change(lambda, type)`: the same kind again extends the top undo step when it is ours. */
  private changeOf(fn: (s: Style) => void, type: ChangeType): void {
    const top = this.ctx_.undo.topUndo();
    if (this.lastChange_ !== type || !(top instanceof DrawingProfileChangeAction)) {
      this.change(fn);
    } else {
      const objs = targetObjects(this.target_);
      if (!top.hasObjects(objs)) {
        this.change(fn);
      } else {
        const news: Style[] = [];
        for (const o of objs) {
          fn(o.getDrawingProfile());
          news.push(o.getDrawingProfile().deepClone());
          o.invalidate();
        }
        if (objs.length > 1) fn(this.style_);
        top.setNewStyle(news);
      }
    }
    this.lastChange_ = type;
  }

  setStrokeWidth(val: number): void {
    this.changeOf((s) => {
      s.setStrokeWidth(val);
    }, ChangeType.StrokeWidth);
  }

  setLineColor(val: Color): void {
    this.changeOf((s) => {
      s.setStrokeColor(val);
    }, ChangeType.StrokeColor);
  }

  setFillColor(val: Color): void {
    this.changeOf((s) => {
      s.setFillColor(val);
    }, ChangeType.FillColor);
  }

  setLineDash(val: readonly number[]): void {
    this.change((s) => {
      s.setDashArray(val);
    });
  }

  /** C++ `setDashType`: 0 solid, 1 `2 2`, 2 `4 4`, 3 `8 8`. */
  setDashType(type: number): void {
    const arr = type === 1 ? [2, 2] : type === 2 ? [4, 4] : type === 3 ? [8, 8] : [];
    this.setLineDash(arr);
  }

  getDashType(): number {
    const da = this.style_.effectiveDashArray();
    if (da.length !== 2) return 0;
    if (da[0] === 2) return 1;
    if (da[0] === 4) return 2;
    if (da[0] === 8) return 3;
    return 0;
  }

  /** As C++, a font-size change counts as the fill-colour kind. */
  setFontSize(val: number): void {
    this.changeOf((s) => {
      s.setFontSize(val);
    }, ChangeType.FillColor);
  }

  /**
   * C++ `setFontName`: `Platform::setFontFromPlatformName`; the platform name is kept as the
   * platform family (font resolution happens at measure time, spec 06).
   */
  setFontName(name: string): void {
    this.change((s) => {
      s.setPlatformFontFamily(name);
    });
  }

  setFontFamily(name: string): void {
    this.change((s) => {
      s.setFontFamily(name);
    });
  }

  setHorizontalAlignment(align: TextAlignHorizontal): void {
    this.change((s) => {
      s.setTextAlignHorizontal(align);
    });
  }

  setVerticalAlignment(align: TextAlignVertical): void {
    this.change((s) => {
      s.setTextAlignVertical(align);
    });
  }

  setUnderline(val: boolean): void {
    this.setDecoration(TextDecoration.UnderLine, val);
  }

  setStrikethrough(val: boolean): void {
    this.setDecoration(TextDecoration.StrikeThrough, val);
  }

  private setDecoration(bit: number, on: boolean): void {
    let deco = this.style_.effectiveTextDecoration();
    deco = on ? deco | bit : deco & ~bit;
    this.change((s) => {
      s.setTextDecoration(deco);
    });
  }

  setBold(val: boolean): void {
    this.change((s) => {
      s.setFontWeight(val ? FontWeight.Bold : FontWeight.Normal);
    });
  }

  setItalic(val: boolean): void {
    this.change((s) => {
      s.setFontStyle(val ? FontStyle.Italic : FontStyle.Normal);
    });
  }

  setTextColor(val: Color): void {
    this.changeOf((s) => {
      s.setFontColor(val);
    }, ChangeType.FontColor);
  }

  /** C++ `getObjectBound` before the view mapping (the caller maps it to view pixels). */
  getObjectBound(): Rect {
    const target = this.target_;
    if (target === null) return new Rect();
    const objs: LekhObject[] = targetObjects(target);
    if (!isMulti(target)) objs.push(target);
    let rect: Rect | null = null;
    for (const o of objs) {
      let r: Rect;
      if (o instanceof TemplatedObject) r = o.ds.rect();
      else if (o instanceof ConnectionObject) r = o.selectionRect();
      else continue;
      rect = rect === null ? r : rect.includeRect(r);
    }
    return rect ?? new Rect();
  }
}

// ---------------------------------------------------------------------------------------------
// ColorEditor

export const ColorType = Object.freeze({ Text: 0, Line: 1, Fill: 2, Background: 3 } as const);
export type ColorType = (typeof ColorType)[keyof typeof ColorType];

/** C++ `ColorEditor`: the swatch grid, brightness and opacity of one colour attribute. */
export class ColorEditor {
  private styleEditor_: StyleEditor | null = null;
  private currentIndex_ = 0;
  private groupStartIndex_ = 0;
  private groupSize_ = 1;
  private type_: ColorType = ColorType.Line;
  private colors_: Color[] = [];
  private colorSet_: Color[] = [];

  /** C++ `init`. */
  init(ct: ColorType, groupSize: number, se: StyleEditor | null): void {
    this.type_ = ct;
    this.groupSize_ = Math.max(1, groupSize);
    this.styleEditor_ = se;
    this.colorSet_ = [];
    let palette: readonly Color[] = LEKH_COLORS;
    if (ct === ColorType.Background) {
      palette = BACKGROUND_COLORS;
    } else {
      this.colorSet_.push(ct === ColorType.Fill ? new Color(255, 255, 255, 0) : new Color(153, 153, 153, 255));
    }
    for (const cl of palette) this.colorSet_.push(ct === ColorType.Fill ? cl.withAlpha(230) : cl);
    this.colors_ = this.colorSet_.slice();
    this.currentIndex_ = 0;
    this.groupStartIndex_ = 0;
  }

  colors(): readonly Color[] {
    return this.colors_;
  }

  groupStartIndex(): number {
    return this.groupStartIndex_;
  }

  currentIndex(): number {
    return this.currentIndex_;
  }

  /** C++ `setColorFromPaint`: no paint reads as transparent white. */
  setColorFromPaint(paint: Paint): void {
    if (paint.type === PaintType.NoPaint) this.setColor(new Color(255, 255, 255, 0));
    else this.setColor(paint.solidColor);
  }

  /** C++ `setColor`: selects the nearest swatch (by RGB distance) and shows `color` in it. */
  setColor(color: Color): void {
    this.colors_[this.currentIndex_] = this.colorSet_[this.currentIndex_] as Color;
    const start = this.type_ === ColorType.Fill ? 1 : 0;
    if (color.alpha === 0 && this.colorSet_[0]?.alpha === 0) {
      this.currentIndex_ = 0;
    } else {
      let dist = Number.MAX_VALUE;
      for (let i = start; i < this.colorSet_.length; i++) {
        const d = ColorEditor.cdist(color, this.colorSet_[i] as Color);
        if (d < dist) {
          dist = d;
          this.currentIndex_ = i;
        }
      }
    }
    this.colors_[this.currentIndex_] = color;
    this.groupStartIndex_ = Math.trunc(this.currentIndex_ / this.groupSize_) * this.groupSize_;
  }

  currentColor(): Color {
    return this.colors_[this.currentIndex_] ?? new Color();
  }

  setCurrentColor(color: Color): void {
    this.colors_[this.currentIndex_] = color;
    this.updateShape();
  }

  private static cdist(a: Color, b: Color): number {
    const d1 = a.red - b.red;
    const d2 = a.green - b.green;
    const d3 = a.blue - b.blue;
    return Math.sqrt(d1 * d1 + d2 * d2 + d3 * d3);
  }

  /** In [0, 1]. */
  opacity(): number {
    return this.currentColor().alpha / 255;
  }

  /** C++ `setOpacity`: the alpha is `val * 255`, truncated as the 8-bit channel took it. */
  setOpacity(val: number): void {
    this.colors_[this.currentIndex_] = this.currentColor().withAlpha(Math.trunc(val * 255));
    this.updateShape();
  }

  /** In [0, 100]. */
  brightness(): number {
    return this.currentColor().toHsv().v * 100;
  }

  setBrightness(val: number): void {
    const hsv = this.currentColor().toHsv();
    const cl = Color.fromHsv({ h: hsv.h, s: hsv.s, v: val / 100 }).withAlpha(this.currentColor().alpha);
    this.setColor(cl);
    this.updateShape();
  }

  setIndex(index: number): void {
    if (index === this.currentIndex_ || index >= this.colorSet_.length) return;
    this.colors_[this.currentIndex_] = this.colorSet_[this.currentIndex_] as Color;
    this.currentIndex_ = index;
    this.groupStartIndex_ = Math.trunc(this.currentIndex_ / this.groupSize_) * this.groupSize_;
    this.updateShape();
  }

  private updateShape(): void {
    const se = this.styleEditor_;
    if (se === null) return;
    if (this.type_ === ColorType.Text) se.setTextColor(this.currentColor());
    else if (this.type_ === ColorType.Line) se.setLineColor(this.currentColor());
    else se.setFillColor(this.currentColor());
  }
}

// ---------------------------------------------------------------------------------------------
// ConnectionEditor

/** C++ `ConnectionEditor`: connector type and arrowheads of the selection. */
export class ConnectionEditor {
  private readonly ctx_: EditorContext;
  private readonly arrowheads_: () => readonly ShapeTemplate[];
  private templates_: ShapeTemplate[] = [];
  private obj_: LekhObject | null = null;

  /** `arrowheads` gives the catalog's arrowheads (C++ `TemplateStore::arrows()`, by id). */
  constructor(ctx: EditorContext, arrowheads: () => readonly ShapeTemplate[]) {
    this.ctx_ = ctx;
    this.arrowheads_ = arrowheads;
  }

  /** C++ `start(obj)`: loaded copies of the arrowheads, by library priority. */
  start(target: EditTarget | null): void {
    this.templates_ = this.arrowheads_().map((a) => {
      const t = a.clone();
      t.load();
      return t;
    });
    this.templates_.sort((a, b) => a.libraryViewAttr.priority - b.libraryViewAttr.priority);
    this.obj_ = target === null || isMulti(target) ? null : target;
  }

  /** The arrowhead choices, in picker order (index + 1 is the arrow type; 0 is none). */
  arrowTemplates(): readonly ShapeTemplate[] {
    return this.templates_;
  }

  private get connection(): ConnectionObject | null {
    return this.obj_ instanceof ConnectionObject ? this.obj_ : null;
  }

  /** C++ `detectSelectionChange`. */
  detectSelectionChange(target: EditTarget | null): boolean {
    const next = target === null || isMulti(target) ? null : target;
    const changed = next !== this.obj_;
    this.obj_ = next;
    return changed;
  }

  /** C++ `isEnabled`. */
  isEnabled(): boolean {
    return this.connection !== null || this.isArrowObject();
  }

  /** C++ `isArrowObject`: an arrow object with arrow points. */
  isArrowObject(): boolean {
    return arrowsOf(this.obj_) !== null && arrowPointCount(this.obj_) > 0;
  }

  /** C++ `changeConnection`: 0 curve, 1 straight, 2 multi-line. A self-loop cannot be straight. */
  changeConnection(type: number): void {
    const con = this.connection;
    if (con === null || type === this.getConnectionType()) return;
    if (type === ConnectionType.GenericLine && con.isSelfLoop()) return;
    const oldParams = con.getParams();
    const oldType = con.getType();
    if (type === 0) con.changeTypeTo(ConnectionType.Curve);
    else if (type === 1) con.changeTypeTo(ConnectionType.GenericLine);
    else if (type === 2) con.changeTypeTo(ConnectionType.MultiLine);
    this.ctx_.tx.record(
      new ChangeConnectionAction(this.ctx_.env, this.ctx_.doc, con, con.getType(), con.getParams(), oldType, oldParams),
    );
  }

  getConnectionType(): number {
    return this.connection?.getType() ?? -1;
  }

  arrowCount(): number {
    return this.templates_.length + 1;
  }

  private templateIndex(id: string): number {
    const i = this.templates_.findIndex((t) => t.id() === id);
    return i + 1;
  }

  startArrowType(): number {
    const t = arrowsOf(this.obj_)?.start() ?? null;
    return t === null ? 0 : this.templateIndex(t.id());
  }

  endArrowType(): number {
    const t = arrowsOf(this.obj_)?.end() ?? null;
    return t === null ? 0 : this.templateIndex(t.id());
  }

  private templateOf(type: number): ShapeTemplate | null {
    if (type === 0 || type > this.templates_.length) return null;
    return this.templates_[type - 1] ?? null;
  }

  setStartArrow(type: number): void {
    const obj = this.obj_;
    if (obj === null || arrowsOf(obj) === null || this.startArrowType() === type) return;
    const oldT = this.templateOf(this.startArrowType());
    const newT = this.templates_[type - 1] ?? null;
    if (oldT === null && newT === null) return;
    this.ctx_.tx.run(new ArrowChangeAction(this.ctx_.env, this.ctx_.doc, obj, oldT, newT, null, null));
  }

  setEndArrow(type: number): void {
    const obj = this.obj_;
    if (obj === null || arrowsOf(obj) === null || this.endArrowType() === type) return;
    const oldT = this.templateOf(this.endArrowType());
    const newT = this.templates_[type - 1] ?? null;
    if (oldT === null && newT === null) return;
    this.ctx_.tx.run(new ArrowChangeAction(this.ctx_.env, this.ctx_.doc, obj, null, null, oldT, newT));
  }

  /** C++ `swapArrows`. */
  swapArrows(): void {
    const obj = this.obj_;
    if (obj === null) return;
    const t1 = this.startArrowType();
    const t2 = this.endArrowType();
    if (t1 === t2) return;
    const s = this.templateOf(t1);
    const e = this.templateOf(t2);
    this.ctx_.tx.run(new ArrowChangeAction(this.ctx_.env, this.ctx_.doc, obj, s, e, e, s));
  }
}

// ---------------------------------------------------------------------------------------------
// PageEditor

export const PageOrientation = Object.freeze({ None: 0, Landscape: 1, Portrait: 2 } as const);
export type PageOrientation = (typeof PageOrientation)[keyof typeof PageOrientation];

/** C++ `PageEditor`: pages, page size and margin, grid and background. */
export class PageEditor {
  private readonly ctx_: EditorContext;
  private editingSize_ = false;

  constructor(ctx: EditorContext) {
    this.ctx_ = ctx;
  }

  start(): void {
    this.editingSize_ = false;
  }

  page(): Page {
    return this.ctx_.doc.activePage();
  }

  numPages(): number {
    return this.ctx_.doc.pages.length;
  }

  getPageName(i: number): string {
    return this.ctx_.doc.pages[i]?.name ?? '';
  }

  getPageId(i: number): string {
    return this.ctx_.doc.pages[i]?.id ?? '';
  }

  setPageName(i: number, name: string): void {
    const page = this.ctx_.doc.pages[i];
    if (page === undefined) return;
    this.ctx_.tx.run(new SetPageNameAction(this.ctx_.env, this.ctx_.doc, page, page.name, name));
  }

  /** C++ `addPage`: a copy of the active page's attributes, last. */
  addPage(name: string): void {
    const doc = this.ctx_.doc;
    const page = doc.activePage().cloneWithoutObjects(doc.newId());
    page.name = name;
    this.ctx_.tx.run(new AddPageAction(this.ctx_.env, doc, page, doc.pages.length));
  }

  /** C++ `duplicatePage`: the page with copies of its objects, after it, named `<name>-copy`. */
  duplicatePage(i: number): void {
    const doc = this.ctx_.doc;
    const page = doc.pages[i];
    if (page === undefined) return;
    const copy = page.cloneWithoutObjects(doc.newId());
    for (const o of cloneObjects(page.objectStore.objects, true, page.objectStore.size).clones) copy.objectStore.add(o);
    copy.name = `${page.name}-copy`;
    this.ctx_.tx.run(new AddPageAction(this.ctx_.env, doc, copy, i + 1));
  }

  /** C++ `deletePage`: never the last page. */
  deletePage(i: number): void {
    const doc = this.ctx_.doc;
    if (doc.pages.length < 2) return;
    const page = doc.pages[i];
    if (page === undefined) return;
    page.order = i;
    this.ctx_.tx.run(new DeletePageAction(this.ctx_.env, doc, page));
  }

  reorder(i: number, to: number): void {
    const doc = this.ctx_.doc;
    if (i < 0 || i >= doc.pages.length) return;
    this.ctx_.tx.run(new ReorderPageAction(this.ctx_.env, doc, i, to));
  }

  /**
   * C++ `select`: makes page `i` active. True when it changed pages (the caller dismisses a shape
   * picker whose source is gone, C++ `ShapePickerViewManager::dismissIfSourceGone`).
   */
  select(i: number): boolean {
    const doc = this.ctx_.doc;
    if (i < 0 || i >= doc.pages.length) return false;
    const was = doc.activePageIndex;
    doc.setActivePageIndex(i);
    return was !== i;
  }

  activePageIndex(): number {
    return this.ctx_.doc.activePageIndex;
  }

  /** C++ `setSize`: a fixed size of 0 becomes auto; continued edits extend the last step. */
  setSize(st: CanvasSizeType, sz: PageSize, name: string): void {
    const doc = this.ctx_.doc;
    const page = doc.activePage();
    const top = this.ctx_.undo.topUndo();
    if (this.editingSize_ && top instanceof PageSizeChangeAction) {
      top.setNewName(name);
      top.setNewType(st);
      top.setNewSize(sz);
      top.perform();
    } else {
      const old = { type: page.canvasSizeType, size: page.size, name: page.canvasName };
      const cur =
        st === CanvasSizeType.Fixed && (sz.width <= 0 || sz.height <= 0)
          ? { type: CanvasSizeType.Auto, size: page.size, name }
          : { type: st, size: sz, name };
      this.ctx_.tx.run(new PageSizeChangeAction(this.ctx_.env, doc, page, old, cur));
    }
    this.editingSize_ = true;
  }

  getCanvasName(): string {
    return this.page().canvasName;
  }

  getCanvasType(): CanvasSizeType {
    return this.page().canvasSizeType;
  }

  getCanvasTypeOfPage(i: number): CanvasSizeType {
    return this.ctx_.doc.pages[i]?.canvasSizeType ?? CanvasSizeType.Auto;
  }

  getSize(): PageSize {
    return this.page().size;
  }

  /** C++ `getExportPageSize`: the objects' bounds, or the full page. */
  getExportPageSize(i: number, fullPage: boolean): CanvasSize {
    const page = this.ctx_.doc.pages[i];
    if (page === undefined) return { width: 0, height: 0, offsetx: 0, offsety: 0 };
    if (fullPage) return page.getCanvasSize(true);
    page.objectStore.flushLayout();
    const r = page.objectStore.hit.boundsOfAll();
    return { width: r.width, height: r.height, offsetx: r.x, offsety: r.y };
  }

  getMarginSize(): PageMargin {
    return this.page().margin;
  }

  /** C++ `setMarginSize`: a size of 0 hides the margin; continued edits extend the last step. */
  setMarginSize(sz: PageSize): void {
    const margin: PageMargin = { show: !(sz.width <= 0 || sz.height <= 0), size: sz };
    const doc = this.ctx_.doc;
    const top = this.ctx_.undo.topUndo();
    if (this.editingSize_ && top instanceof SetPageMarginAction) {
      top.setNewMargin(margin);
      top.perform();
    } else {
      this.ctx_.tx.run(new SetPageMarginAction(this.ctx_.env, doc, doc.activePage(), doc.activePage().margin, margin));
    }
    this.editingSize_ = true;
  }

  setGrid(val: boolean): void {
    this.ctx_.tx.run(new ChangeGridAction(this.ctx_.env, this.ctx_.doc, val));
  }

  orientation(): PageOrientation {
    const p = this.page();
    if (p.canvasSizeType !== CanvasSizeType.Fixed) return PageOrientation.None;
    return p.size.width > p.size.height ? PageOrientation.Landscape : PageOrientation.Portrait;
  }

  setOrientation(o: PageOrientation): void {
    const p = this.page();
    if (p.canvasSizeType !== CanvasSizeType.Fixed) return;
    const sz = p.size;
    if (o === PageOrientation.Landscape && sz.width >= sz.height) return;
    if (o === PageOrientation.Portrait && sz.width <= sz.height) return;
    this.setSize(p.canvasSizeType, new PageSize(sz.unit, sz.height, sz.width), p.canvasName);
  }

  setBackground(bg: PageBackground): void {
    const old = this.page().background;
    if (old.equals(bg)) return;
    this.ctx_.tx.run(new BackgroundChangeAction(this.ctx_.env, this.ctx_.doc, old, bg));
  }
}

// ---------------------------------------------------------------------------------------------
// PropertyEditor

/** The value kinds the property panel edits (C++ `JsonNode::Type` of the value). */
export type ParamValueType = 'none' | 'int' | 'float' | 'bool' | 'string' | 'object' | 'array';

function valueType(v: JsonValue): ParamValueType {
  if (v === null) return 'none';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string') return 'string';
  return Array.isArray(v) ? 'array' : 'object';
}

/** C++ `PropertyEditor`: a templated object's parameters. */
export class PropertyEditor {
  private readonly ctx_: EditorContext;
  private tobj_: TemplatedObject | null = null;
  private oldParams_: TemplateParam[] = [];

  constructor(ctx: EditorContext) {
    this.ctx_ = ctx;
  }

  /** C++ `start(obj)` / `start()` (a templated selection). */
  start(target: EditTarget | null): void {
    this.tobj_ = target instanceof TemplatedObject && target.shapeTemplate() !== null ? target : null;
  }

  finish(): void {
    /* C++: nothing */
  }

  obj(): TemplatedObject | null {
    return this.tobj_;
  }

  private params(): TemplateParam[] | null {
    return this.tobj_?.shapeTemplate()?.params ?? null;
  }

  isValid(): boolean {
    return this.params() !== null;
  }

  propsCount(): number {
    return this.params()?.length ?? 0;
  }

  getValueType(i: number): ParamValueType {
    const p = this.params()?.[i];
    return p === undefined ? 'none' : valueType(p.value);
  }

  getIntVal(i: number): number {
    const v = this.params()?.[i]?.value;
    return typeof v === 'number' ? Math.trunc(v) : 0;
  }

  getFloatVal(i: number): number {
    const v = this.params()?.[i]?.value;
    return typeof v === 'number' ? v : 0;
  }

  getBoolVal(i: number): boolean {
    return this.params()?.[i]?.value === true;
  }

  getStringVal(i: number): string {
    const v = this.params()?.[i]?.value;
    return typeof v === 'string' ? v : '';
  }

  setIntVal(i: number, val: number): void {
    this.setVal(i, Math.trunc(val));
  }

  setFloatVal(i: number, val: number): void {
    this.setVal(i, val);
  }

  setBoolVal(i: number, val: boolean): void {
    this.setVal(i, val);
  }

  setStringVal(i: number, val: string): void {
    this.setVal(i, val);
  }

  private setVal(i: number, v: JsonValue): void {
    const params = this.params();
    const p = params?.[i];
    if (params === null || p === undefined || jsonEquals(p.value, v)) return;
    this.oldParams_ = params.map((x) => x.clone());
    p.value = v;
    this.onUpdate();
  }

  isHidden(i: number): boolean {
    return this.paramInfo(i)?.type === ParamEditorType.Hidden;
  }

  paramInfo(i: number): TemplateParamEditor | null {
    return this.params()?.[i]?.editor ?? null;
  }

  getName(i: number): string {
    return this.params()?.[i]?.name ?? '';
  }

  getDisplayName(i: number): string {
    const p = this.params()?.[i];
    if (p === undefined) return '';
    return p.display !== '' ? p.display : p.name;
  }

  getHelpText(): string {
    const stl = this.tobj_?.shapeTemplate() ?? null;
    return stl === null ? '' : this.ctx_.help(stl.id());
  }

  /**
   * C++ `onUpdate`: reload the template; when its generator rewrites part of the text
   * (`doesPartialTextManipulation`) and the texts changed, the step records the texts too.
   */
  private onUpdate(): void {
    const tobj = this.tobj_;
    const stl = tobj?.shapeTemplate() ?? null;
    if (tobj === null || stl === null) return;
    const captureText = stl.generator?.doesPartialTextManipulation() === true;
    const oldTexts: TextInfo[] = captureText ? stl.textData.map((t) => t.clone()) : [];
    stl.load();
    tobj.generateData();
    const newTexts: TextInfo[] = captureText ? stl.textData.map((t) => t.clone()) : [];
    const env = this.ctx_.env;
    const doc = this.ctx_.doc;
    if (captureText && !textsEqual(oldTexts, newTexts)) {
      this.ctx_.tx.record(
        new TemplateParamChangeAction(env, doc, tobj, stl.params, this.oldParams_, newTexts, oldTexts),
      );
    } else {
      this.ctx_.tx.record(new TemplateParamChangeAction(env, doc, tobj, stl.params, this.oldParams_));
    }
  }
}

function textsEqual(a: readonly TextInfo[], b: readonly TextInfo[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => t.equals(b[i] as TextInfo));
}
