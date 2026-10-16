// Grouping model changes into one undo step plus one update (spec 02 `EditTransaction`, new: no
// C++ class). Three ways in, matching the two C++ idioms and the `ShapeInteraction` context of
// spec 05 §5:
//   - `run(act)`: C++ `act->perform(); UndoManager::addAction(act)` — the command makes the change;
//   - `record(act)`: C++ `addAction(act, true)` — the change was made live (a drag, an editor) and
//     the command only sends its update and becomes the undo step;
//   - `begin(ids)` … `commit()` / `cancel()`: snapshot templated objects, let the caller change them
//     freely, then commit one undo step and one `changeattr` frame for every object that changed
//     (or restore them on cancel). Nothing changed → no step and no frame.
import { writeJsonText } from '../io';
import { TemplatedObject, type LekhDocument } from '../model';
import { snapshotTemplate, type TemplateSnapshot } from './object-actions';
import { EditUpdateType, OutgoingUpdate } from './update';
import { UserAction, type EditEnv } from './user-action';
import type { UndoManager } from './undo-manager';

/** Several templated objects changed together: one undo step, one `changeattr` frame. */
export class TemplatedObjectsChangeAction extends UserAction {
  private readonly olds_: ReadonlyMap<string, TemplateSnapshot>;
  private readonly news_: ReadonlyMap<string, TemplateSnapshot>;

  constructor(
    env: EditEnv,
    doc: LekhDocument,
    pageId: string,
    olds: ReadonlyMap<string, TemplateSnapshot>,
    news: ReadonlyMap<string, TemplateSnapshot>,
  ) {
    super(env, doc);
    this.pageId_ = pageId;
    this.objectIds_ = [...news.keys()];
    this.olds_ = olds;
    this.news_ = news;
  }

  private restore(states: ReadonlyMap<string, TemplateSnapshot>): boolean {
    const page = this.page();
    if (page === null) return false;
    const objs: TemplatedObject[] = [];
    for (const id of this.objectIds_) {
      const o = page.objectStore.getObject(id);
      if (!(o instanceof TemplatedObject)) return false;
      objs.push(o);
    }
    for (const o of objs) {
      const s = states.get(o.id);
      if (s === undefined) continue;
      const stl = o.shapeTemplate();
      if (stl !== null) {
        stl.copyFrom(s.data);
        stl.load();
      }
      o.ds.setAngle(s.angle);
      o.setRect(s.rect);
    }
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.restore(this.news_);
  }

  undo(): boolean {
    return this.restore(this.olds_);
  }

  override raise(): void {
    const page = this.page();
    if (page === null) return;
    const update = new OutgoingUpdate(EditUpdateType.changeAttr);
    for (const id of this.objectIds_) {
      const o = page.objectStore.getObject(id);
      if (!(o instanceof TemplatedObject)) continue;
      const stl = o.shapeTemplate();
      update.set(`${this.objectsPrefix}${o.id}.template`, stl === null ? null : this.templateJson(stl));
      this.populateParamsUpdate(o, update);
    }
    if (update.size > 0) this.send(update);
  }
}

interface Pending {
  readonly doc: LekhDocument;
  readonly pageId: string;
  readonly before: Map<string, { snap: TemplateSnapshot; json: string }>;
}

export class EditTransaction {
  private readonly env_: EditEnv;
  private readonly undo_: UndoManager;
  private pending_: Pending | null = null;

  constructor(env: EditEnv, undo: UndoManager) {
    this.env_ = env;
    this.undo_ = undo;
  }

  get active(): boolean {
    return this.pending_ !== null;
  }

  /** The command makes the change; on success it becomes the undo step. */
  run(act: UserAction): boolean {
    if (!act.perform()) return false;
    this.undo_.addAction(act);
    return true;
  }

  /** The change is already made: send the command's update and push it. */
  record(act: UserAction): void {
    this.undo_.addAction(act, true);
  }

  /** Snapshots the templated objects `ids` of the active page (a second `begin` adds to the set). */
  begin(doc: LekhDocument, ids: readonly string[]): void {
    const page = doc.activePage();
    if (this.pending_ === null || this.pending_.doc !== doc || this.pending_.pageId !== page.id) {
      this.pending_ = { doc, pageId: page.id, before: new Map() };
    }
    for (const id of ids) {
      if (this.pending_.before.has(id)) continue;
      const o = page.objectStore.getObject(id);
      if (!(o instanceof TemplatedObject)) continue;
      this.pending_.before.set(id, { snap: snapshotTemplate(o), json: this.stateOf(o) });
    }
  }

  /** One undo step and one frame for what changed since `begin`; false when nothing did. */
  commit(): boolean {
    const p = this.pending_;
    this.pending_ = null;
    if (p === null) return false;
    const page = p.doc.getPage(p.pageId);
    if (page === null) return false;
    const olds = new Map<string, TemplateSnapshot>();
    const news = new Map<string, TemplateSnapshot>();
    for (const [id, b] of p.before) {
      const o = page.objectStore.getObject(id);
      if (!(o instanceof TemplatedObject) || this.stateOf(o) === b.json) continue;
      olds.set(id, b.snap);
      news.set(id, snapshotTemplate(o));
    }
    if (news.size === 0) return false;
    this.record(new TemplatedObjectsChangeAction(this.env_, p.doc, p.pageId, olds, news));
    return true;
  }

  /** Puts every snapshotted object back; no step, no frame. */
  cancel(): void {
    const p = this.pending_;
    this.pending_ = null;
    if (p === null) return;
    const page = p.doc.getPage(p.pageId);
    if (page === null) return;
    for (const [id, b] of p.before) {
      const o = page.objectStore.getObject(id);
      if (!(o instanceof TemplatedObject)) continue;
      const stl = o.shapeTemplate();
      if (stl !== null) {
        stl.copyFrom(b.snap.data);
        stl.load();
      }
      o.ds.setAngle(b.snap.angle);
      o.setRect(b.snap.rect);
    }
  }

  private stateOf(o: TemplatedObject): string {
    return writeJsonText(this.env_.codec.writeObject(o));
  }
}
