// The selection menu as data (port of the 33 `*MenuItem` classes of C++
// `L/object/widget/selection/SelectionMenuWidget.cpp:204-1165` and their registration order,
// `:1238-1300`; spec 02 `SelectionActionCatalog`, spec 05 §8). Each entry has an id, the icon id
// C++ drew (`lekhapp.ui.*`; mapped to a `react-icons` glyph by the board's `iconMap`, spec 05
// §7.4; the always-collapsed items have none, as C++ constructed them with an empty icon), the
// C++ label, `isCollapsedAlways`, `isAvailable` (C++ `isVisible`: a target and `shouldShow`) and
// `run`. The React menu, the context menu and the keyboard all use it.
//
// Entries that open a panel or picker in C++ (stroke, fill, text attributes and colour, shape
// properties, connection, title position, set size, info, about, shape help, save to library)
// return the panel to open; the panel calls the editors. The separator and the overflow expander
// are entries too (33 = 31 actions + 2), so the menu's layout is data as well.
import { Quadrilateral, Rect, Triangle, getPointsBound, type Point } from '../geometry';
import { ConnectionObject, GroupObject, TemplatedObject } from '../model';
import { EllipseShape, ParamEditorType, PolygonTemplate, TextSide, type ShapeTemplate } from '../template';
import type { ClipboardService } from './clipboard';
import type { EditCommands } from './commands';
import { isMulti, type EditTarget, type SelectionChange } from './edit-target';
import type { EditorContext } from './editor-context';
import {
  ExpandAction,
  TemplateModificationAction,
  TemplatedObjectChangeAction,
  makeTitleSideChange,
  snapshotTemplate,
} from './object-actions';
import { arrowPointCount, arrowsOf } from './user-action';

export type SelectionActionId =
  | 'info'
  | 'delete'
  | 'duplicate'
  | 'properties'
  | 'stroke'
  | 'fill'
  | 'text_attr'
  | 'text_color'
  | 'round_corner'
  | 'sharp_corner'
  | 'make_square'
  | 'make_circle'
  | 'make_equilateral'
  | 'group'
  | 'ungroup'
  | 'connection'
  | 'shape_help'
  | 'title_position'
  | 'copy'
  | 'cut'
  | 'bring_front'
  | 'send_back'
  | 'flip_h'
  | 'flip_v'
  | 'copy_style'
  | 'paste_style'
  | 'copy_size'
  | 'paste_size'
  | 'set_size'
  | 'save_to_library'
  | 'about'
  | 'separator'
  | 'expand';

/** The panel or picker an entry opens (C++ the view manager it presented). */
export type SelectionPanel =
  | {
      readonly panel:
        'info' | 'about' | 'properties' | 'stroke' | 'fill' | 'text_attr' | 'text_color' | 'connection' | 'set_size';
    }
  | { readonly panel: 'title_position'; readonly sides: readonly TextSide[]; readonly selected: number }
  | { readonly panel: 'shape_help'; readonly content: string }
  | { readonly panel: 'save_to_library'; readonly object: TemplatedObject };

export interface SelectionActionResult {
  /** The selection afterwards (`undefined`: unchanged, `null`: cleared). */
  readonly select?: SelectionChange;
  readonly open?: SelectionPanel;
}

export interface SelectionActionContext {
  readonly editor: EditorContext;
  readonly commands: EditCommands;
  readonly clipboard: ClipboardService;
}

export interface SelectionActionDef {
  readonly id: SelectionActionId;
  readonly iconId: string;
  readonly label: string;
  readonly kind: 'action' | 'separator' | 'expander';
  readonly collapsedAlways: boolean;
  /** C++ `shouldShow` (the target is never null here). */
  readonly shouldShow: (t: EditTarget, ctx: SelectionActionContext) => boolean;
  readonly run: (t: EditTarget, ctx: SelectionActionContext, arg?: unknown) => SelectionActionResult;
}

/** What the menu shows for one target (spec 05 §6.3 `SelectionAction`). */
export interface SelectionAction {
  readonly id: SelectionActionId;
  readonly iconId: string;
  readonly label: string;
  readonly collapsed: boolean;
  readonly enabled: boolean;
}

// ---- C++ SelectionMenuItem helpers ----

function templateOf(t: EditTarget): ShapeTemplate | null {
  return t instanceof TemplatedObject ? t.shapeTemplate() : null;
}

/** C++ `isTextShape`: one text, no path, no image. */
function isTextShape(t: EditTarget): boolean {
  const stl = templateOf(t);
  return stl !== null && stl.paths().length === 0 && stl.images().length === 0 && stl.texts().length === 1;
}

/** C++ `isImageShape`: one image, no path, no text. */
function isImageShape(t: EditTarget): boolean {
  const stl = templateOf(t);
  return stl !== null && stl.paths().length === 0 && stl.images().length === 1 && stl.texts().length === 0;
}

/** C++ `containsImage`. */
function containsImage(t: EditTarget): boolean {
  if (t instanceof GroupObject) return t.objects().some((c) => containsImage(c.object));
  if (isMulti(t)) return t.objects.some((o) => containsImage(o));
  const stl = templateOf(t);
  return stl !== null && stl.images().length > 0;
}

/** C++ `isLine`: a polygon template that is a line. */
function isLine(t: EditTarget): boolean {
  const stl = templateOf(t);
  return stl instanceof PolygonTemplate && stl.isLine();
}

function polygonOf(t: EditTarget): { obj: TemplatedObject; poly: PolygonTemplate } | null {
  if (!(t instanceof TemplatedObject)) return null;
  const poly = t.shapeTemplate();
  return poly instanceof PolygonTemplate ? { obj: t, poly } : null;
}

function canEditText(t: EditTarget): boolean {
  return !isMulti(t) && t.canEditText();
}

function quadOf(v: readonly Point[]): Quadrilateral {
  return new Quadrilateral(v[0] as Point, v[1] as Point, v[2] as Point, v[3] as Point);
}

function triangleOf(v: readonly Point[]): Triangle {
  return new Triangle(v[0] as Point, v[1] as Point, v[2] as Point);
}

const NONE: SelectionActionResult = Object.freeze({});

const TITLE_SIDES: readonly TextSide[] = Object.freeze([TextSide.Top, TextSide.Bottom, TextSide.Left, TextSide.Right]);

/** Round or sharp corners on a closed polygon (C++ `RoundCornerMenuItem` / `SharpCornerMenuItem`). */
function setCorners(t: EditTarget, ctx: SelectionActionContext, rounded: boolean): SelectionActionResult {
  const p = polygonOf(t);
  if (p === null) return NONE;
  const old = snapshotTemplate(p.obj);
  p.poly.makeRect(rounded);
  p.obj.generateData();
  const ed = ctx.editor;
  ed.tx.record(new TemplatedObjectChangeAction(ed.env, ed.doc, p.obj, old, snapshotTemplate(p.obj)));
  return { select: p.obj };
}

function action(
  id: SelectionActionId,
  iconId: string,
  label: string,
  shouldShow: SelectionActionDef['shouldShow'],
  run: SelectionActionDef['run'] = () => NONE,
  collapsedAlways = false,
): SelectionActionDef {
  return Object.freeze({ id, iconId, label, kind: 'action', collapsedAlways, shouldShow, run });
}

function panel(
  id: SelectionActionId,
  iconId: string,
  label: string,
  shouldShow: SelectionActionDef['shouldShow'],
  open: SelectionPanel,
  collapsedAlways = false,
): SelectionActionDef {
  return action(id, iconId, label, shouldShow, () => ({ open }), collapsedAlways);
}

/** The 33 entries, by id. */
function buildEntries(): readonly SelectionActionDef[] {
  return Object.freeze([
    panel(
      'info',
      'lekhapp.ui.info',
      'Selected object operations help',
      (_t, c) => c.editor.config.shouldShowInfoButton,
      { panel: 'info' },
    ),
    action(
      'delete',
      'lekhapp.ui.delete',
      'Delete',
      () => true,
      (t, c) => ({ select: c.commands.del(t) }),
    ),
    action(
      'duplicate',
      'lekhapp.ui.duplicate',
      'Duplicate',
      (t) => !(t instanceof ConnectionObject),
      (t, c) => ({ select: c.commands.duplicate(t, true) }),
    ),
    panel(
      'properties',
      'lekhapp.ui.settings',
      'Shape Properties',
      (t) => templateOf(t)?.params.some((p) => p.editor.type !== ParamEditorType.Hidden) === true,
      { panel: 'properties' },
    ),
    panel('stroke', 'lekhapp.ui.border_color', 'Line Style', (t) => !isImageShape(t) && !isTextShape(t), {
      panel: 'stroke',
    }),
    panel(
      'fill',
      'lekhapp.ui.fillcolor',
      'Fill Color',
      (t) => !isImageShape(t) && !isTextShape(t) && !(t instanceof ConnectionObject) && !isLine(t),
      { panel: 'fill' },
    ),
    panel(
      'text_attr',
      'lekhapp.ui.text',
      'Text Style',
      (t) => t instanceof GroupObject || (canEditText(t) && !isImageShape(t) && !isLine(t)),
      { panel: 'text_attr' },
    ),
    panel(
      'text_color',
      'lekhapp.ui.text_color',
      'Text Color',
      (t) => t instanceof GroupObject || (canEditText(t) && !isImageShape(t) && !isLine(t)),
      { panel: 'text_color' },
    ),
    action(
      'round_corner',
      'lekhapp.ui.corner_round',
      'Make Rounded Corner',
      (t) => {
        const p = polygonOf(t);
        return p !== null && p.poly.isClosed() && p.poly.vertices(p.obj.ds).length === 4 && !p.poly.isRounded();
      },
      (t, c) => setCorners(t, c, true),
    ),
    action(
      'sharp_corner',
      'lekhapp.ui.corner_sharp',
      'Make Sharp Corner',
      (t) => {
        const p = polygonOf(t);
        return p !== null && p.poly.isClosed() && p.poly.isRounded();
      },
      (t, c) => setCorners(t, c, false),
    ),
    action(
      'make_square',
      'lekhapp.ui.square',
      'Make Square',
      (t) => {
        const p = polygonOf(t);
        if (p === null) return false;
        if (p.poly.isRounded()) return p.obj.ds.width() !== p.obj.ds.height();
        if (!p.poly.isClosed()) return false;
        const v = p.poly.vertices(p.obj.ds);
        if (v.length !== 4) return false;
        return !quadOf(v).isSquare();
      },
      (t, c) => {
        const p = polygonOf(t);
        if (p === null) return NONE;
        const { obj, poly } = p;
        const old = snapshotTemplate(obj);
        if (poly.isRounded()) {
          const w = (obj.ds.width() + obj.ds.height()) / 2;
          obj.ds.setWidth(w);
          obj.ds.setHeight(w);
        } else {
          const v = poly.vertices(obj.ds);
          const quad = quadOf(v);
          quad.makeSquare();
          const vertices = [quad.p1(), quad.p2(), quad.p3(), quad.p4()];
          const newRect = getPointsBound(vertices);
          poly.setTemplate(vertices, true);
          obj.ds.setAngle(0);
          obj.ds.setRect(newRect);
        }
        obj.generateData();
        c.editor.tx.record(
          new TemplatedObjectChangeAction(c.editor.env, c.editor.doc, obj, old, snapshotTemplate(obj)),
        );
        return { select: obj };
      },
    ),
    action(
      'make_circle',
      'lekhapp.ui.circle',
      'Make Circle',
      (t) => {
        if (!(t instanceof TemplatedObject)) return false;
        const paths = t.paths();
        if (paths?.length !== 1) return false;
        if ((t.shapeTemplate()?.embeds().length ?? 0) > 0) return false;
        const shapes = paths[0]?.shapes() ?? [];
        if (shapes.length !== 1 || !(shapes[0] instanceof EllipseShape)) return false;
        const w = t.ds.width();
        const h = t.ds.height();
        return w !== h && Math.abs(h - w) > 1;
      },
      (t, c) => {
        if (!(t instanceof TemplatedObject)) return NONE;
        const rect = t.ds.rect();
        const w = Math.max(rect.width, rect.height);
        const cur = rect.center();
        c.editor.tx.run(
          new ExpandAction(c.editor.env, c.editor.doc, t, { old: rect, cur: Rect.fromCenter(cur, w, w) }),
        );
        return { select: t };
      },
    ),
    action(
      'make_equilateral',
      'lekhapp.ui.triangle',
      'Make Equilateral',
      (t) => {
        const p = polygonOf(t);
        if (p === null || !p.poly.isClosed()) return false;
        const v = p.poly.vertices(p.obj.ds);
        return v.length === 3 && !triangleOf(v).isEquilateral();
      },
      (t, c) => {
        const p = polygonOf(t);
        if (p === null) return NONE;
        const { obj, poly } = p;
        const v = poly.vertices(obj.ds);
        const tr = triangleOf(v);
        tr.makeEquilateral();
        const vertices = [tr.p1, tr.p2, tr.p3];
        const oldRect = obj.ds.rect();
        const oldAngle = obj.ds.angle();
        const oldExprs = poly.dataExprs().slice();
        const newRect = getPointsBound(vertices);
        poly.setTemplate(vertices, true);
        const newExprs = poly.dataExprs().slice();
        obj.ds.setAngle(0);
        obj.ds.setRect(newRect);
        obj.generateData();
        c.editor.tx.record(
          new TemplateModificationAction(
            c.editor.env,
            c.editor.doc,
            obj,
            { exprs: oldExprs, rect: oldRect, angle: oldAngle },
            { exprs: newExprs, rect: newRect, angle: 0 },
          ),
        );
        return { select: obj };
      },
    ),
    action(
      'group',
      'lekhapp.ui.group',
      'Group Objects',
      (t) => isMulti(t),
      (t, c) => ({ select: c.commands.group(t) }),
    ),
    action(
      'ungroup',
      'lekhapp.ui.ungroup',
      'Un-Group Objects',
      (t) => t instanceof GroupObject,
      (t, c) => ({ select: c.commands.ungroup(t) }),
    ),
    panel(
      'connection',
      'lekhapp.ui.connect_arrow',
      'Connection And Arrows',
      (t) => !isMulti(t) && (t instanceof ConnectionObject || (arrowsOf(t) !== null && arrowPointCount(t) > 0)),
      { panel: 'connection' },
    ),
    action(
      'shape_help',
      'lekhapp.ui.help',
      'How To Edit Shape',
      (t, c) => {
        const stl = templateOf(t);
        return stl !== null && c.editor.help(stl.id()) !== '';
      },
      (t, c) => {
        const stl = templateOf(t);
        return stl === null ? NONE : { open: { panel: 'shape_help', content: c.editor.help(stl.id()) } };
      },
    ),
    action(
      'title_position',
      '',
      'Title Position',
      (t) => (templateOf(t)?.titleIndex() ?? -1) >= 0,
      (t, c, arg) => {
        const stl = templateOf(t);
        if (!(t instanceof TemplatedObject) || stl === null || stl.titleIndex() < 0) return NONE;
        if (typeof arg !== 'number') {
          return {
            open: { panel: 'title_position', sides: TITLE_SIDES, selected: TITLE_SIDES.indexOf(stl.titleSide()) },
          };
        }
        const side = TITLE_SIDES[arg];
        if (side === undefined) return NONE;
        const act = makeTitleSideChange(c.editor.env, c.editor.doc, t, side);
        if (act !== null) c.editor.tx.record(act);
        return { select: t };
      },
      true,
    ),
    action(
      'copy',
      '',
      'Copy',
      (t, c) => c.clipboard.canCopy(t),
      (t, c) => {
        c.clipboard.copy(t);
        return NONE;
      },
      true,
    ),
    action(
      'cut',
      '',
      'Cut',
      (t, c) => c.clipboard.canCut(t),
      (t, c) => ({ select: c.clipboard.cut(t) }),
      true,
    ),
    action(
      'bring_front',
      '',
      'Move To Front',
      (_t, c) => c.commands.canChangeZOrder(),
      (t, c) => {
        c.commands.changeZOrder(t, 1);
        return NONE;
      },
      true,
    ),
    action(
      'send_back',
      '',
      'Move To Back',
      (_t, c) => c.commands.canChangeZOrder(),
      (t, c) => {
        c.commands.changeZOrder(t, 0);
        return NONE;
      },
      true,
    ),
    action(
      'flip_h',
      '',
      'Flip Horizontal',
      (t) => t instanceof TemplatedObject && t.canFlip(1),
      (t, c) => ({ select: c.commands.flip(t, 1) }),
      true,
    ),
    action(
      'flip_v',
      '',
      'Flip Vertical',
      (t) => t instanceof TemplatedObject && t.canFlip(2),
      (t, c) => ({ select: c.commands.flip(t, 2) }),
      true,
    ),
    action(
      'copy_style',
      '',
      'Copy Style',
      (t, c) => !isImageShape(t) && c.clipboard.canCopyStyle(t),
      (t, c) => {
        c.clipboard.copyStyle(t);
        return NONE;
      },
      true,
    ),
    action(
      'paste_style',
      '',
      'Paste Style',
      (t, c) => !isImageShape(t) && c.clipboard.canPasteStyle(),
      (t, c) => {
        c.clipboard.pasteStyle(t);
        return NONE;
      },
      true,
    ),
    action(
      'copy_size',
      '',
      'Copy Size',
      (t) => t instanceof TemplatedObject && !isTextShape(t),
      (t, c) => {
        c.clipboard.copySize(t);
        return NONE;
      },
      true,
    ),
    action(
      'paste_size',
      '',
      'Paste Size',
      (t, c) => t instanceof TemplatedObject && !isTextShape(t) && c.clipboard.canPasteSize(),
      (t, c) => {
        c.clipboard.pasteSize(t);
        return { select: t };
      },
      true,
    ),
    panel(
      'set_size',
      '',
      'Set Size',
      (t) => !(t instanceof ConnectionObject) && !isTextShape(t),
      { panel: 'set_size' },
      true,
    ),
    action(
      'save_to_library',
      '',
      'Add To My Shape Library',
      (t, c) => c.clipboard.canCopy(t) && t instanceof TemplatedObject && !containsImage(t),
      (t) => (t instanceof TemplatedObject ? { open: { panel: 'save_to_library', object: t } } : NONE),
      true,
    ),
    panel('about', '', 'About Menu Items', () => true, { panel: 'about' }, true),
    Object.freeze({
      id: 'separator',
      iconId: 'lekhapp.ui.divider_vertical',
      label: '',
      kind: 'separator',
      collapsedAlways: true,
      shouldShow: () => true,
      run: () => NONE,
    } as SelectionActionDef),
    Object.freeze({
      id: 'expand',
      iconId: 'lekhapp.ui.chevrons_down',
      label: '',
      kind: 'expander',
      collapsedAlways: false,
      shouldShow: () => true,
      run: () => NONE,
    } as SelectionActionDef),
  ]);
}

/**
 * The C++ registration order (`SelectionMenuWidget` constructor), separators included: the order
 * the menu lays its items out in (spec 05 §8).
 */
const LAYOUT: readonly SelectionActionId[] = Object.freeze([
  'info',
  'separator',
  'delete',
  'duplicate',
  'separator',
  'properties',
  'separator',
  'stroke',
  'fill',
  'separator',
  'text_attr',
  'text_color',
  'separator',
  'round_corner',
  'sharp_corner',
  'make_square',
  'make_circle',
  'make_equilateral',
  'group',
  'ungroup',
  'connection',
  'shape_help',
  'title_position',
  'copy',
  'cut',
  'bring_front',
  'send_back',
  'flip_h',
  'flip_v',
  'copy_style',
  'paste_style',
  'copy_size',
  'paste_size',
  'set_size',
  'save_to_library',
  'about',
]);

export class SelectionActionCatalog {
  /** The 33 entries (31 actions, the separator and the overflow expander). */
  readonly entries: readonly SelectionActionDef[] = buildEntries();
  private readonly byId_ = new Map<SelectionActionId, SelectionActionDef>(this.entries.map((e) => [e.id, e]));

  /** The registration order, separators included. */
  get layout(): readonly SelectionActionId[] {
    return LAYOUT;
  }

  get(id: SelectionActionId): SelectionActionDef | undefined {
    return this.byId_.get(id);
  }

  /** C++ `isVisible`: a target, and the entry's `shouldShow`. */
  isAvailable(id: SelectionActionId, target: EditTarget | null, ctx: SelectionActionContext): boolean {
    const e = this.byId_.get(id);
    return e !== undefined && target !== null && e.shouldShow(target, ctx);
  }

  /**
   * The items the menu shows for `target`, in layout order (C++ `doLayout` without the width
   * fit): hidden items dropped, a separator only after a shown item and never twice in a row,
   * always-collapsed items marked collapsed (the overflow lists them). The trailing separator and
   * the expander are the menu's own markup.
   */
  actionsFor(target: EditTarget | null, ctx: SelectionActionContext): SelectionAction[] {
    const out: SelectionAction[] = [];
    if (target === null) return out;
    let lastWasSeparator = true;
    for (const id of LAYOUT) {
      const e = this.byId_.get(id);
      if (e === undefined) continue;
      if (e.kind === 'separator') {
        if (lastWasSeparator) continue;
        lastWasSeparator = true;
        out.push({ id, iconId: e.iconId, label: '', collapsed: false, enabled: true });
        continue;
      }
      if (!e.shouldShow(target, ctx)) continue;
      if (!e.collapsedAlways) lastWasSeparator = false;
      out.push({ id, iconId: e.iconId, label: e.label, collapsed: e.collapsedAlways, enabled: true });
    }
    return out;
  }

  /** Runs entry `id` on `target` (nothing when it is not available). */
  run(
    id: SelectionActionId,
    target: EditTarget | null,
    ctx: SelectionActionContext,
    arg?: unknown,
  ): SelectionActionResult {
    const e = this.byId_.get(id);
    if (e === undefined || target === null || !e.shouldShow(target, ctx)) return NONE;
    return e.run(target, ctx, arg);
  }
}
