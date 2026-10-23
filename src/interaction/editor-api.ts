// What the React panels call (spec 05 §6.3: `StyleEditorApi`, `ColorEditorApi`,
// `ConnectionEditorApi`, `PageEditorApi`, `PropertyEditorApi`, `SettingsApi`): the UI half of the
// C++ view managers' editor use (`StrokeAttrViewManager`, `ColorPicker`, `TextAttrViewManager`,
// `ConnectionAttrViewManager`, `PropertyEditorViewManager`, `ManagePagesViewManager`, the settings
// screens and `SetSizeViewManager`), over the engine editors of `edit/editors.ts`. React never
// touches a `Style`: it reads `BoardUiState` (and the small state objects returned here) and calls
// one method per C++ setter. Every document change runs as one command on the session's queue
// (`board.edit`), so it is one undo step with its realtime update, as today; a continued change
// of one kind (a slider drag) extends the last step, as the C++ editors did.
import { SHAPE_CONNECTION_DEFAULT_GAP, type LiveConfig, type ConfigOverrides } from '../base';
import {
  ChangeScalingAction,
  ColorEditor,
  ColorType,
  ConnectionEditor,
  ExpandAction,
  PageEditor,
  PageOrientation,
  PropertyEditor,
  RotateAction,
  StyleEditor,
  isMulti,
  targetStyle,
  type EditTarget,
  type EditorContext,
  type ParamValueType,
} from '../edit';
import { Point, Rect, Size } from '../geometry';
import { CanvasSizeType, ConnectionObject, PageBackground, PageSize, TemplatedObject } from '../model';
import type { DrawingPlatform } from '../render';
import {
  Color,
  POINTS_PER_INCH,
  Scaling,
  Style,
  TextAlignHorizontal,
  TextAlignVertical,
  Unit,
  type TextAlignHorizontal as TAH,
} from '../style';
import { DataStore, type ShapeTemplate, ParamEditorType } from '../template';
import type { InteractionBoard } from './board';
import type { OverlayLayer } from './overlay-layer';
import type { StyleEditorApi } from './ui-types';

/** Whose style a panel edits: the selection, or the canvas style new strokes take (the pen popup). */
export type StyleTarget = 'selection' | 'canvas';

/** C++ `ColorEditor::ColorType`, by name. */
export type ColorKind = 'line' | 'fill' | 'text' | 'background';

/** What the editors need from the board view. */
export interface EditorHost {
  readonly board: InteractionBoard;
  /** The session's edit context (the editors' C++ singletons: undo stack, transaction helper). */
  readonly editor: EditorContext;
  readonly overlay: OverlayLayer;
  /** The catalog's arrowheads (C++ `TemplateStore::arrows()`). */
  arrowheads(): readonly ShapeTemplate[];
  /** The runtime's settings (the `SettingsApi`). */
  readonly settings: LiveConfig;
  /** After an edit: the selection rectangle follows and the UI state republishes. */
  changed(): void;
}

/** A CSS colour (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`), or null. */
export function parseCssColor(css: string): Color | null {
  const s = css.trim().toLowerCase();
  if (s === 'transparent') return new Color(255, 255, 255, 0);
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex !== null) {
    let h = hex[1] as string;
    if (h.length === 3) h = h.replace(/./g, (c) => c + c);
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return new Color(n(0), n(2), n(4), h.length === 8 ? n(6) : 255);
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m === null) return null;
  const a = m[4] === undefined ? 255 : Math.round(Number(m[4]) * 255);
  return new Color(Math.round(Number(m[1])), Math.round(Number(m[2])), Math.round(Number(m[3])), a);
}

/** C++ `StyleEditor::setDashType` names: 0 solid, `dash` 4 4, `dot` 2 2. */
function dashArrayOf(d: 'solid' | 'dash' | 'dot', width: number): number[] {
  if (d === 'solid') return [];
  return d === 'dot' ? [width, width] : [width * 4, width * 4];
}

// ---------------------------------------------------------------------------------------------
// Style

/** The text attributes a `setText` call may change (spec 05 §6.3 `StyleSnapshot['text']`). */
export interface TextStyleChange {
  readonly family?: string;
  readonly size?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly color?: string;
  readonly align?: 'left' | 'center' | 'right';
}

/**
 * C++ `StyleEditor` for a panel: the selection's drawing profile (`setTarget(obj)` +
 * `start(obj->getDrawingProfile())`), or with `canvas` the current drawing style (`start()`).
 */
export class StyleApi implements StyleEditorApi {
  private readonly host_: EditorHost;
  private readonly target_: StyleTarget;
  private readonly editor_: StyleEditor;
  private started_: EditTarget | null | undefined = undefined;

  constructor(host: EditorHost, target: StyleTarget) {
    this.host_ = host;
    this.target_ = target;
    this.editor_ = new StyleEditor(host.editor, host.board.currentStyle());
  }

  /** The style this panel edits now (re-started when the selection changed). */
  private ensure(): StyleEditor {
    const t = this.target_ === 'canvas' ? null : this.host_.overlay.selectionTarget();
    if (t !== this.started_) {
      this.editor_.start(t, t === null ? undefined : targetStyle(t));
      this.started_ = t;
    }
    return this.editor_;
  }

  private run(fn: (se: StyleEditor) => void): void {
    if (this.target_ === 'selection' && this.host_.overlay.selectionTarget() === null) return;
    this.host_.board.edit(() => {
      fn(this.ensure());
    });
    this.host_.board.requestPaint('drawing');
    this.host_.changed();
  }

  /** The style's dash array (the stroke panel's Line Dash). */
  dashArray(): readonly number[] {
    return this.ensure().style().effectiveDashArray();
  }

  /** The vertical alignment (the text panel's second row). */
  verticalAlign(): 'top' | 'center' | 'bottom' {
    const v = this.ensure().style().effectiveTextAlignVertical();
    return v === TextAlignVertical.Top ? 'top' : v === TextAlignVertical.Bottom ? 'bottom' : 'center';
  }

  setStrokeColor(c: string): void {
    const cl = parseCssColor(c);
    if (cl !== null)
      this.run((se) => {
        se.setLineColor(cl);
      });
  }

  setStrokeWidth(w: number): void {
    if (!(w > 0)) return;
    this.run((se) => {
      se.setStrokeWidth(w);
    });
  }

  setDash(d: 'solid' | 'dash' | 'dot'): void {
    this.run((se) => {
      se.setLineDash(dashArrayOf(d, se.style().effectiveStrokeWidth()));
    });
  }

  /** C++ the dash picker's `setLineDash({i*2, i*2})` (row 0 is solid). */
  setDashArray(arr: readonly number[]): void {
    const a = arr.length === 2 && arr[0] === 0 && arr[1] === 0 ? [] : arr.slice();
    this.run((se) => {
      se.setLineDash(a);
    });
  }

  setFill(c: string): void {
    const cl = c === 'none' ? new Color(255, 255, 255, 0) : parseCssColor(c);
    if (cl !== null)
      this.run((se) => {
        se.setFillColor(cl);
      });
  }

  setText(p: TextStyleChange): void {
    this.run((se) => {
      if (p.family !== undefined) se.setFontFamily(p.family);
      if (p.size !== undefined) se.setFontSize(Math.max(0.5, p.size));
      if (p.bold !== undefined) se.setBold(p.bold);
      if (p.italic !== undefined) se.setItalic(p.italic);
      if (p.underline !== undefined) se.setUnderline(p.underline);
      if (p.strike !== undefined) se.setStrikethrough(p.strike);
      if (p.color !== undefined) {
        const cl = parseCssColor(p.color);
        if (cl !== null) se.setTextColor(cl);
      }
      if (p.align !== undefined) {
        const a: TAH =
          p.align === 'left'
            ? TextAlignHorizontal.Left
            : p.align === 'right'
              ? TextAlignHorizontal.Right
              : TextAlignHorizontal.Center;
        se.setHorizontalAlignment(a);
      }
    });
  }

  setVerticalAlign(v: 'top' | 'center' | 'bottom'): void {
    const a =
      v === 'top' ? TextAlignVertical.Top : v === 'bottom' ? TextAlignVertical.Bottom : TextAlignVertical.Center;
    this.run((se) => {
      se.setVerticalAlignment(a);
    });
  }

  /** Round / sharp corners are selection-menu actions (C++ `RoundCornerMenuItem`). */
  setCorner(): void {
    /* the selection menu's catalog entries do this */
  }

  /** The text panel's font size field starts the next size change as a new step (C++ new editor). */
  finish(): void {
    this.editor_.finish();
  }
}

// ---------------------------------------------------------------------------------------------
// Colour picker

/** One colour picker's state (C++ `ColorPicker` over its `ColorEditor`). */
export interface ColorPickerState {
  /** The swatches, CSS `rgba(…)`; index 0 of line / text / fill is the "none" swatch. */
  readonly colors: readonly string[];
  readonly index: number;
  /** In [0, 100]. */
  readonly brightness: number;
  /** In [0, 100]. */
  readonly opacity: number;
}

const COLOR_TYPES: Readonly<Record<ColorKind, ColorType>> = Object.freeze({
  line: ColorType.Line,
  fill: ColorType.Fill,
  text: ColorType.Text,
  background: ColorType.Background,
});

/** C++ `ColorPicker::setType` + its handlers. */
export class ColorPickerApi {
  private readonly host_: EditorHost;
  private readonly kind_: ColorKind;
  private readonly style_: StyleApi | null;
  private readonly colors_ = new ColorEditor();
  private readonly styleEditor_: StyleEditor | null;
  private started_: EditTarget | null | undefined = undefined;
  private readonly target_: StyleTarget;

  constructor(host: EditorHost, kind: ColorKind, target: StyleTarget) {
    this.host_ = host;
    this.kind_ = kind;
    this.target_ = target;
    this.style_ = null;
    this.styleEditor_ = kind === 'background' ? null : new StyleEditor(host.editor, host.board.currentStyle());
    this.load();
  }

  /** C++ `setType`: the swatches, and the swatch nearest the current colour. */
  private load(): void {
    const ce = this.colors_;
    if (this.kind_ === 'background') {
      ce.init(ColorType.Background, 6, null);
      const back = this.host_.board.page().background;
      ce.setColor(back.type !== 1 ? back.color : new Color(255, 255, 255));
      return;
    }
    const se = this.styleEditor_ as StyleEditor;
    const t = this.target_ === 'canvas' ? null : this.host_.overlay.selectionTarget();
    se.start(t, t === null ? undefined : targetStyle(t));
    this.started_ = t;
    ce.init(COLOR_TYPES[this.kind_], 6, se);
    const st = se.style();
    const paint =
      this.kind_ === 'line'
        ? st.effectiveStrokePaint()
        : this.kind_ === 'fill'
          ? st.effectiveFillPaint()
          : st.effectiveTextFill();
    // C++: a default or no paint reads as transparent black.
    if (paint.type === 0 || paint.type === 1) ce.setColor(new Color(0, 0, 0, 0));
    else ce.setColor(paint.solidColor);
  }

  state(): ColorPickerState {
    const ce = this.colors_;
    return Object.freeze({
      colors: ce.colors().map((c) => c.toCss()),
      index: ce.currentIndex(),
      brightness: ce.brightness(),
      opacity: ce.opacity() * 100,
    });
  }

  private run(fn: (ce: ColorEditor) => void): void {
    if (this.kind_ === 'background') {
      fn(this.colors_);
      const pe = new PageEditor(this.host_.editor);
      const bg = new PageBackground();
      bg.setColor(this.colors_.currentColor());
      this.host_.board.edit(() => {
        pe.setBackground(bg);
      });
      this.host_.board.requestPaint('grid');
      this.host_.board.setView({});
      this.host_.changed();
      return;
    }
    const se = this.styleEditor_ as StyleEditor;
    if (this.target_ === 'selection') {
      const t = this.host_.overlay.selectionTarget();
      if (t === null) return;
      if (t !== this.started_) {
        se.start(t, targetStyle(t));
        this.started_ = t;
      }
    }
    this.host_.board.edit(() => {
      fn(this.colors_);
    });
    this.host_.board.requestPaint('drawing');
    this.host_.changed();
  }

  /** A swatch tap (C++ `colorPicked`). */
  setIndex(i: number): void {
    this.run((ce) => {
      ce.setIndex(i);
    });
  }

  /** The brightness slider, in [0, 100] (C++ clamps it to at least 1). */
  setBrightness(v: number): void {
    this.run((ce) => {
      ce.setBrightness(Math.max(1, v));
    });
  }

  /** The opacity slider, in [0, 100]. */
  setOpacity(v: number): void {
    this.run((ce) => {
      ce.setOpacity(v / 100);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Connection

export interface ConnectionState {
  /** The selection is a connector (the type row shows). */
  readonly isConnection: boolean;
  /** A self-loop has no straight routing. */
  readonly isSelfLoop: boolean;
  /** 0 curve, 1 straight, 2 multi-line; -1 for an arrow object. */
  readonly type: number;
  readonly startArrow: number;
  readonly endArrow: number;
  /** Arrow choices, `none` included. */
  readonly arrowCount: number;
}

/** C++ `ConnectionAttrViewManager` over `ConnectionEditor`. */
export class ConnectionApi {
  private readonly host_: EditorHost;
  private readonly editor_: ConnectionEditor;
  private target_: EditTarget | null = null;

  constructor(host: EditorHost) {
    this.host_ = host;
    this.editor_ = new ConnectionEditor(host.editor, () => host.arrowheads());
    this.target_ = host.overlay.selectionTarget();
    this.editor_.start(this.target_);
  }

  private sync(): void {
    const t = this.host_.overlay.selectionTarget();
    if (t !== this.target_) {
      this.target_ = t;
      this.editor_.start(t);
    }
  }

  state(): ConnectionState {
    this.sync();
    const t = this.target_;
    const con = t instanceof ConnectionObject ? t : null;
    return Object.freeze({
      isConnection: con !== null,
      isSelfLoop: con?.isSelfLoop() ?? false,
      type: this.editor_.getConnectionType(),
      startArrow: this.editor_.startArrowType(),
      endArrow: this.editor_.endArrowType(),
      arrowCount: this.editor_.arrowCount(),
    });
  }

  private run(fn: (e: ConnectionEditor) => void): void {
    this.sync();
    if (this.target_ === null || isMulti(this.target_)) return;
    this.host_.board.edit(() => {
      fn(this.editor_);
    });
    this.host_.board.requestPaint('drawing');
    this.host_.changed();
  }

  changeConnection(type: number): void {
    this.run((e) => {
      e.changeConnection(type);
    });
  }

  setStartArrow(type: number): void {
    this.run((e) => {
      e.setStartArrow(type);
    });
  }

  setEndArrow(type: number): void {
    this.run((e) => {
      e.setEndArrow(type);
    });
  }

  swapArrows(): void {
    this.run((e) => {
      e.swapArrows();
    });
  }

  /**
   * C++ `ConnectionEditor::drawArraw` (the `ArrowView` cells): a line across `size` with arrow
   * `type` at its end (`start` points left, else right), in `color`, on `dp`.
   */
  drawArrow(dp: DrawingPlatform, type: number, start: boolean, size: Size, color: string): void {
    const c = new Point(size.width / 2, size.height / 2);
    const sz = new Size(size.width - 4, size.height - 4);
    const angle = start ? 0 : Math.PI;
    const idx = type - 1;
    const templates = this.editor_.arrowTemplates();
    if (idx >= templates.length) return;
    const tmpl = idx >= 0 ? (templates[idx] as ShapeTemplate) : null;
    const style = tmpl !== null ? (tmpl.getStyle() as unknown as Style) : new Style();
    const cl = parseCssColor(color) ?? new Color();
    style.setStrokeColor(cl);
    if (style.isFillPaintDefined()) style.setFillColor(cl);
    // C++ uses `size.height / 2` for both points' y (the cell's own height, not the centre's).
    const p1 =
      angle === 0 ? new Point(c.x - sz.width / 2, sz.height / 2) : new Point(c.x + sz.width / 2, sz.height / 2);
    const p2 =
      angle === 0 ? new Point(c.x + sz.width / 2, sz.height / 2) : new Point(c.x - sz.width / 2, sz.height / 2);
    dp.startDrawing(p1, style);
    dp.addLineTo(p2);
    dp.endDrawing();
    if (tmpl === null) return;
    const wd = tmpl.defaultAttr.width;
    const ht = tmpl.defaultAttr.height;
    const ds = new DataStore();
    ds.setCx(angle === 0 ? p2.x - wd / 2 : p2.x + wd / 2);
    ds.setCy(p2.y);
    ds.setWidth(wd);
    ds.setHeight(ht);
    ds.setAngle(angle);
    tmpl.generateData(ds);
    tmpl.draw(dp, ds, -1);
  }
}

// ---------------------------------------------------------------------------------------------
// Pages and the canvas (the settings' Canvas screens)

export interface PageRow {
  readonly id: string;
  readonly name: string;
}

/** The page-size choices of C++ `PageSizeViewManager::initSizes` (inches). */
export const PAGE_SIZES: readonly {
  readonly label: string;
  readonly type: CanvasSizeType;
  readonly w: number;
  readonly h: number;
}[] = Object.freeze([
  Object.freeze({ label: 'Auto', type: CanvasSizeType.Auto, w: 0, h: 0 }),
  Object.freeze({ label: 'Infinite', type: CanvasSizeType.Infinite, w: 0, h: 0 }),
  Object.freeze({ label: 'A3 (11.7 x 16.5)', type: CanvasSizeType.Fixed, w: 11.7, h: 16.5 }),
  Object.freeze({ label: 'A4 (8.3 x 11.7)', type: CanvasSizeType.Fixed, w: 8.3, h: 11.7 }),
  Object.freeze({ label: 'A5 (5.8 x 8.3)', type: CanvasSizeType.Fixed, w: 5.8, h: 8.3 }),
  Object.freeze({ label: 'Letter (8.5 x 11)', type: CanvasSizeType.Fixed, w: 8.5, h: 11 }),
  Object.freeze({ label: 'Legal (8.5 x 14)', type: CanvasSizeType.Fixed, w: 8.5, h: 14 }),
  Object.freeze({ label: 'Executive (7.2 x 10.5)', type: CanvasSizeType.Fixed, w: 7.2, h: 10.5 }),
  Object.freeze({ label: 'Tabloid (11 x 17)', type: CanvasSizeType.Fixed, w: 11, h: 17 }),
  Object.freeze({ label: 'Folio (8.5 x 13)', type: CanvasSizeType.Fixed, w: 8.5, h: 13 }),
  Object.freeze({ label: 'Statement (5.5 x 8.5)', type: CanvasSizeType.Fixed, w: 5.5, h: 8.5 }),
  Object.freeze({ label: 'Custom', type: CanvasSizeType.Fixed, w: 0, h: 0 }),
]);

/** A width/height pair in one unit (the Size widget of the page-size and margin screens). */
export interface UnitSize {
  readonly unit: 'point' | 'inch' | 'cm';
  readonly width: number;
  readonly height: number;
}

function unitName(u: Unit): UnitSize['unit'] {
  return u === Unit.Inch ? 'inch' : u === Unit.Centimeter ? 'cm' : 'point';
}

function unitOf(n: UnitSize['unit']): Unit {
  return n === 'inch' ? Unit.Inch : n === 'cm' ? Unit.Centimeter : Unit.Point;
}

/** C++ `SizeWidget::changeUnit`: `size` re-expressed in `unit`. */
export function convertUnitSize(size: UnitSize, unit: UnitSize['unit']): UnitSize {
  if (size.unit === unit) return size;
  const ppi = POINTS_PER_INCH;
  const conv = (v: number): number => {
    if (size.unit === 'point') return unit === 'inch' ? v / ppi : (v / ppi) * 2.54;
    if (size.unit === 'inch') return unit === 'point' ? v * ppi : v * 2.54;
    return unit === 'point' ? (v / 2.54) * ppi : v / 2.54;
  };
  return { unit, width: conv(size.width), height: conv(size.height) };
}

/** C++ `PageEditor` for the pages panel and the canvas settings screens (one per screen). */
export class PageApi {
  private readonly host_: EditorHost;
  private readonly editor_: PageEditor;
  private oldScaling_: Scaling | null = null;

  constructor(host: EditorHost) {
    this.host_ = host;
    this.editor_ = new PageEditor(host.editor);
    this.editor_.start();
  }

  private run(fn: (e: PageEditor) => void): void {
    this.host_.board.edit(() => {
      fn(this.editor_);
    });
    this.host_.board.setView({});
    this.host_.board.requestPaint('grid');
    this.host_.board.requestPaint('drawing');
    this.host_.changed();
  }

  pages(): readonly PageRow[] {
    return this.host_.board.document().pages.map((p) => ({ id: p.id, name: p.name }));
  }

  activePageIndex(): number {
    return this.host_.board.document().activePageIndex;
  }

  /** C++ `PageEditor::select` (a page tap): through the session, so the view and selection reset. */
  select(i: number): void {
    const p = this.host_.board.document().pages[i];
    if (p === undefined) return;
    this.host_.board.command({ kind: 'setActivePage', pageId: p.id });
    this.host_.changed();
  }

  addPage(name: string): void {
    const n = name.trim() === '' ? `Page-${String(this.pages().length + 1)}` : name.trim();
    this.run((e) => {
      e.addPage(n);
    });
  }

  /** C++ `duplicatePage` of the active page, then select the copy. */
  duplicateActive(): void {
    const i = this.activePageIndex();
    this.run((e) => {
      e.duplicatePage(i);
    });
    this.select(i + 1);
  }

  /** C++ `PageList::deletePage`: the active page, then the page at its index (or the last). */
  deleteActive(): void {
    const i = this.activePageIndex();
    this.run((e) => {
      e.deletePage(i);
    });
    const n = this.pages().length;
    this.select(i < n ? i : n - 1);
  }

  renameActive(name: string): void {
    const i = this.activePageIndex();
    const n = name.trim() === '' ? `Page-${String(i + 1)}` : name.trim();
    this.run((e) => {
      e.setPageName(i, n);
    });
  }

  reorder(from: number, to: number): void {
    this.run((e) => {
      e.reorder(from, to);
    });
  }

  // ---- canvas: size, margin, orientation, background, scaling ----

  /** The index into `PAGE_SIZES` the page has (C++ `getSelectedIndex`). */
  pageSizeIndex(): number {
    const p = this.editor_.page();
    if (p.canvasSizeType === CanvasSizeType.Auto) return 0;
    if (p.canvasSizeType === CanvasSizeType.Infinite) return 1;
    const w = p.size.widthInPoints();
    const h = p.size.heightInPoints();
    for (let i = 2; i < PAGE_SIZES.length - 1; i++) {
      const s = PAGE_SIZES[i] as (typeof PAGE_SIZES)[number];
      if (Math.abs(w - s.w * POINTS_PER_INCH) < 0.1 && Math.abs(h - s.h * POINTS_PER_INCH) < 0.1) return i;
    }
    return PAGE_SIZES.length - 1;
  }

  /** C++ `PageSizeViewManager::onSelectionChange`. */
  setPageSizeIndex(idx: number): void {
    const s = PAGE_SIZES[idx];
    if (s === undefined) return;
    if (idx < PAGE_SIZES.length - 1) {
      this.run((e) => {
        e.setSize(s.type, new PageSize(Unit.Inch, s.w, s.h), s.label);
      });
      return;
    }
    const cs = this.editor_.page().getCanvasSize(false);
    this.run((e) => {
      e.setSize(
        CanvasSizeType.Fixed,
        new PageSize(Unit.Inch, cs.width / POINTS_PER_INCH, cs.height / POINTS_PER_INCH),
        s.label,
      );
    });
  }

  pageSize(): UnitSize {
    const sz = this.editor_.getSize();
    return { unit: unitName(sz.unit), width: sz.width, height: sz.height };
  }

  /** The custom size widget's update (C++ `SizeWidget::update`, type PageSize). */
  setCustomSize(sz: UnitSize): void {
    this.run((e) => {
      e.setSize(CanvasSizeType.Fixed, new PageSize(unitOf(sz.unit), sz.width, sz.height), 'Custom');
    });
  }

  /** The margin (a hidden margin reads as 0 × 0, C++ `MarginSizeViewManager`). */
  margin(): UnitSize {
    const m = this.editor_.getMarginSize();
    if (!m.show) return { unit: 'point', width: 0, height: 0 };
    return { unit: unitName(m.size.unit), width: m.size.width, height: m.size.height };
  }

  setMargin(sz: UnitSize): void {
    this.run((e) => {
      e.setMarginSize(new PageSize(unitOf(sz.unit), sz.width, sz.height));
    });
  }

  /** C++ `OrientationViewManager::canChange`. */
  canChangeOrientation(): boolean {
    const t = this.editor_.getCanvasType();
    return t !== CanvasSizeType.Infinite && t !== CanvasSizeType.Auto;
  }

  orientation(): 'landscape' | 'portrait' {
    return this.editor_.orientation() === PageOrientation.Landscape ? 'landscape' : 'portrait';
  }

  setOrientation(o: 'landscape' | 'portrait'): void {
    this.run((e) => {
      e.setOrientation(o === 'landscape' ? PageOrientation.Landscape : PageOrientation.Portrait);
    });
  }

  setGrid(on: boolean): void {
    this.run((e) => {
      e.setGrid(on);
    });
  }

  /** The document's scaling (the Scaling screen). */
  scaling(): {
    readonly enabled: boolean;
    readonly unit: 'inch' | 'cm' | 'point';
    readonly value: number;
    readonly gridSize: string;
  } {
    const doc = this.host_.board.document();
    const s = doc.scaling;
    const gw = doc.gridWidth(true).val * s.value;
    const unitStr = s.unit === Unit.Inch ? 'inch' : s.unit === Unit.Centimeter ? 'cm' : 'point';
    return { enabled: !s.isDefault(), unit: unitName(s.unit), value: s.value, gridSize: `${formatG(gw)} ${unitStr}` };
  }

  /**
   * C++ `DocScaleOptionViewManager::updateScaling`: the screen's changes extend one
   * `ChangeScalingAction` from the scaling it opened with.
   */
  setScaling(next: { readonly enabled: boolean; readonly unit?: 'inch' | 'cm'; readonly value?: number }): void {
    const doc = this.host_.board.document();
    this.oldScaling_ ??= doc.scaling;
    const cur = doc.scaling;
    let s: Scaling;
    if (!next.enabled) s = Scaling.default();
    else if (cur.isDefault()) s = Scaling.inchDefault();
    else s = cur;
    if (next.enabled) {
      const unit = next.unit === undefined ? s.unit : next.unit === 'cm' ? Unit.Centimeter : Unit.Inch;
      const value = next.value === undefined ? s.value : Math.max(1, next.value);
      s = new Scaling(unit, value);
    }
    const old = this.oldScaling_;
    this.host_.board.edit((ctx) => {
      const top = ctx.editor.undo.topUndo();
      if (top instanceof ChangeScalingAction && top.updateAction(old, s)) {
        top.perform();
      } else {
        ctx.editor.tx.run(new ChangeScalingAction(ctx.editor.env, ctx.doc, old, s));
      }
    });
    this.host_.board.requestPaint('grid');
    this.host_.changed();
  }
}

/** `%g`-like: up to 6 significant digits, no trailing zeros (C++ `operator<<` of a double). */
function formatG(v: number): string {
  return String(Number(v.toPrecision(6)));
}

// ---------------------------------------------------------------------------------------------
// Properties

export interface PropertyRow {
  readonly index: number;
  readonly name: string;
  readonly display: string;
  readonly type: ParamValueType;
  /** `enum` for `EnumString` editors, else the value type's editor. */
  readonly editor: 'switch' | 'enum' | 'spinner' | 'slider' | 'none';
  readonly value: boolean | number | string;
  readonly min: number;
  readonly max: number;
  readonly items: readonly string[];
}

/** C++ `PropertyEditorViewManager` over `PropertyEditor`. */
export class PropertyApi {
  private readonly host_: EditorHost;
  private readonly editor_: PropertyEditor;

  constructor(host: EditorHost) {
    this.host_ = host;
    this.editor_ = new PropertyEditor(host.editor);
    this.editor_.start(host.overlay.selectionTarget());
  }

  /** The visible parameters in order, with the editor C++ shows for each (others are left out). */
  rows(): readonly PropertyRow[] {
    const e = this.editor_;
    const out: PropertyRow[] = [];
    for (let i = 0; i < e.propsCount(); i++) {
      if (e.isHidden(i)) continue;
      const info = e.paramInfo(i);
      const type = e.getValueType(i);
      let editor: PropertyRow['editor'] = 'none';
      let value: PropertyRow['value'] = '';
      if (type === 'bool') {
        editor = 'switch';
        value = e.getBoolVal(i);
      } else if (type === 'string') {
        if (info?.type === ParamEditorType.EnumString) editor = 'enum';
        value = e.getStringVal(i);
      } else if (type === 'int') {
        editor = 'spinner';
        value = e.getIntVal(i);
      } else if (type === 'float') {
        editor = 'slider';
        value = e.getFloatVal(i);
      }
      if (editor === 'none') continue;
      out.push({
        index: i,
        name: e.getName(i),
        display: e.getDisplayName(i),
        type,
        editor,
        value,
        min: info?.minVal ?? 0,
        max: info?.maxVal ?? 0,
        items: info?.enumItems ?? [],
      });
    }
    return out;
  }

  /** C++ `sliderLabel`: `<name>: <percent>%`. */
  sliderLabel(row: PropertyRow, cur: number): string {
    const pct = row.max === row.min ? 0 : ((cur - row.min) / (row.max - row.min)) * 100;
    return `${row.display}: ${String(Math.trunc(pct))}%`;
  }

  private run(fn: (e: PropertyEditor) => void): void {
    if (this.editor_.obj() === null) return;
    this.host_.board.edit(() => {
      fn(this.editor_);
    });
    this.host_.board.requestPaint('drawing');
    this.host_.changed();
  }

  setBool(i: number, v: boolean): void {
    this.run((e) => {
      e.setBoolVal(i, v);
    });
  }

  setInt(i: number, v: number): void {
    this.run((e) => {
      e.setIntVal(i, v);
    });
  }

  setFloat(i: number, v: number): void {
    this.run((e) => {
      e.setFloatVal(i, v);
    });
  }

  setString(i: number, v: string): void {
    this.run((e) => {
      e.setStringVal(i, v);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Set size

export interface SetSizeValues {
  readonly width: number;
  readonly height: number;
  readonly cx: number;
  readonly cy: number;
  /** Degrees (C++ `GeoUtil::toDegreeReadable`). */
  readonly angle: number;
  /** "Grid Size" row when the document is scaled, else null. */
  readonly gridSize: string | null;
}

/** C++ `GeoUtil::toDegreeReadable`: [0, 360). */
function toDegreeReadable(rad: number): number {
  let d = (rad * 180) / Math.PI;
  d %= 360;
  if (d < 0) d += 360;
  return d;
}

/**
 * C++ `SetSizeViewManager`: the box fields edit the shape live; closing the panel records one
 * `ExpandAction` (and a `RotateAction` for an angle change), as `viewDidDisappear` did.
 */
export class SetSizeApi {
  private readonly host_: EditorHost;
  private readonly obj_: TemplatedObject | null;
  private readonly start_: { cx: number; cy: number; width: number; height: number; angle: number } | null;

  constructor(host: EditorHost) {
    this.host_ = host;
    const t = host.overlay.selectionTarget();
    this.obj_ = t instanceof TemplatedObject ? t : null;
    const ds = this.obj_?.ds;
    this.start_ =
      ds === undefined ? null : { cx: ds.cx(), cy: ds.cy(), width: ds.width(), height: ds.height(), angle: ds.angle() };
  }

  values(): SetSizeValues | null {
    const o = this.obj_;
    if (o === null) return null;
    const doc = this.host_.board.document();
    const sc = doc.scaling;
    const ds = o.ds;
    return {
      width: sc.pointToUnit(ds.width()),
      height: sc.pointToUnit(ds.height()),
      cx: sc.pointToUnit(ds.cx()),
      cy: sc.pointToUnit(ds.cy()),
      angle: toDegreeReadable(ds.angle()),
      gridSize: sc.isDefault()
        ? null
        : `${formatG(doc.gridWidth(true).val * sc.value)} ${sc.unit === Unit.Inch ? 'inch' : sc.unit === Unit.Centimeter ? 'cm' : 'point'}`,
    };
  }

  /** One field's new value (in the document unit; degrees for the angle). */
  set(field: 'width' | 'height' | 'cx' | 'cy' | 'angle', v: number): void {
    const o = this.obj_;
    if (o === null || !Number.isFinite(v)) return;
    const sc = this.host_.board.document().scaling;
    this.host_.board.edit(() => {
      const ds = o.ds;
      if (field === 'angle') ds.setAngle((v * Math.PI) / 180);
      else {
        const pt = sc.unitToPoint(v);
        if (field === 'width') ds.setWidth(pt);
        else if (field === 'height') ds.setHeight(pt);
        else if (field === 'cx') ds.setCx(pt);
        else ds.setCy(pt);
      }
      o.generateData();
      o.invalidate();
    });
    this.host_.board.requestPaint('drawing');
    this.host_.changed();
  }

  /** The panel closed: the change is recorded as one step (C++ `viewDidDisappear`). */
  close(): void {
    const o = this.obj_;
    const s = this.start_;
    if (o === null || s === null) return;
    // The panel closes with its selection (owner round UF1): after an undo that removed the
    // object, nothing is recorded for it (a step on a removed object would clear the redo stack
    // and send a change for an object the board no longer has).
    if (!this.host_.board.document().pages.some((p) => p.objectStore.entry(o) !== undefined)) return;
    this.host_.board.edit((ctx) => {
      const ds = o.ds;
      if (ds.width() !== s.width || ds.height() !== s.height || ds.cx() !== s.cx || ds.cy() !== s.cy) {
        const r1 = Rect.fromCenter(new Point(s.cx, s.cy), s.width, s.height);
        const r2 = Rect.fromCenter(new Point(ds.cx(), ds.cy()), ds.width(), ds.height());
        ctx.editor.tx.record(new ExpandAction(ctx.editor.env, ctx.doc, o, { old: r1, cur: r2 }));
      }
      const delta = ds.angle() - s.angle;
      if (Math.abs(delta) > 0.000001) ctx.editor.tx.record(new RotateAction(ctx.editor.env, ctx.doc, o, delta));
    });
    this.host_.changed();
  }
}

// ---------------------------------------------------------------------------------------------
// Settings

/** The settings the screens change (C++ `Config::instance()` fields the settings view managers write). */
export type SettingName =
  | 'snapToGrid'
  | 'onlyDrawWithPencil'
  | 'screenMode'
  | 'recognizeConnection'
  | 'resizeInsertedImage'
  | 'shapeConnectionGap'
  | 'resizeShapeByZoomGesture'
  | 'shouldShowInfoButton'
  | 'preventScreenToTurnOff'
  | 'defaultFontSize'
  | 'defaultArrowType'
  | 'defaultConnectionType'
  | 'showConnectionHandles'
  | 'enableAirGesture';

/** `SettingsApi` (spec 05 §6.3): one setter per C++ settings switch, through the runtime's settings. */
export class SettingsApi {
  private readonly host_: EditorHost;

  constructor(host: EditorHost) {
    this.host_ = host;
  }

  /** Sets one setting; returns whether it changed. */
  set(name: SettingName, value: boolean | number): boolean {
    let patch: ConfigOverrides;
    if (name === 'shapeConnectionGap') {
      patch = { connectionLineSeparationFromObject: value === true ? SHAPE_CONNECTION_DEFAULT_GAP : 0 };
    } else if (name === 'defaultFontSize') {
      const v = Number(value);
      if (!(v > 0 && v < 1000)) return false;
      patch = { defaultFontSize: v };
      // C++ `LekhGlobal::currentStyle()->setFontSize(fval)`.
      this.host_.board.currentStyle().setFontSize(v);
    } else if (name === 'screenMode') {
      const v = Number(value);
      if (!(v >= 0 && v <= 2)) return false;
      patch = { screenMode: v };
    } else if (name === 'defaultConnectionType') {
      const v = Number(value);
      if (!(Number.isInteger(v) && v >= 0 && v <= 2)) return false;
      patch = { defaultConnectionType: v };
    } else if (name === 'defaultArrowType') {
      const v = Number(value);
      if (!(v >= 0 && v <= 2)) return false;
      patch = { defaultArrowType: v };
    } else {
      patch = { [name]: value };
    }
    const changed = this.host_.settings.update(patch);
    if (changed) {
      if (name === 'showConnectionHandles') this.host_.overlay.refreshSelection();
      this.host_.board.requestPaint('drawing');
      this.host_.board.requestPaint('middle');
      this.host_.changed();
    }
    return changed;
  }
}

/** The board's editors (spec 05 §6.3): what `BoardCommands.style`, `.color`, … stand for. */
export class BoardEditors {
  private readonly host_: EditorHost;
  readonly settings: SettingsApi;

  constructor(host: EditorHost) {
    this.host_ = host;
    this.settings = new SettingsApi(host);
  }

  /** A style editor for a panel (one per open panel: its continued changes extend one step). */
  style(target: StyleTarget = 'selection'): StyleApi {
    return new StyleApi(this.host_, target);
  }

  colorPicker(kind: ColorKind, target: StyleTarget = 'selection'): ColorPickerApi {
    return new ColorPickerApi(this.host_, kind, target);
  }

  connection(): ConnectionApi {
    return new ConnectionApi(this.host_);
  }

  page(): PageApi {
    return new PageApi(this.host_);
  }

  property(): PropertyApi {
    return new PropertyApi(this.host_);
  }

  setSize(): SetSizeApi {
    return new SetSizeApi(this.host_);
  }
}
