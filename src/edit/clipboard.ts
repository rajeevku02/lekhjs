// Copy, cut and paste of object sets, and copy/paste of a style or a size (port of C++
// `Clipboard`, `L/Clipboard.{h,cpp}`; spec 02 `ClipboardService`). One per board session (C++ was
// a process singleton). The selection arrives as an argument, and what the selection should become
// is returned (C11). The OS clipboard is the host's: `serialize()` gives the C++
// `serializeCopiedObject` payload (the templates plus one object, a `multi` for several), and
// `load()` takes one back; Lua generators in it are converted on the way in (spec 04 §7.1).
import { Point, Rect } from '../geometry';
import { buildTemplateDef, classifyOnly, type CatalogIssue, type JsonObject, type ShapeTemplate } from '../template';
import {
  ConnectionObject,
  GroupObject,
  MultiObjects,
  TemplatedObject,
  type LekhDocument,
  type LekhObject,
} from '../model';
import { Style } from '../style';
import { cloneObjects, cloneWithConnections } from './clone';
import { MultiSelection, isMulti, selectionOf, targetStyle, type EditTarget } from './edit-target';
import type { EditorContext } from './editor-context';
import {
  AddObjectAction,
  DeleteObjectAction,
  DrawingProfileChangeAction,
  ExpandAction,
  collectEmbedTemplates,
} from './object-actions';

/** C++ `Clipboard::ObjectInfo`. */
interface ClipInfo {
  dx: number;
  dy: number;
  readonly object: TemplatedObject;
}

/** C++ `Clipboard::SerializedObjects`. */
export interface ClipboardPayload {
  readonly templates: readonly JsonObject[];
  readonly object: JsonObject | null;
}

export class ClipboardService {
  private readonly ctx_: EditorContext;
  private templates_ = new Map<string, ShapeTemplate>();
  private objects_: ClipInfo[] = [];
  private connections_: ConnectionObject[] = [];
  private pastePoint_ = new Point(0, 0);
  private copiedSize_ = { width: 0, height: 0 };
  private readonly copiedStyle_ = new Style();
  private styleCopied_ = false;
  private sizeCopied_ = false;

  constructor(ctx: EditorContext) {
    this.ctx_ = ctx;
  }

  private clear(): void {
    this.objects_ = [];
    this.connections_ = [];
    this.templates_ = new Map();
  }

  get pastePoint(): Point {
    return this.pastePoint_;
  }

  setPastePoint(p: Point): void {
    this.pastePoint_ = p;
  }

  // ---- copy / cut / delete ----

  /** C++ `canCopy(obj)`: anything but a connector. */
  canCopy(target: EditTarget | null): boolean {
    return target !== null && !(target instanceof ConnectionObject);
  }

  canPaste(): boolean {
    return this.objects_.length > 0;
  }

  canDel(target: EditTarget | null): boolean {
    return target !== null;
  }

  canCut(target: EditTarget | null): boolean {
    return this.canCopy(target) && this.canDel(target);
  }

  /** C++ `copy(obj)`: clones of the target (a group with its inner connectors, a multi-selection with its connectors among themselves). */
  copy(target: EditTarget | null): void {
    if (target === null || target instanceof ConnectionObject) return;
    const doc = this.ctx_.doc;
    const store = doc.activePage().objectStore;
    this.clear();
    let objs: LekhObject[] = [];
    if (target instanceof GroupObject) objs = cloneWithConnections(target, store).objects;
    else if (isMulti(target)) objs = cloneObjects(target.objects, false, store.size).clones;
    else if (target instanceof TemplatedObject) {
      const c = target.clone();
      if (c !== null) objs = [c];
    }
    let rect: Rect | null = null;
    for (const o of objs) {
      if (o instanceof ConnectionObject) {
        this.connections_.push(o);
      } else if (o instanceof TemplatedObject) {
        const r = o.selectionRect();
        rect = rect === null ? r : rect.includeRect(r);
        this.objects_.push({ dx: 0, dy: 0, object: o });
      }
    }
    const c = (rect ?? new Rect()).center();
    for (const info of this.objects_) {
      const r = info.object.selectionRect().center();
      info.dx = r.x - c.x;
      info.dy = r.y - c.y;
    }
    // The embedded templates go with the copy, so a paste into another board can resolve them.
    const resolver = this.ctx_.env.codec.env.templates.resolver;
    for (const info of this.objects_) {
      const all = new Map<string, ShapeTemplate>();
      const refs = new Set<string>();
      collectEmbedTemplates(info.object, all, refs);
      for (const [id, t] of all) if (!this.templates_.has(id)) this.templates_.set(id, t.clone());
      for (const id of refs) {
        if (this.templates_.has(id)) continue;
        const t = resolver.getTemplate(id) ?? this.docTemplate(doc, id);
        if (t !== null) this.templates_.set(id, t);
      }
    }
  }

  private docTemplate(doc: LekhDocument, id: string): ShapeTemplate | null {
    const def = doc.get(id);
    return def === undefined ? null : this.ctx_.env.codec.templates.instantiate(def);
  }

  /** C++ `cut`. Returns the selection afterwards (cleared). */
  cut(target: EditTarget | null): EditTarget | null | undefined {
    this.copy(target);
    return this.del(target);
  }

  /**
   * C++ `del(obj)`: the target and its connectors, one undo step. A multi-selection deletes its
   * objects and their connectors. Returns `null` (deselect) when something was deleted.
   */
  del(target: EditTarget | null): null | undefined {
    if (target === null) return undefined;
    const doc = this.ctx_.doc;
    const store = doc.activePage().objectStore;
    const set = new Set<LekhObject>();
    if (isMulti(target)) {
      // C++ `MultiSelectedObjects::deleteObjects`: the shapes and their connectors; a selected
      // connector goes only as a connector of a selected shape (ported as is).
      for (const o of target.objects) {
        o.getDrawingProfile().setIsSelected(false);
        if (o instanceof ConnectionObject || set.has(o)) continue;
        set.add(o);
        for (const c of store.connectionsOf(o)) set.add(c);
      }
    } else {
      for (const c of store.connectionsOf(target)) set.add(c);
      set.add(target);
    }
    if (set.size > 0) this.ctx_.tx.run(new DeleteObjectAction(this.ctx_.env, doc, [...set]));
    return null;
  }

  // ---- paste ----

  /** C++ `setDefaultPastePoint`: the copied set's centre, displaced. */
  setDefaultPastePoint(): void {
    const first = this.objects_[0];
    if (first === undefined) return;
    let rect = first.object.selectionRect();
    for (const info of this.objects_.slice(1)) rect = rect.includeRect(info.object.selectionRect());
    const at = rect.center();
    const d = this.ctx_.config.cloneDisplacement;
    this.pastePoint_ = new Point(at.x + d, at.y + d);
  }

  /**
   * C++ `paste()` / `paste(p)`: fresh clones centred at the paste point, their connectors between
   * them, one undo step. The copied templates the board lacks become document templates first.
   * Returns what to select.
   */
  paste(at?: Point): EditTarget | null | undefined {
    if (at !== undefined) this.pastePoint_ = at;
    if (this.objects_.length === 0) return undefined;
    const doc = this.ctx_.doc;
    const codec = this.ctx_.env.codec;
    const catalog = codec.env.templates.resolver;
    const issues: CatalogIssue[] = [];
    for (const [id, t] of this.templates_) {
      if (catalog.getTemplate(id) !== null || doc.hasTemplate(id)) continue;
      const def = buildTemplateDef(codec.templates.serialize(t), codec.env.generators?.resolve ?? classifyOnly, issues);
      if (def !== null) doc.addTemplate(def);
    }
    const center = this.pastePoint_;
    const storeSize = doc.activePage().objectStore.size;
    const objects: LekhObject[] = [];
    const objectSet = new Map<LekhObject, LekhObject>();
    for (const info of this.objects_) {
      let to: TemplatedObject | null;
      if (info.object instanceof GroupObject) {
        const others = new Map<LekhObject, LekhObject>();
        to = info.object.cloneMapped(others, storeSize);
        for (const [k, v] of others) objectSet.set(k, v);
      } else {
        to = info.object.clone();
      }
      if (to === null) continue;
      objectSet.set(info.object, to);
      const r = to.ds.rect();
      to.ds.setRect(Rect.fromCenter(new Point(center.x + info.dx, center.y + info.dy), r.width, r.height));
      to.getDrawingProfile().setIsSelected(false);
      objects.push(to);
    }
    for (const con of this.connections_) {
      const first = con.first === null ? undefined : objectSet.get(con.first);
      const second = con.second === null ? undefined : objectSet.get(con.second);
      if (first === undefined || second === undefined) continue;
      const copy = con.getCopy(first, second);
      copy.getDrawingProfile().setIsSelected(false);
      objects.push(copy);
    }
    if (objects.length === 0) return undefined;
    this.ctx_.tx.run(new AddObjectAction(this.ctx_.env, doc, objects));
    const sel = selectionOf(objects);
    return sel === null ? undefined : sel;
  }

  // ---- style and size ----

  canCopyStyle(target: EditTarget | null): boolean {
    return target !== null;
  }

  canPasteStyle(): boolean {
    return this.styleCopied_;
  }

  /** C++ `copyStyle`. */
  copyStyle(target: EditTarget | null): void {
    if (target === null) return;
    this.copiedStyle_.copyFrom(targetStyle(target));
    this.styleCopied_ = true;
  }

  /** C++ `pasteStyle`: one undo step (a `DrawingProfileChangeAction`, raised at once). */
  pasteStyle(target: EditTarget | null): void {
    if (!this.styleCopied_ || target === null) return;
    const objs = isMulti(target) ? [...target.objects] : [target];
    const olds: Style[] = [];
    const news: Style[] = [];
    for (const o of objs) {
      olds.push(o.getDrawingProfile().deepClone());
      this.copyStyleTo(o);
      news.push(o.getDrawingProfile().deepClone());
      if (o instanceof TemplatedObject) o.generateData();
      else o.invalidate();
    }
    if (objs.length > 1) targetStyle(target).copyFrom(this.copiedStyle_);
    this.ctx_.tx.record(new DrawingProfileChangeAction(this.ctx_.env, this.ctx_.doc, objs, olds, news));
  }

  private copyStyleTo(o: LekhObject): void {
    o.getDrawingProfile().copyFrom(this.copiedStyle_);
    if (o instanceof GroupObject) for (const m of o.objects()) this.copyStyleTo(m.object);
  }

  canPasteSize(): boolean {
    return this.sizeCopied_;
  }

  /** C++ `copySize`. */
  copySize(target: EditTarget | null): void {
    if (!(target instanceof TemplatedObject)) return;
    const r = target.selectionRect();
    this.copiedSize_ = { width: r.width, height: r.height };
    this.sizeCopied_ = true;
  }

  /** C++ `pasteSize`: the box resized about its centre, one undo step. */
  pasteSize(target: EditTarget | null): void {
    if (!(target instanceof TemplatedObject) || !this.sizeCopied_) return;
    const rect1 = target.ds.rect();
    const rect2 = Rect.fromCenter(rect1.center(), this.copiedSize_.width, this.copiedSize_.height);
    this.ctx_.tx.run(new ExpandAction(this.ctx_.env, this.ctx_.doc, target, { old: rect1, cur: rect2 }));
    target.generateData();
  }

  // ---- the OS clipboard payload ----

  /** C++ `serializeCopiedObject`. */
  serialize(): ClipboardPayload {
    if (this.objects_.length === 0) return { templates: [], object: null };
    const codec = this.ctx_.env.codec;
    const templates = [...this.templates_.values()].map((t) => codec.templates.serialize(t));
    const only = this.objects_[0];
    if (this.objects_.length === 1 && this.connections_.length === 0 && only !== undefined) {
      return { templates, object: codec.writeObject(only.object) };
    }
    const mo = new MultiObjects(codec.env.objects, null);
    mo.setObjects([...this.objects_.map((i) => i.object), ...this.connections_]);
    return { templates, object: mo.empty() ? null : codec.writeObject(mo) };
  }

  /**
   * Takes a payload from the OS clipboard (another board, another app instance): its templates and
   * its object become the copied set. False when the object does not parse.
   */
  load(payload: ClipboardPayload): boolean {
    const codec = this.ctx_.env.codec;
    if (payload.object === null) return false;
    let obj: LekhObject;
    try {
      obj = codec.readObject(payload.object, undefined, this.ctx_.doc).object;
    } catch {
      return false;
    }
    this.clear();
    for (const body of payload.templates) {
      const t = codec.templates.parse(body);
      if (t !== null) this.templates_.set(t.id(), t);
    }
    if (obj instanceof MultiObjects) {
      for (const info of obj.objects()) {
        if (info.object instanceof ConnectionObject) this.connections_.push(info.object);
        else if (info.object instanceof TemplatedObject)
          this.objects_.push({ dx: info.dx, dy: info.dy, object: info.object });
      }
    } else if (obj instanceof TemplatedObject) {
      this.objects_.push({ dx: 0, dy: 0, object: obj });
    }
    return this.objects_.length > 0;
  }
}

/** A multi-selection over `objs` (convenience for hosts and tests). */
export function multiOf(objs: readonly LekhObject[]): MultiSelection {
  return new MultiSelection(objs);
}
