// The undoable command (port of C++ `UserAction`, `L/UserAction.{h,cpp}:23-262`; spec 02 §11,
// spec 03 §11.3, §11.5).
//
// A command stores its page id and object ids, never live objects across undo steps (except the
// detached ones it owns while they are off the page, as C++ did), and resolves them through the
// page's id map on every `perform` / `undo` (O(1); C++ scanned the store). A command whose objects
// cannot be resolved does nothing and reports false. Each `perform` / `undo` produces its realtime
// update exactly as C++ `raise*` did, through the injected `UpdateSink`.
//
// No globals (C12): the document and the session's codec arrive in the constructor; the page is
// the document's active page at construction, as C++ read it from `LekhGlobal`.
import type { Config } from '../base';
import { JsonDocumentWriter, serializeTemplateParams, type DocumentCodec } from '../io';
import {
  ConnectionObject,
  TemplatedObject,
  type ArrowHeads,
  type LekhDocument,
  type LekhObject,
  type Page,
} from '../model';
import type { JsonObject, JsonValue, ShapeTemplate } from '../template';
import { EditKeys as K, EditUpdateType, OutgoingUpdate, type UpdateSink } from './update';

/** What every command reads and writes through. */
export interface EditEnv {
  /** The session's codec: serializes objects, templates and pages for the updates. */
  readonly codec: DocumentCodec;
  /** Where updates go. */
  readonly sink: UpdateSink;
}

/** The config of an edit environment. */
export function editConfig(env: EditEnv): Config {
  return env.codec.env.objects.config;
}

/** C++ `UserAction::ArrowLocation`. */
export const ArrowEnd = Object.freeze({ Start: 0, End: 1, Both: 2 } as const);
export type ArrowEnd = (typeof ArrowEnd)[keyof typeof ArrowEnd];

/** The arrowheads of an object that has them (C++ `IArrowObject`): a templated object or a connector. */
export function arrowsOf(obj: LekhObject | null): ArrowHeads | null {
  if (obj instanceof TemplatedObject || obj instanceof ConnectionObject) return obj.arrows;
  return null;
}

/** C++ `getArrowPoints()` of an arrow object. */
export function arrowPointCount(obj: LekhObject | null): number {
  if (obj instanceof TemplatedObject || obj instanceof ConnectionObject) return obj.getArrowPoints().length;
  return 0;
}

/** Re-lays an object out after its arrowheads changed. */
export function refreshArrows(obj: LekhObject): void {
  if (obj instanceof TemplatedObject) obj.generateData();
  else obj.invalidate();
}

/** C++ `serializeConnectionParams`. */
export function connectionParamsJson(con: ConnectionObject): JsonValue {
  return con.getParams().map((pm) => ({ ...pm }));
}

/** C++ `serializeConnectionTexts`: the non-empty labels. */
export function connectionTextsJson(con: ConnectionObject): JsonValue {
  return con
    .textInfos()
    .filter((t) => t.text !== '')
    .map((t) => ({ text: t.text, param: t.param }));
}

export abstract class UserAction {
  protected readonly env: EditEnv;
  protected document_: LekhDocument;
  protected pageId_: string;
  protected objectIds_: string[] = [];
  /** Objects this command holds while they are off the page (C++ `objects_`). */
  protected objects_: LekhObject[] = [];

  constructor(env: EditEnv, doc: LekhDocument) {
    this.env = env;
    this.document_ = doc;
    this.pageId_ = doc.activePage().id;
  }

  abstract perform(): boolean;
  abstract undo(): boolean;

  /** Sends this command's update for a change already made (C++ `addAction(act, true)`). */
  raise(): void {
    /* C++: empty by default */
  }

  get pageId(): string {
    return this.pageId_;
  }

  get objectIds(): readonly string[] {
    return this.objectIds_;
  }

  /** C++ `hasObject`. */
  hasObject(oid: string): boolean {
    return this.objectIds_.includes(oid);
  }

  /** C++ `objectCount`. */
  objectCount(): number {
    return this.objectIds_.length;
  }

  // ---- resolving ----

  protected get objectsPrefix(): string {
    return `${K.doc}.${K.pages}.${this.pageId_}.${K.objects}.`;
  }

  protected get pagesPrefix(): string {
    return `${K.doc}.${K.pages}.`;
  }

  protected page(): Page | null {
    return this.document_.getPage(this.pageId_);
  }

  /** C++ `getObject`: the first id, top level. */
  protected getObject(): LekhObject | null {
    const id = this.objectIds_[0];
    if (id === undefined) return null;
    return this.page()?.objectStore.getObject(id) ?? null;
  }

  protected getTemplatedObject(): TemplatedObject | null {
    const o = this.getObject();
    return o instanceof TemplatedObject ? o : null;
  }

  protected getConnectionObject(): ConnectionObject | null {
    const o = this.getObject();
    return o instanceof ConnectionObject ? o : null;
  }

  /**
   * C++ `getObjects(objs, indices)`: the top-level objects with this command's ids, highest store
   * position first; null when the page is gone or an id is missing.
   */
  protected getObjects(): LekhObject[] | null {
    const page = this.page();
    if (page === null) return null;
    const ids = new Set(this.objectIds_);
    const objs = page.objectStore.getObjects(ids);
    return objs.length === ids.size ? objs : null;
  }

  /** C++ `refreshTemplatedObject`: `generateData` on the templated objects present. */
  protected refreshTemplatedObject(): void {
    const page = this.page();
    if (page === null) return;
    for (const o of page.objectStore.getObjects(new Set(this.objectIds_))) {
      if (o instanceof TemplatedObject) o.generateData();
    }
  }

  // ---- serializing ----

  protected writer(): JsonDocumentWriter {
    return new JsonDocumentWriter(this.env.codec.templates, { stamp: 'cloud' });
  }

  protected objectJson(obj: LekhObject): JsonObject {
    return this.env.codec.writeObject(obj);
  }

  protected templateJson(stl: ShapeTemplate): JsonObject {
    return this.env.codec.templates.serialize(stl);
  }

  protected send(update: OutgoingUpdate): void {
    this.env.sink.raise(update);
  }

  // ---- C++ raise helpers ----

  /** C++ `populateParamsUpdate`. */
  protected populateParamsUpdate(tobj: TemplatedObject, update: OutgoingUpdate): void {
    const p = `${this.objectsPrefix}${tobj.id}.${K.params}.`;
    update.set(p + K.cx, tobj.ds.cx());
    update.set(p + K.cy, tobj.ds.cy());
    update.set(p + K.width, tobj.ds.width());
    update.set(p + K.height, tobj.ds.height());
    update.set(p + K.angle, tobj.ds.angle());
  }

  /** C++ `raiseTemplateChange`: the whole template plus the box. */
  protected raiseTemplateChange(): void {
    const tobj = this.getTemplatedObject();
    if (tobj === null) return;
    const update = new OutgoingUpdate(EditUpdateType.changeAttr);
    const stl = tobj.shapeTemplate();
    update.set(`${this.objectsPrefix}${tobj.id}.${K.stemplate}`, stl === null ? null : this.templateJson(stl));
    this.populateParamsUpdate(tobj, update);
    this.send(update);
  }

  /** C++ `raiseParams`. */
  protected raiseParams(): void {
    const tobj = this.getTemplatedObject();
    if (tobj === null) return;
    const update = new OutgoingUpdate(EditUpdateType.changeAttr);
    this.populateParamsUpdate(tobj, update);
    this.send(update);
  }

  /** C++ `raiseArrowChange`. */
  protected raiseArrowChange(loc: ArrowEnd): void {
    const obj = this.getObject();
    const arrows = arrowsOf(obj);
    if (obj === null || arrows === null) return;
    const update = new OutgoingUpdate(EditUpdateType.changeArrow);
    const base = `${this.objectsPrefix}${obj.id}.${K.arrows}.`;
    if (loc === ArrowEnd.Start || loc === ArrowEnd.Both) {
      const t = arrows.start();
      update.set(base + K.start, t === null ? null : this.templateJson(t));
    }
    if (loc === ArrowEnd.End || loc === ArrowEnd.Both) {
      const t = arrows.end();
      update.set(base + K.end, t === null ? null : this.templateJson(t));
    }
    this.send(update);
  }

  /** C++ `raiseTemplateParams`. */
  protected raiseTemplateParams(): void {
    const tobj = this.getTemplatedObject();
    const stl = tobj?.shapeTemplate() ?? null;
    if (tobj === null || stl === null) return;
    const update = new OutgoingUpdate(EditUpdateType.changeTemplateParams);
    update.set(`${this.objectsPrefix}${tobj.id}.${K.stemplate}.${K.params}`, serializeTemplateParams(stl.params));
    this.send(update);
  }

  /** C++ `raiseConnectionTexts`. */
  protected raiseConnectionTexts(): void {
    const con = this.getConnectionObject();
    if (con === null) return;
    const update = new OutgoingUpdate(EditUpdateType.changeConnectionTexts);
    update.set(`${this.objectsPrefix}${con.id}.${K.texts}`, connectionTextsJson(con));
    this.send(update);
  }

  /** C++ `raiseConnectionParams`: the params and the type. */
  protected raiseConnectionParams(): void {
    const con = this.getConnectionObject();
    if (con === null) return;
    const update = new OutgoingUpdate(EditUpdateType.changeConnectionParams);
    update.set(`${this.objectsPrefix}${con.id}.${K.params}`, connectionParamsJson(con));
    update.set(`${this.objectsPrefix}${con.id}.${K.ctype}`, con.getType());
    this.send(update);
  }

  /**
   * C++ `removeConnections`: removes the connectors of `objs` (and of a group's members) from the
   * page and writes a delete for each into `update`.
   */
  protected removeConnections(page: Page, objs: readonly LekhObject[], update: OutgoingUpdate): void {
    const store = page.objectStore;
    const conns = new Set<LekhObject>();
    for (const o of objs) for (const c of store.connectionsOf(o)) conns.add(c);
    for (const c of conns) {
      update.set(this.objectsPrefix + c.id, null);
      store.remove(c);
    }
  }
}
