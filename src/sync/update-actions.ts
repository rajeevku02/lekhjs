// Remote changes, applied transactionally (port of C++ `UpdateAction` and its 13 subclasses,
// `L/update/UpdateAction.{h,cpp}`; spec 02 §10, spec 03 §11.2).
//
// Each action is built by `UpdateDecoder` from one frame's `changes`, then:
//   1. `validate(env)` parses and checks everything — objects, templates, pages, ids, connector
//      ends — into the action's own plan, **without touching the document**. False rejects the
//      whole frame (B4, DR-ENG-16): nothing is applied and the version does not advance. Every
//      case where C++ `apply()` returned false (often after mutating part of the document) is a
//      validation failure here.
//   2. `apply(env, out)` mutates from the plan; it cannot fail. It records what it touched in
//      `out` (C++ reached into the widgets instead: `onObjectsRemovedByUpdate`,
//      `updateSelectionRectangle`, `LekhUtil::updateBackground`, C10).
//
// Ported as is, each a C++ behaviour: an attribute change for a page or object that is not there
// fails; a delete of an id that is not there deletes the rest; `delallobjects` ignores everything
// else in the frame; an `addobjects` frame takes its page from the last object key (in key
// order); an arrow change applies but does not advance the version (C++ `apply()` returned
// false); a remote margin of `null` shows the margin with its old size. Changed from C++: a
// connector whose end is neither on the page nor in the frame fails the frame (spec 03 §11.2;
// C++ dropped the connector and applied the rest).
import {
  JsonDocumentReader,
  LoadContext,
  ObjectReader,
  parseBackground,
  parseConnectionParams,
  parseStyle,
  parseTemplateParams,
  type DocumentCodec,
  type ReadResult,
} from '../io';
import {
  ConnectionObject,
  GroupObject,
  Page,
  PageSize,
  TemplatedObject,
  type ConnectionType,
  type LekhDocument,
  type LekhObject,
  type Params,
} from '../model';
import { Length, Scaling } from '../style';
import {
  buildTemplateDef,
  isJsonObject,
  type CatalogIssue,
  type JsonObject,
  type JsonValue,
  type ShapeTemplate,
  type TemplateDef,
  type TemplateParam,
} from '../template';
import { consts } from './consts';

/** What applying needs from the session. */
export interface ApplyEnv {
  readonly doc: LekhDocument;
  readonly codec: DocumentCodec;
  /** A `load` frame's document replaces the session's (C++ `DocManager::loadDoc`). */
  replaceDocument(read: ReadResult): void;
}

/** What one frame did (spec 03 §11.2 step 5). */
export interface ApplyResult {
  /** Ids added or changed, in the order touched. */
  readonly changedIds: readonly string[];
  readonly removedIds: readonly string[];
  /** A `load` replaced the whole document. */
  readonly reloaded: boolean;
  /** A page background, the grid or the scaling changed (C++ `LekhUtil::updateBackground`). */
  readonly backgroundChanged: boolean;
  /** Pages were added, deleted or changed. */
  readonly pagesChanged: boolean;
  /** A Lua generator arrived and was converted to JS while parsing (spec 04 §7.3). */
  readonly convertedLua: boolean;
}

/** The mutable record `apply` fills. */
export class ApplyRecord {
  readonly changedIds: string[] = [];
  readonly removedIds: string[] = [];
  reloaded = false;
  backgroundChanged = false;
  pagesChanged = false;
  convertedLua = false;

  changed(id: string): void {
    this.changedIds.push(id);
  }

  removed(id: string): void {
    this.removedIds.push(id);
  }

  result(): ApplyResult {
    return {
      changedIds: this.changedIds,
      removedIds: this.removedIds,
      reloaded: this.reloaded,
      backgroundChanged: this.backgroundChanged,
      pagesChanged: this.pagesChanged,
      convertedLua: this.convertedLua,
    };
  }
}

/** Integer-valued number (C++ `JsonNode::INT`). */
function isInt(v: JsonValue | undefined): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** A template body parsed against the document (embeds fall back to its templates). */
function parseTemplate(env: ApplyEnv, json: JsonValue): { template: ShapeTemplate; converted: boolean } | null {
  const ctx = new LoadContext(env.codec.env, env.doc);
  const t = ctx.codec.parse(json, ctx.stats);
  if (t === null) return null;
  t.load();
  return { template: t, converted: ctx.stats.converted > 0 };
}

/** The arrowheads of an object that has them (C++ `IArrowObject`). */
function arrowsOf(obj: LekhObject | null): TemplatedObject['arrows'] | null {
  if (obj instanceof TemplatedObject || obj instanceof ConnectionObject) return obj.arrows;
  return null;
}

export abstract class UpdateAction {
  /** False when the frame's version is not taken even though it applied (`ArrowUpdateAction`). */
  readonly advancesVersion: boolean = true;

  /** Phase 1: parse and check; no mutation. */
  abstract validate(env: ApplyEnv): boolean;

  /** Phase 2: mutate from what `validate` prepared. */
  abstract apply(env: ApplyEnv, out: ApplyRecord): void;
}

/** C++ `DocReloadUpdateAction`: replace the whole document. */
export class DocReloadUpdateAction extends UpdateAction {
  private readonly node_: JsonObject;
  private read_: ReadResult | null = null;

  constructor(node: JsonObject) {
    super();
    this.node_ = node;
  }

  validate(env: ApplyEnv): boolean {
    try {
      this.read_ = env.codec.readValue(this.node_);
    } catch {
      return false;
    }
    return true;
  }

  apply(env: ApplyEnv, out: ApplyRecord): void {
    if (this.read_ === null) return;
    env.replaceDocument(this.read_);
    out.reloaded = true;
    out.backgroundChanged = true;
    out.pagesChanged = true;
    out.convertedLua = this.read_.convertedLua;
  }
}

/** A frame whose shape C++ could not handle (an empty `load`, B3): always rejected. */
export class RejectedUpdateAction extends UpdateAction {
  readonly reason: string;

  constructor(reason: string) {
    super();
    this.reason = reason;
  }

  validate(): boolean {
    return false;
  }

  apply(): void {
    /* never applied */
  }
}

/** C++ `AddDelObjectsUpdateAction`: `addobjects`, `delobjects`, `delallobjects`, `convertobjects`. */
export class AddDelObjectsUpdateAction extends UpdateAction {
  page = '';
  /** `[id, json]` in key order. */
  readonly objects: [string, JsonObject][] = [];
  readonly toBeDeleted = new Set<string>();
  readonly templates: JsonObject[] = [];
  readonly help: JsonObject[] = [];
  delAll = false;

  private page_: Page | null = null;
  private defs_: TemplateDef[] = [];
  private parsed_: LekhObject[] = [];
  private converted_ = false;

  validate(env: ApplyEnv): boolean {
    const page = env.doc.getPage(this.page);
    if (page === null) return false;
    this.page_ = page;
    if (this.delAll) return true;

    const issues: CatalogIssue[] = [];
    const resolve = env.codec.templates.hooks.resolve;
    for (const body of this.templates) {
      const def = buildTemplateDef(body, resolve, issues);
      if (def === null) return false;
      if (def.converted) this.converted_ = true;
      this.defs_.push(def);
    }
    if (this.objects.length === 0) return true;

    const ctx = new LoadContext(env.codec.env, env.doc);
    const reader = new ObjectReader(ctx);
    const objs: LekhObject[] = [];
    try {
      for (const [id, json] of this.objects) objs.push(reader.parseObject(id, json));
    } catch {
      return false;
    }
    for (const o of objs) {
      if (!(o instanceof ConnectionObject)) continue;
      for (const id of [o.srcObjId, o.targetObjId]) {
        if (ctx.objMap.has(id)) continue;
        const e = page.objectStore.getObject(id, true);
        // An end the frame deletes is not there after the delete.
        if (e !== null && !this.toBeDeleted.has(id)) ctx.objMap.set(id, e);
      }
      if (!reader.fixConnector(o)) return false;
    }
    if (ctx.stats.converted > 0) this.converted_ = true;
    this.parsed_ = objs;
    return true;
  }

  apply(env: ApplyEnv, out: ApplyRecord): void {
    const page = this.page_;
    if (page === null) return;
    const store = page.objectStore;
    if (this.delAll) {
      for (const o of store.objects) out.removed(o.id);
      store.clear();
      return;
    }
    if (this.toBeDeleted.size > 0) {
      const removed: LekhObject[] = [];
      const found = store.getObjects(this.toBeDeleted);
      store.removeAt(
        found.map((o) => store.positionOf(o)),
        removed,
      );
      for (const o of removed) out.removed(o.id);
    }
    for (const def of this.defs_) env.doc.addTemplate(def);
    for (const item of this.help) {
      const id = item['id'];
      const text = item['text'];
      if (typeof id === 'string' && typeof text === 'string') env.codec.env.onHelp?.(id, text);
    }
    for (const obj of this.parsed_) {
      store.add(obj);
      out.changed(obj.id);
    }
    if (this.converted_) out.convertedLua = true;
  }
}

/** C++ `AttrChangeUpdateAction::AttrUpdate`. */
export interface AttrUpdate {
  readonly pageId: string;
  readonly objectId: string;
  readonly params: [string, JsonValue][];
  shapeTemplate: JsonValue | null;
  order: JsonValue | null;
}

/** C++ `AttrChangeUpdateAction`: box params, the whole template, the stacking order. */
export class AttrChangeUpdateAction extends UpdateAction {
  readonly updates: AttrUpdate[] = [];
  private plan_: {
    page: Page;
    obj: TemplatedObject;
    params: [string, number][];
    template: ShapeTemplate | null;
    order: number | null;
  }[] = [];
  private converted_ = false;

  validate(env: ApplyEnv): boolean {
    for (const au of this.updates) {
      const page = env.doc.getPage(au.pageId);
      if (page === null) return false;
      const obj = page.objectStore.getObject(au.objectId);
      if (!(obj instanceof TemplatedObject)) return false;
      const params: [string, number][] = [];
      for (const [k, v] of au.params) {
        if (typeof v !== 'number') return false;
        params.push([k, v]);
      }
      let template: ShapeTemplate | null = null;
      if (au.shapeTemplate !== null) {
        const t = parseTemplate(env, au.shapeTemplate);
        if (t === null) return false;
        template = t.template;
        if (t.converted) this.converted_ = true;
      }
      let order: number | null = null;
      if (au.order !== null) {
        if (!isInt(au.order)) return false;
        order = au.order;
      }
      this.plan_.push({ page, obj, params, template, order });
    }
    return true;
  }

  apply(_env: ApplyEnv, out: ApplyRecord): void {
    for (const p of this.plan_) {
      const ds = p.obj.ds;
      for (const [k, v] of p.params) {
        if (k === consts.cx) ds.setCx(v);
        else if (k === consts.cy) ds.setCy(v);
        else if (k === consts.width) ds.setWidth(v);
        else if (k === consts.height) ds.setHeight(v);
        else if (k === consts.angle) ds.setAngle(v);
      }
      if (p.template !== null) p.obj.updateShapeTemplate(p.template);
      if (p.order !== null) p.page.objectStore.moveToOrder(p.obj, p.order);
      p.obj.generateData();
      out.changed(p.obj.id);
    }
    if (this.converted_) out.convertedLua = true;
  }
}

/** C++ `ArrowUpdateAction`. Applies, but (as C++ `apply()` returned false) takes no version. */
export class ArrowUpdateAction extends UpdateAction {
  override readonly advancesVersion = false;
  pageId = '';
  objId = '';
  applyStart = false;
  applyEnd = false;
  start: JsonValue | null = null;
  end: JsonValue | null = null;
  private obj_: LekhObject | null = null;
  private startT_: ShapeTemplate | null = null;
  private endT_: ShapeTemplate | null = null;

  validate(env: ApplyEnv): boolean {
    const obj = env.doc.getPage(this.pageId)?.objectStore.getObject(this.objId) ?? null;
    if (arrowsOf(obj) === null) return false;
    this.obj_ = obj;
    const parse = (v: JsonValue | null): ShapeTemplate | null | false => {
      if (v === null) return null;
      const t = parseTemplate(env, v);
      return t === null ? false : t.template;
    };
    if (this.applyStart) {
      const t = parse(this.start);
      if (t === false) return false;
      this.startT_ = t;
    }
    if (this.applyEnd) {
      const t = parse(this.end);
      if (t === false) return false;
      this.endT_ = t;
    }
    return true;
  }

  apply(_env: ApplyEnv, out: ApplyRecord): void {
    const obj = this.obj_;
    const arrows = arrowsOf(obj);
    if (obj === null || arrows === null) return;
    if (this.applyStart) arrows.setStart(this.startT_);
    if (this.applyEnd) arrows.setEnd(this.endT_);
    if (obj instanceof TemplatedObject) obj.generateData();
    else obj.invalidate();
    out.changed(obj.id);
  }
}

/** C++ `TemplateParamUpdateAction`. */
export class TemplateParamUpdateAction extends UpdateAction {
  pageId = '';
  objId = '';
  params: JsonValue | null = null;
  private obj_: TemplatedObject | null = null;
  private parsed_: TemplateParam[] = [];

  validate(env: ApplyEnv): boolean {
    const obj = env.doc.getPage(this.pageId)?.objectStore.getObject(this.objId) ?? null;
    if (!(obj instanceof TemplatedObject) || obj.shapeTemplate() === null) return false;
    if (this.params === null) return false;
    this.obj_ = obj;
    this.parsed_ = parseTemplateParams(this.params);
    return true;
  }

  apply(_env: ApplyEnv, out: ApplyRecord): void {
    const obj = this.obj_;
    const stl = obj?.shapeTemplate() ?? null;
    if (obj === null || stl === null) return;
    stl.params = this.parsed_;
    stl.load();
    obj.generateData();
    out.changed(obj.id);
  }
}

/** C++ `GridChangeUpdateAction`. */
export class GridChangeUpdateAction extends UpdateAction {
  val: JsonValue | null = null;

  validate(): boolean {
    return typeof this.val === 'boolean';
  }

  apply(env: ApplyEnv, out: ApplyRecord): void {
    env.doc.grid.present = this.val === true;
    out.backgroundChanged = true;
  }
}

/** C++ `ScalingChangeUpdateAction`. */
export class ScalingChangeUpdateAction extends UpdateAction {
  val: JsonValue | null = null;
  private scaling_: Scaling | null = null;

  validate(): boolean {
    const v = this.val;
    if (!isJsonObject(v)) return false;
    const scale = v[consts.scale];
    const unit = v[consts.unit];
    if (typeof scale !== 'number' || typeof unit !== 'string') return false;
    this.scaling_ = new Scaling(Length.unitFromStr(unit), scale);
    return true;
  }

  apply(env: ApplyEnv, out: ApplyRecord): void {
    if (this.scaling_ === null) return;
    env.doc.scaling = this.scaling_;
    out.backgroundChanged = true;
  }
}

/** C++ `ConnectionChangeUpdateAction`: a connector's params and type. */
export class ConnectionChangeUpdateAction extends UpdateAction {
  pageId = '';
  objId = '';
  params: JsonValue | null = null;
  ctype: JsonValue | null = null;
  private con_: ConnectionObject | null = null;
  private params_: Params | null = null;
  private type_: ConnectionType | null = null;

  validate(env: ApplyEnv): boolean {
    const con = env.doc.getPage(this.pageId)?.objectStore.getObject(this.objId) ?? null;
    if (!(con instanceof ConnectionObject)) return false;
    this.con_ = con;
    if (this.params !== null) {
      const p = parseConnectionParams(this.params);
      if (p === null) return false;
      this.params_ = p;
    }
    if (this.ctype !== null) {
      if (!isInt(this.ctype) || this.ctype < 0 || this.ctype > 2) return false;
      this.type_ = this.ctype as ConnectionType;
    }
    return true;
  }

  apply(_env: ApplyEnv, out: ApplyRecord): void {
    const con = this.con_;
    if (con === null) return;
    if (this.params_ !== null) con.setParams(this.params_);
    if (this.type_ !== null) con.setType(this.type_);
    out.changed(con.id);
  }
}

/** C++ `parseConnectionTexts` without the legacy strings: `{text, param}` entries of an array. */
function parseConnectionTexts(v: JsonValue): { text: string; param: number }[] {
  const out: { text: string; param: number }[] = [];
  if (!Array.isArray(v)) return out;
  for (const t of v as readonly JsonValue[]) {
    if (!isJsonObject(t)) continue;
    const text = t['text'];
    const param = t['param'];
    if (typeof text === 'string' && typeof param === 'number') out.push({ text, param });
  }
  return out;
}

/** C++ `ConnectionTextsUpdateAction`: a connector's labels. */
export class ConnectionTextsUpdateAction extends UpdateAction {
  pageId = '';
  objId = '';
  val: JsonValue | null = null;
  private con_: ConnectionObject | null = null;

  validate(env: ApplyEnv): boolean {
    const con = env.doc.getPage(this.pageId)?.objectStore.getObject(this.objId) ?? null;
    if (!(con instanceof ConnectionObject) || this.val === null) return false;
    this.con_ = con;
    return true;
  }

  apply(_env: ApplyEnv, out: ApplyRecord): void {
    const con = this.con_;
    if (con === null || this.val === null) return;
    con.setTexts(parseConnectionTexts(this.val));
    out.changed(con.id);
  }
}

/** C++ `BackgroundChangeUpdateAction`. */
export class BackgroundChangeUpdateAction extends UpdateAction {
  pageId = '';
  val: JsonValue | null = null;
  private page_: Page | null = null;

  validate(env: ApplyEnv): boolean {
    this.page_ = env.doc.getPage(this.pageId);
    return this.page_ !== null && this.val !== null;
  }

  apply(_env: ApplyEnv, out: ApplyRecord): void {
    if (this.page_ === null || this.val === null) return;
    parseBackground(this.val, this.page_);
    out.backgroundChanged = true;
  }
}

/** C++ `StyleChangeUpdateAction::ObjStyle`. */
export interface ObjStyle {
  pageId: string;
  readonly style: [string, JsonValue][];
}

/** C++ `StyleChangeUpdateAction`: style attributes merged into each object's style. */
export class StyleChangeUpdateAction extends UpdateAction {
  /** By object id, in key order. */
  readonly styles = new Map<string, ObjStyle>();
  private plan_: { obj: LekhObject; node: JsonObject }[] = [];

  validate(env: ApplyEnv): boolean {
    for (const [objId, os] of this.styles) {
      const obj = env.doc.getPage(os.pageId)?.getObject(objId) ?? null;
      if (obj === null) return false;
      const node: Record<string, JsonValue> = {};
      for (const [k, v] of os.style) node[k] = v;
      this.plan_.push({ obj, node });
    }
    return true;
  }

  apply(_env: ApplyEnv, out: ApplyRecord): void {
    for (const p of this.plan_) {
      parseStyle(p.obj.getDrawingProfile(), p.node, false);
      if (p.obj instanceof TemplatedObject && !(p.obj instanceof GroupObject)) p.obj.generateData();
      else p.obj.invalidate();
      out.changed(p.obj.id);
    }
  }
}

/** C++ `PageAddDeleteAction`. */
export class PageAddDeleteAction extends UpdateAction {
  /** `[id, json]` in key order. */
  readonly added: [string, JsonObject][] = [];
  readonly deleted = new Set<string>();
  private pages_: Page[] = [];
  private converted_ = false;

  validate(env: ApplyEnv): boolean {
    const reader = new JsonDocumentReader(env.codec.env);
    for (const [id, json] of this.added) {
      try {
        const r = reader.readPage(json, id, env.doc);
        if (r.droppedConnectors > 0) return false;
        if (r.convertedLua) this.converted_ = true;
        this.pages_.push(r.page);
      } catch {
        return false;
      }
    }
    return true;
  }

  apply(env: ApplyEnv, out: ApplyRecord): void {
    for (const page of this.pages_) {
      env.doc.addPageWithOrder(page);
      for (const o of page.objectStore.objects) out.changed(o.id);
    }
    for (const id of this.deleted) {
      const page = env.doc.getPage(id);
      if (page !== null) for (const o of page.objectStore.objects) out.removed(o.id);
      env.doc.deletePage(id);
    }
    out.pagesChanged = true;
    out.backgroundChanged = true;
    if (this.converted_) out.convertedLua = true;
  }
}

/** C++ `PageAttrChangeAction`. Pages that are not there are skipped; nothing fails. */
export class PageAttrChangeAction extends UpdateAction {
  readonly sizes: [string, JsonValue][] = [];
  readonly names: [string, string][] = [];
  readonly canvasSizeTypes: [string, string][] = [];
  readonly canvasNames: [string, string][] = [];
  readonly orders: [string, number][] = [];
  readonly margins: [string, JsonValue][] = [];

  validate(): boolean {
    return true;
  }

  apply(env: ApplyEnv, out: ApplyRecord): void {
    const doc = env.doc;
    const sizeFrom = (node: JsonValue, sz: PageSize): PageSize => {
      let { width, height, unit } = sz;
      if (isJsonObject(node)) {
        const w = node['width'];
        const h = node['height'];
        const u = node['unit'];
        if (typeof w === 'number') width = w;
        if (typeof h === 'number') height = h;
        if (typeof u === 'string') unit = Length.unitFromStr(u);
      }
      return new PageSize(unit, width, height);
    };
    for (const [id, node] of this.sizes) {
      const page = doc.getPage(id);
      if (page !== null) page.size = sizeFrom(node, page.size);
    }
    for (const [id, node] of this.margins) {
      const page = doc.getPage(id);
      // As C++: `show` is set whatever the node is, so a `null` (hide) keeps the old size shown.
      if (page !== null) page.margin = { show: true, size: sizeFrom(node, page.margin.size) };
    }
    for (const [id, name] of this.names) {
      const page = doc.getPage(id);
      if (page !== null) page.name = name;
    }
    for (const [id, t] of this.canvasSizeTypes) {
      const page = doc.getPage(id);
      if (page !== null) page.canvasSizeType = Page.sizeTypeFromStr(t);
    }
    for (const [id, name] of this.canvasNames) {
      const page = doc.getPage(id);
      if (page !== null) page.canvasName = name;
    }
    const activeId = doc.activePage().id;
    for (const [id, order] of this.orders) {
      const page = doc.getPage(id);
      if (page !== null) page.order = order;
    }
    if (this.orders.length > 0) {
      doc.arrangePages();
      if (doc.activePage().id !== activeId) {
        const active = doc.getPage(activeId);
        const idx = active === null ? -1 : doc.getPageIndex(active);
        if (idx >= 0) doc.setActivePageIndex(idx);
      }
    }
    out.pagesChanged = true;
    out.backgroundChanged = true;
  }
}
