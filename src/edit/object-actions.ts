// The object commands (port of C++ `ObjectsActionBase` … `ObjectOrderChangeAction`,
// `L/UserAction.cpp:264-1395, 1416-1488, 1771-2058`; spec 02 §11). Each `perform` / `undo` makes the
// change and raises the update C++ raised; behaviour, including its quirks, is today's.
import { serializeStyle } from '../io';
import type { Point as PointT, Rect } from '../geometry';
import {
  ArrowLocation,
  ConnectionObject,
  GroupObject,
  LekhObject,
  TemplatedObject,
  type ArrowAt,
  type ConnectionType,
  type LekhDocument,
  type MovableTextInfo,
  type Params,
  cloneParams,
} from '../model';
import { GroupStyle, Style } from '../style';
import {
  TemplateData,
  TextSide,
  jsonEquals,
  type JsonObject,
  type JsonValue,
  type ShapeTemplate,
  type TemplateParam,
  type TextInfo,
} from '../template';
import { EditKeys as K, EditUpdateType, OutgoingUpdate } from './update';
import { ArrowEnd, UserAction, arrowsOf, refreshArrows, type EditEnv } from './user-action';

/** One object or several, as a list. */
function asList(objs: LekhObject | readonly LekhObject[]): readonly LekhObject[] {
  return objs instanceof LekhObject ? [objs] : objs;
}

/** A sorted, de-duplicated id list (C++ `std::set<std::string>`: byte order). */
function sortedIds(objs: readonly LekhObject[]): string[] {
  const ids = [...new Set(objs.map((o) => o.id))];
  ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ids;
}

// ---------------------------------------------------------------------------------------------
// Add / delete

/** C++ `ObjectsActionBase`: add or remove a set of objects (with their templates and help). */
export abstract class ObjectsActionBase extends UserAction {
  /** C++ `initForDeletion`: the ids, sorted (C++ went through a `std::set`). */
  protected initForDeletion(objs: readonly LekhObject[]): void {
    this.objectIds_ = sortedIds(objs);
  }

  /** C++ `initForAddition`: the objects are held until added. */
  protected initForAddition(objs: readonly LekhObject[]): void {
    this.objectIds_ = [];
    for (const o of objs) {
      this.objects_.push(o);
      this.objectIds_.push(o.id);
    }
  }

  /** C++ `add`: the held objects go onto the page; their embedded templates and help go too. */
  protected add(): boolean {
    const page = this.page();
    if (page === null) return false;
    const update = new OutgoingUpdate(EditUpdateType.addObjects);
    const helpTexts = new Map<string, string>();
    const embeds = new Map<string, ShapeTemplate>();
    const embedRefs = new Set<string>();
    for (const obj of this.objects_) {
      page.objectStore.add(obj);
      update.set(this.objectsPrefix + obj.id, this.objectJson(obj));
      if (obj instanceof TemplatedObject) {
        collectEmbedTemplates(obj, embeds, embedRefs);
        const stl = obj.shapeTemplate();
        if (stl !== null) {
          const help = this.env.codec.env.help?.(stl.id()) ?? '';
          if (help !== '') helpTexts.set(stl.id(), help);
        }
      }
    }
    this.objects_ = [];
    this.refreshTemplatedObject();

    const templates = new Map<string, ShapeTemplate>();
    for (const [id, t] of embeds) if (!this.document_.hasTemplate(id)) templates.set(id, t);
    for (const id of embedRefs) {
      if (this.document_.hasTemplate(id) || templates.has(id)) continue;
      const t = this.env.codec.env.templates.resolver.getTemplate(id);
      if (t !== null) templates.set(id, t);
    }
    const underscored = (id: string) => id.split('.').join('_');
    for (const [id, text] of helpTexts) update.set(`${K.doc}.${K.help}.${underscored(id)}`, { id, text });
    for (const [id, t] of templates) update.set(`${K.doc}.${K.templates}.${underscored(id)}`, this.templateJson(t));
    this.send(update);
    return true;
  }

  /** C++ `remove`: all of this command's ids or nothing; their connectors go too. */
  protected remove(): boolean {
    const page = this.page();
    if (page === null) return false;
    const update = new OutgoingUpdate(EditUpdateType.delObjects);
    this.objects_ = [];
    if (!page.objectStore.removeObjects(this.objectIds_, this.objects_)) return false;
    this.removeConnections(page, this.objects_, update);
    if (page.objectStore.size === 0) {
      const all = new OutgoingUpdate(EditUpdateType.delAllObjects);
      all.set(`${K.doc}.${K.pages}.${this.pageId_}.${K.objects}`, {});
      this.send(all);
    } else {
      for (const id of this.objectIds_) update.set(this.objectsPrefix + id, null);
      this.send(update);
    }
    return true;
  }
}

/** C++ `LekhUtil::getEmbedTemplatesFromObject`: embedded templates by id, and generator embed refs. */
export function collectEmbedTemplates(obj: TemplatedObject, out: Map<string, ShapeTemplate>, refs: Set<string>): void {
  if (obj instanceof GroupObject) {
    for (const m of obj.objects()) collectEmbedTemplates(m.object, out, refs);
    return;
  }
  const stl = obj.shapeTemplate();
  if (stl === null) return;
  for (const e of stl.embeds()) if (!out.has(e.template.id())) out.set(e.template.id(), e.template);
  if (stl.generator !== null) for (const r of stl.generator.embedReferences()) refs.add(r);
}

/** C++ `AddObjectAction`. */
export class AddObjectAction extends ObjectsActionBase {
  constructor(env: EditEnv, doc: LekhDocument, objs: LekhObject | readonly LekhObject[]) {
    super(env, doc);
    this.initForAddition(asList(objs));
  }

  perform(): boolean {
    return this.add();
  }

  undo(): boolean {
    return this.remove();
  }
}

/** C++ `DeleteObjectAction`. */
export class DeleteObjectAction extends ObjectsActionBase {
  constructor(env: EditEnv, doc: LekhDocument, objs: LekhObject | readonly LekhObject[]) {
    super(env, doc);
    this.initForDeletion(asList(objs));
  }

  perform(): boolean {
    return this.remove();
  }

  undo(): boolean {
    return this.add();
  }
}

// ---------------------------------------------------------------------------------------------
// Transforms

/** C++ `TranslateObjectAction`. Snapping is off while it moves (the objects get no scene). */
export class TranslateObjectAction extends UserAction {
  private readonly dx: number;
  private readonly dy: number;

  constructor(env: EditEnv, doc: LekhDocument, objs: LekhObject | readonly LekhObject[], dx: number, dy: number) {
    super(env, doc);
    this.objectIds_ = asList(objs).map((o) => o.id);
    this.dx = dx;
    this.dy = dy;
  }

  private move(dx: number, dy: number): boolean {
    const objs = this.getObjects();
    if (objs === null) return false;
    for (const obj of objs) {
      if (obj instanceof TemplatedObject) obj.setUndoRedoModificationMode(true);
      obj.startModification();
      obj.translate(dx, dy);
      if (obj instanceof TemplatedObject) obj.setUndoRedoModificationMode(false);
    }
    this.raiseFor(objs);
    return true;
  }

  perform(): boolean {
    return this.move(this.dx, this.dy);
  }

  undo(): boolean {
    return this.move(-this.dx, -this.dy);
  }

  override raise(): void {
    this.raiseFor(this.getObjects() ?? []);
  }

  /** C++ `raise(objs)`: the centres of the templated objects. */
  private raiseFor(objs: readonly LekhObject[]): void {
    const update = new OutgoingUpdate(EditUpdateType.changeAttr);
    for (const obj of objs) {
      if (!(obj instanceof TemplatedObject)) continue;
      const p = `${this.objectsPrefix}${obj.id}.${K.params}.`;
      update.set(p + K.cx, obj.ds.cx());
      update.set(p + K.cy, obj.ds.cy());
    }
    this.send(update);
  }
}

/** C++ `VertexEditAction`. */
export class VertexEditAction extends UserAction {
  private readonly vid: number;
  private readonly origVertex: PointT;
  private readonly newVertex: PointT;

  constructor(env: EditEnv, doc: LekhDocument, obj: LekhObject, vid: number, orig: PointT, newp: PointT) {
    super(env, doc);
    this.objectIds_ = [obj.id];
    this.vid = vid;
    this.origVertex = orig;
    this.newVertex = newp;
  }

  private moveTo(p: PointT): boolean {
    const tobj = this.getTemplatedObject();
    if (tobj === null) return false;
    tobj.moveVertexTo(this.vid, p);
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.moveTo(this.newVertex);
  }

  undo(): boolean {
    return this.moveTo(this.origVertex);
  }

  override raise(): void {
    this.raiseTemplateChange();
  }
}

/** C++ `RotateAction`. */
export class RotateAction extends UserAction {
  private readonly rotation: number;

  constructor(env: EditEnv, doc: LekhDocument, objs: LekhObject | readonly LekhObject[], rotation: number) {
    super(env, doc);
    this.objectIds_ = asList(objs).map((o) => o.id);
    this.rotation = rotation;
  }

  private turn(angle: number): boolean {
    const objs = this.getObjects();
    if (objs === null) return false;
    for (const obj of objs) {
      obj.startModification();
      obj.rotate(angle);
      obj.finishRotating();
    }
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.turn(this.rotation);
  }

  undo(): boolean {
    return this.turn(-this.rotation);
  }

  override raise(): void {
    const objs = this.getObjects();
    if (objs === null) return;
    const update = new OutgoingUpdate(EditUpdateType.changeAttr);
    for (const obj of objs) {
      if (obj instanceof TemplatedObject)
        update.set(`${this.objectsPrefix}${obj.id}.${K.params}.${K.angle}`, obj.ds.angle());
    }
    this.send(update);
  }
}

/** C++ `ScaleAction`. */
export class ScaleAction extends UserAction {
  private readonly factor: number;

  constructor(env: EditEnv, doc: LekhDocument, obj: LekhObject, factor: number) {
    super(env, doc);
    this.objectIds_ = [obj.id];
    this.factor = factor;
  }

  private by(f: number): boolean {
    const tobj = this.getTemplatedObject();
    if (tobj === null) return false;
    tobj.startModification();
    tobj.scale(f, f);
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.by(this.factor);
  }

  undo(): boolean {
    return this.by(1 / this.factor);
  }

  override raise(): void {
    this.raiseParams();
  }
}

/** C++ `TextEditAction`. */
export class TextEditAction extends UserAction {
  private readonly origText: string;
  private readonly newText: string;
  private readonly index: number;

  constructor(env: EditEnv, doc: LekhDocument, obj: LekhObject, origText: string, newText: string, index: number) {
    super(env, doc);
    this.objectIds_ = [obj.id];
    this.origText = origText;
    this.newText = newText;
    this.index = index;
  }

  private setText(t: string): boolean {
    const obj = this.getObject();
    if (obj === null) return false;
    obj.updateText(t, this.index);
    this.refreshTemplatedObject();
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.setText(this.newText);
  }

  undo(): boolean {
    return this.setText(this.origText);
  }

  override raise(): void {
    if (this.getObject() instanceof ConnectionObject) this.raiseConnectionTexts();
    else this.raiseTemplateChange();
  }
}

/** C++ `FlipAction`: a flip is its own inverse. */
export class FlipAction extends UserAction {
  private readonly type: number;

  constructor(env: EditEnv, doc: LekhDocument, obj: LekhObject, type: number) {
    super(env, doc);
    this.objectIds_ = [obj.id];
    this.type = type;
  }

  perform(): boolean {
    const tobj = this.getTemplatedObject();
    if (tobj === null) return false;
    tobj.flip(this.type);
    this.raise();
    return true;
  }

  undo(): boolean {
    return this.perform();
  }

  override raise(): void {
    const tobj = this.getTemplatedObject();
    // C++: an object without a template raised nothing ("TODO: handle").
    if (tobj?.shapeTemplate() != null) this.raiseTemplateChange();
  }
}

/** C++ `ArrowAddEraseAction`: add or erase one arrowhead. */
export class ArrowAddEraseAction extends UserAction {
  private readonly info: ArrowAt;
  private readonly adds: boolean;

  constructor(env: EditEnv, doc: LekhDocument, obj: LekhObject, info: ArrowAt, type: 'add' | 'erase') {
    super(env, doc);
    this.objectIds_ = [obj.id];
    this.info = info;
    this.adds = type === 'add';
  }

  private set(present: boolean): boolean {
    const obj = this.getObject();
    const arrows = arrowsOf(obj);
    if (obj === null || arrows === null) return false;
    const t = present ? this.info.template : null;
    if (this.info.location === ArrowLocation.Start) arrows.setStart(t);
    else arrows.setEnd(t);
    refreshArrows(obj);
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.set(this.adds);
  }

  undo(): boolean {
    return this.set(!this.adds);
  }

  override raise(): void {
    this.raiseArrowChange(this.info.location === ArrowLocation.Start ? ArrowEnd.Start : ArrowEnd.End);
  }
}

/** C++ `ArrowChangeAction`: replace the start and/or end arrowhead. */
export class ArrowChangeAction extends UserAction {
  private readonly startOld: ShapeTemplate | null;
  private readonly startNew: ShapeTemplate | null;
  private readonly endOld: ShapeTemplate | null;
  private readonly endNew: ShapeTemplate | null;

  constructor(
    env: EditEnv,
    doc: LekhDocument,
    obj: LekhObject,
    startOld: ShapeTemplate | null,
    startNew: ShapeTemplate | null,
    endOld: ShapeTemplate | null,
    endNew: ShapeTemplate | null,
  ) {
    super(env, doc);
    this.objectIds_ = [obj.id];
    this.startOld = startOld;
    this.startNew = startNew;
    this.endOld = endOld;
    this.endNew = endNew;
  }

  private get touchesStart(): boolean {
    return this.startOld !== null || this.startNew !== null;
  }

  private get touchesEnd(): boolean {
    return this.endOld !== null || this.endNew !== null;
  }

  private set(start: ShapeTemplate | null, end: ShapeTemplate | null): boolean {
    const obj = this.getObject();
    const arrows = arrowsOf(obj);
    if (obj === null || arrows === null) return false;
    if (this.touchesStart) arrows.setStart(start);
    if (this.touchesEnd) arrows.setEnd(end);
    refreshArrows(obj);
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.set(this.startNew, this.endNew);
  }

  undo(): boolean {
    return this.set(this.startOld, this.endOld);
  }

  override raise(): void {
    const s = this.touchesStart;
    const e = this.touchesEnd;
    if (s && e) this.raiseArrowChange(ArrowEnd.Both);
    else if (s) this.raiseArrowChange(ArrowEnd.Start);
    else if (e) this.raiseArrowChange(ArrowEnd.End);
  }
}

// ---------------------------------------------------------------------------------------------
// Style

/**
 * C++ `DrawingProfileChangeAction`: each object's style before and after (deep clones). The update
 * is the per-attribute difference; a group also writes each member's difference under
 * `….objects.<member>.object` so the backend stores the members' styles.
 */
export class DrawingProfileChangeAction extends UserAction {
  private olds_: Style[];
  private news_: Style[];

  constructor(
    env: EditEnv,
    doc: LekhDocument,
    objs: readonly LekhObject[],
    olds: readonly Style[],
    news: readonly Style[],
  ) {
    super(env, doc);
    this.objectIds_ = objs.map((o) => o.id);
    this.olds_ = olds.slice(0, objs.length);
    this.news_ = news.slice(0, objs.length);
  }

  /** C++ `hasObjects`: the same ids (nulls skipped). */
  hasObjects(objs: readonly (LekhObject | null)[]): boolean {
    if (objs.length !== this.objectIds_.length) return false;
    return objs.every((o) => o === null || this.objectIds_.includes(o.id));
  }

  /** C++ `setNewStyle`: a continued change of the same kind updates this step and raises again. */
  setNewStyle(styles: readonly Style[]): void {
    if (styles.length !== this.news_.length) return;
    this.news_ = styles.slice();
    this.raise();
  }

  /** C++ `getObjects` (this class's own): stops at the first id not on the page. */
  private resolve(): LekhObject[] {
    const page = this.page();
    const out: LekhObject[] = [];
    if (page === null) return out;
    for (const id of this.objectIds_) {
      const o = page.objectStore.getObject(id);
      if (o === null) return out;
      out.push(o);
    }
    return out;
  }

  private apply(styles: readonly Style[], undo: boolean): boolean {
    const objs = this.resolve();
    if (objs.length !== styles.length) return false;
    const multi = objs.length > 1;
    objs.forEach((obj, i) => {
      const dp = obj.getDrawingProfile();
      dp.deepCopyFrom(styles[i] as Style);
      if (multi) {
        dp.setIsSelected(true);
        dp.setIsSelected(false);
      }
      obj.invalidate();
    });
    this.refreshTemplatedObject();
    this.raiseAs(undo);
    return true;
  }

  perform(): boolean {
    return this.apply(this.news_, false);
  }

  undo(): boolean {
    return this.apply(this.olds_, true);
  }

  override raise(): void {
    this.raiseAs(false);
  }

  private raiseAs(undo: boolean): void {
    const objs = this.resolve();
    if (objs.length !== this.news_.length || objs.length !== this.olds_.length) return;
    const update = new OutgoingUpdate(EditUpdateType.changeStyle);
    objs.forEach((obj, i) => {
      const o = (undo ? this.news_[i] : this.olds_[i]) as Style;
      const n = (undo ? this.olds_[i] : this.news_[i]) as Style;
      styleUpdate(obj, this.objectsPrefix + obj.id, update, o, n);
    });
    this.send(update);
  }
}

/** C++ `DrawingProfileChangeAction::getUpdate`. */
function styleUpdate(obj: LekhObject, path: string, update: OutgoingUpdate, olds: Style, news: Style): void {
  if (obj instanceof GroupObject && olds instanceof GroupStyle && news instanceof GroupStyle) {
    const members = obj.objects();
    const op = olds.getProfiles();
    const np = news.getProfiles();
    for (let i = 0; i < members.length; i++) {
      const os = op[i];
      const ns = np[i];
      if (os === undefined || ns === undefined) break;
      const m = (members[i] as (typeof members)[number]).object;
      styleUpdate(m, `${path}.${K.objects}.${m.id}.object`, update, os, ns);
    }
  }
  // The group's own entry too, so clients apply it (C++ comment).
  const spath = obj instanceof TemplatedObject ? `${path}.${K.stemplate}.${K.style}` : `${path}.${K.style}`;
  const diff = styleDiff(serializeStyle(olds), serializeStyle(news));
  for (const k of Object.keys(diff)) update.set(`${spath}.${k}`, diff[k] as JsonValue);
}

/**
 * C++ `getDiff`: an attribute dropped by the new style gets the default style's value (when the
 * default has one); a changed or new attribute gets the new value.
 */
export function styleDiff(oldn: JsonObject, newn: JsonObject): Record<string, JsonValue> {
  const def = serializeStyle(new Style(), true);
  const out: Record<string, JsonValue> = {};
  for (const k of Object.keys(oldn)) {
    const nv = newn[k];
    if (nv === undefined) {
      const dv = def[k];
      if (dv !== undefined) out[k] = dv;
    } else if (!jsonEquals(oldn[k] as JsonValue, nv)) {
      out[k] = nv;
    }
  }
  for (const k of Object.keys(newn)) if (!(k in oldn)) out[k] = newn[k] as JsonValue;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Box and template changes

/** C++ `ExpandAction`: a resize by deltas, or from one box to another. */
export class ExpandAction extends UserAction {
  private readonly rects_: { old: Rect; cur: Rect } | null;
  private readonly dx_: number;
  private readonly dy_: number;
  private readonly anchor_: number;

  constructor(
    env: EditEnv,
    doc: LekhDocument,
    obj: LekhObject,
    change: { old: Rect; cur: Rect } | { dx: number; dy: number; anchor: number },
  ) {
    super(env, doc);
    this.objectIds_ = [obj.id];
    if ('old' in change) {
      this.rects_ = { old: change.old, cur: change.cur };
      this.dx_ = 0;
      this.dy_ = 0;
      this.anchor_ = 0;
    } else {
      this.rects_ = null;
      this.dx_ = change.dx;
      this.dy_ = change.dy;
      this.anchor_ = change.anchor;
    }
  }

  private to(forward: boolean): boolean {
    const tobj = this.getTemplatedObject();
    if (tobj === null) return false;
    if (this.rects_ !== null) {
      tobj.setRect(forward ? this.rects_.cur : this.rects_.old);
    } else {
      tobj.startModification();
      const s = forward ? 1 : -1;
      tobj.expand(s * this.dx_, s * this.dy_, this.anchor_);
    }
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.to(true);
  }

  undo(): boolean {
    return this.to(false);
  }

  override raise(): void {
    this.raiseParams();
  }
}

/** C++ `TemplateModificationAction`: data expressions plus the box (flip, make equilateral). */
export class TemplateModificationAction extends UserAction {
  private readonly oldExprs_: readonly string[];
  private readonly newExprs_: readonly string[];
  private readonly oldRect_: Rect;
  private readonly newRect_: Rect;
  private readonly oldAngle_: number;
  private readonly newAngle_: number;

  constructor(
    env: EditEnv,
    doc: LekhDocument,
    obj: LekhObject,
    old: { exprs: readonly string[]; rect: Rect; angle: number },
    cur: { exprs: readonly string[]; rect: Rect; angle: number },
  ) {
    super(env, doc);
    this.objectIds_ = [obj.id];
    this.oldExprs_ = old.exprs.slice();
    this.newExprs_ = cur.exprs.slice();
    this.oldRect_ = old.rect;
    this.newRect_ = cur.rect;
    this.oldAngle_ = old.angle;
    this.newAngle_ = cur.angle;
  }

  private set(exprs: readonly string[], rect: Rect, angle: number): boolean {
    const tobj = this.getTemplatedObject();
    const stl = tobj?.shapeTemplate() ?? null;
    if (tobj === null || stl === null) return false;
    stl.setDataExpressions(exprs);
    tobj.ds.setAngle(angle);
    tobj.setRect(rect);
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.set(this.newExprs_, this.newRect_, this.newAngle_);
  }

  undo(): boolean {
    return this.set(this.oldExprs_, this.oldRect_, this.oldAngle_);
  }

  override raise(): void {
    this.raiseTemplateChange();
  }
}

/** A template's whole definition plus its box (the two states of `TemplatedObjectChangeAction`). */
export interface TemplateSnapshot {
  readonly data: TemplateData;
  readonly rect: Rect;
  readonly angle: number;
}

/** Captures a templated object's template definition and box. */
export function snapshotTemplate(obj: TemplatedObject): TemplateSnapshot {
  const data = new TemplateData();
  const stl = obj.shapeTemplate();
  if (stl !== null) data.copyFrom(stl);
  return { data, rect: obj.ds.rect(), angle: obj.ds.angle() };
}

/** C++ `TemplatedObjectChangeAction`: a snapshot-based change of a templated object. */
export class TemplatedObjectChangeAction extends UserAction {
  private readonly old_: TemplateSnapshot;
  private readonly new_: TemplateSnapshot;

  constructor(env: EditEnv, doc: LekhDocument, obj: LekhObject, old: TemplateSnapshot, cur: TemplateSnapshot) {
    super(env, doc);
    this.objectIds_ = [obj.id];
    this.old_ = old;
    this.new_ = cur;
  }

  private restore(s: TemplateSnapshot): boolean {
    const tobj = this.getTemplatedObject();
    if (tobj === null) return false;
    const stl = tobj.shapeTemplate();
    if (stl !== null) {
      stl.copyFrom(s.data);
      stl.load();
    }
    tobj.ds.setAngle(s.angle);
    tobj.setRect(s.rect);
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.restore(this.new_);
  }

  undo(): boolean {
    return this.restore(this.old_);
  }

  override raise(): void {
    this.raiseTemplateChange();
  }
}

/**
 * C++ `makeTitleSideChange`: moves `obj`'s title to `side` and returns the applied action, or
 * null when it has no title, `side` is none, or the title is already there.
 */
export function makeTitleSideChange(
  env: EditEnv,
  doc: LekhDocument,
  obj: TemplatedObject | null,
  side: TextSide,
): TemplatedObjectChangeAction | null {
  const stl = obj?.shapeTemplate() ?? null;
  if (obj === null || stl === null || stl.titleIndex() < 0 || side === TextSide.None || stl.titleSide() === side) {
    return null;
  }
  const old = snapshotTemplate(obj);
  stl.setTitleSide(side);
  stl.load();
  obj.generateData();
  return new TemplatedObjectChangeAction(env, doc, obj, old, snapshotTemplate(obj));
}

/** C++ `TemplateParamChangeAction`: template parameters, and the texts when a generator rewrote them. */
export class TemplateParamChangeAction extends UserAction {
  private readonly newParam_: readonly TemplateParam[];
  private readonly oldParam_: readonly TemplateParam[];
  private readonly newTexts_: readonly TextInfo[];
  private readonly oldTexts_: readonly TextInfo[];

  constructor(
    env: EditEnv,
    doc: LekhDocument,
    obj: TemplatedObject,
    newParam: readonly TemplateParam[],
    oldParam: readonly TemplateParam[],
    newTexts: readonly TextInfo[] = [],
    oldTexts: readonly TextInfo[] = [],
  ) {
    super(env, doc);
    this.objectIds_ = [obj.id];
    this.newParam_ = newParam.map((p) => p.clone());
    this.oldParam_ = oldParam.map((p) => p.clone());
    this.newTexts_ = newTexts.map((t) => t.clone());
    this.oldTexts_ = oldTexts.map((t) => t.clone());
  }

  private hasTexts(): boolean {
    return this.oldTexts_.length > 0 || this.newTexts_.length > 0;
  }

  private set(params: readonly TemplateParam[], texts: readonly TextInfo[]): boolean {
    const tobj = this.getTemplatedObject();
    const stl = tobj?.shapeTemplate() ?? null;
    if (tobj === null || stl === null) return false;
    if (this.hasTexts()) {
      stl.clearTextData();
      for (const t of texts) stl.textData.push(t.clone());
    }
    stl.params = params.map((p) => p.clone());
    stl.load();
    tobj.generateData();
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.set(this.newParam_, this.newTexts_);
  }

  undo(): boolean {
    return this.set(this.oldParam_, this.oldTexts_);
  }

  override raise(): void {
    if (this.hasTexts()) this.raiseTemplateChange();
    else this.raiseTemplateParams();
  }
}

// ---------------------------------------------------------------------------------------------
// Connectors

/** C++ `ConnectionVertexEditAction`. */
export class ConnectionVertexEditAction extends UserAction {
  private readonly newParams_: Params;
  private readonly oldParams_: Params;

  constructor(env: EditEnv, doc: LekhDocument, con: ConnectionObject, newParams: Params, oldParams: Params) {
    super(env, doc);
    this.objectIds_ = [con.id];
    this.newParams_ = cloneParams(newParams);
    this.oldParams_ = cloneParams(oldParams);
  }

  private set(p: Params): boolean {
    const con = this.getConnectionObject();
    if (con === null) return false;
    con.setParams(cloneParams(p));
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.set(this.newParams_);
  }

  undo(): boolean {
    return this.set(this.oldParams_);
  }

  override raise(): void {
    this.raiseConnectionParams();
  }
}

/** C++ `ChangeConnectionAction`: a connector's type and params. */
export class ChangeConnectionAction extends UserAction {
  private readonly newType_: ConnectionType;
  private readonly newParams_: Params;
  private readonly oldType_: ConnectionType;
  private readonly oldParams_: Params;

  constructor(
    env: EditEnv,
    doc: LekhDocument,
    con: ConnectionObject,
    newType: ConnectionType,
    newParams: Params,
    oldType: ConnectionType,
    oldParams: Params,
  ) {
    super(env, doc);
    this.objectIds_ = [con.id];
    this.newType_ = newType;
    this.newParams_ = cloneParams(newParams);
    this.oldType_ = oldType;
    this.oldParams_ = cloneParams(oldParams);
  }

  private set(type: ConnectionType, p: Params): boolean {
    const con = this.getConnectionObject();
    if (con === null) return false;
    con.changeTypeTo(type);
    con.setParams(cloneParams(p));
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.set(this.newType_, this.newParams_);
  }

  undo(): boolean {
    return this.set(this.oldType_, this.oldParams_);
  }

  override raise(): void {
    this.raiseConnectionParams();
  }
}

/** C++ `TextMoveAction`: a connector label moved along its route. */
export class TextMoveAction extends UserAction {
  private readonly mti_: MovableTextInfo;
  private readonly newParam_: number;

  constructor(env: EditEnv, doc: LekhDocument, mi: MovableTextInfo, newParam: number) {
    super(env, doc);
    this.mti_ = mi;
    this.newParam_ = newParam;
    this.objectIds_ = [mi.obj.id];
  }

  private moveTo(param: number): boolean {
    const obj = this.getObject();
    if (obj === null) return false;
    obj.moveText(this.mti_.index, param);
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.moveTo(this.newParam_);
  }

  undo(): boolean {
    return this.moveTo(this.mti_.param);
  }

  override raise(): void {
    this.raiseConnectionTexts();
  }
}

// ---------------------------------------------------------------------------------------------
// Structure

/** C++ `ConvertObjectsAction`: strokes replaced by a recognised shape. */
export class ConvertObjectsAction extends UserAction {
  private to_: LekhObject | null;
  private readonly toId_: string;

  constructor(env: EditEnv, doc: LekhDocument, objs: readonly LekhObject[], to: LekhObject) {
    super(env, doc);
    this.objectIds_ = objs.map((o) => o.id);
    this.to_ = to;
    this.toId_ = to.id;
  }

  perform(): boolean {
    const page = this.page();
    if (page === null || this.objectIds_.length === 0 || this.to_ === null) return false;
    this.objects_ = [];
    if (!page.objectStore.removeObjects(this.objectIds_, this.objects_)) return false;
    const to = this.to_;
    to.order = (this.objects_[0] as LekhObject).order;
    const update = new OutgoingUpdate(EditUpdateType.convertObjects);
    this.removeConnections(page, this.objects_, update);
    update.set(this.objectsPrefix + this.toId_, this.objectJson(to));
    page.objectStore.add(to);
    this.to_ = null;
    for (const id of this.objectIds_) update.set(this.objectsPrefix + id, null);
    this.send(update);
    return true;
  }

  undo(): boolean {
    const page = this.page();
    if (page === null) return false;
    const to = page.objectStore.removeById(this.toId_);
    if (to === null) return false;
    this.to_ = to;
    const update = new OutgoingUpdate(EditUpdateType.convertObjects);
    this.removeConnections(page, [to], update);
    for (const obj of this.objects_) {
      page.objectStore.add(obj);
      update.set(this.objectsPrefix + obj.id, this.objectJson(obj));
    }
    this.objects_ = [];
    update.set(this.objectsPrefix + this.toId_, null);
    this.send(update);
    return true;
  }
}

/** C++ `GroupAction`: group templated objects, or ungroup a group. */
export class GroupAction extends UserAction {
  private readonly grouping_: boolean;
  private gid_ = '';
  private group_: GroupObject | null = null;

  constructor(env: EditEnv, doc: LekhDocument, target: readonly TemplatedObject[] | GroupObject) {
    super(env, doc);
    if (target instanceof GroupObject) {
      this.gid_ = target.id;
      this.objectIds_ = target.objects().map((c) => c.object.id);
      this.grouping_ = false;
    } else {
      this.objectIds_ = target.map((o) => o.id);
      this.grouping_ = true;
    }
  }

  /** The group the last `group()` made (C++ `groupObject()`). */
  groupObject(): GroupObject | null {
    return this.group_;
  }

  perform(): boolean {
    return this.grouping_ ? this.group() : this.ungroup();
  }

  undo(): boolean {
    return this.grouping_ ? this.ungroup() : this.group();
  }

  private group(): boolean {
    const page = this.page();
    if (page === null) return false;
    this.objects_ = [];
    if (!page.objectStore.removeObjects(this.objectIds_, this.objects_)) return false;
    const update = new OutgoingUpdate(EditUpdateType.convertObjects);
    const tobjs: TemplatedObject[] = [];
    for (const o of this.objects_) {
      if (o instanceof TemplatedObject) tobjs.push(o);
      update.set(this.objectsPrefix + o.id, null);
    }
    const g = new GroupObject(this.env.codec.env.objects, tobjs, this.gid_ === '' ? undefined : this.gid_);
    this.gid_ = g.id;
    g.order = (this.objects_[0] as LekhObject).order;
    page.objectStore.add(g);
    update.set(this.objectsPrefix + g.id, this.objectJson(g));
    this.group_ = g;
    this.objects_ = [];
    this.send(update);
    return true;
  }

  private ungroup(): boolean {
    const page = this.page();
    if (page === null) return false;
    const g = page.objectStore.getObject(this.gid_);
    if (!(g instanceof GroupObject)) return false;
    const update = new OutgoingUpdate(EditUpdateType.convertObjects);
    // The group leaves first: removing it releases its members' nested registration, which would
    // otherwise drop the entries they get as top-level objects (C++ added them, then removed it).
    page.objectStore.remove(g);
    for (const c of g.objects()) {
      page.objectStore.add(c.object);
      update.set(this.objectsPrefix + c.object.id, this.objectJson(c.object));
    }
    update.set(this.objectsPrefix + this.gid_, null);
    this.send(update);
    return true;
  }
}

/** C++ `ObjectOrderChangeAction`: move to the front or the back. */
export class ObjectOrderChangeAction extends UserAction {
  private readonly fromOrder_: number;
  private readonly toOrder_: number;

  constructor(env: EditEnv, doc: LekhDocument, obj: LekhObject, toTop: boolean) {
    super(env, doc);
    this.objectIds_ = [obj.id];
    const store = doc.activePage().objectStore;
    this.toOrder_ = toTop ? store.nextOrder() : store.prevOrder();
    this.fromOrder_ = obj.order;
  }

  private moveTo(order: number): boolean {
    const page = this.page();
    if (page === null) return false;
    const tobj = this.getTemplatedObject();
    if (tobj === null) return false;
    page.objectStore.moveToOrder(tobj, order);
    const update = new OutgoingUpdate(EditUpdateType.changeAttr);
    update.set(`${this.objectsPrefix}${this.objectIds_[0] ?? ''}.${K.order}`, Math.trunc(order));
    this.send(update);
    return true;
  }

  perform(): boolean {
    return this.moveTo(this.toOrder_);
  }

  undo(): boolean {
    return this.moveTo(this.fromOrder_);
  }
}
