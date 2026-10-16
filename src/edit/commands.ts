// The selection commands of C++ `app::Command` that edit the document (`L/app/Command.cpp`: flip,
// z-order, group, ungroup, duplicate, delete, clear, undo, redo) and of `MultiSelectedObjects`
// (`groupObjects`, `cloneObjects`). The selection is an argument and the selection afterwards is
// the result (C11); keyboard mapping, zoom and text-entry commands are `interaction/`'s.
import { GroupObject, TemplatedObject, type LekhObject } from '../model';
import { cloneObjects, performGroupClone } from './clone';
import type { ClipboardService } from './clipboard';
import { MultiSelection, isMulti, type EditTarget, type SelectionChange } from './edit-target';
import type { EditorContext } from './editor-context';
import {
  AddObjectAction,
  DeleteObjectAction,
  GroupAction,
  ObjectOrderChangeAction,
  TemplateModificationAction,
} from './object-actions';

export class EditCommands {
  readonly ctx: EditorContext;
  readonly clipboard: ClipboardService;

  constructor(ctx: EditorContext, clipboard: ClipboardService) {
    this.ctx = ctx;
    this.clipboard = clipboard;
  }

  /** C++ `flip(type)` (1 horizontal, 2 vertical): `flipShape` recorded as a `TemplateModificationAction`. */
  flip(target: EditTarget | null, type: number): SelectionChange {
    if (!(target instanceof TemplatedObject)) return undefined;
    const r = target.flipShape(type);
    if (r !== null) {
      this.ctx.tx.record(
        new TemplateModificationAction(
          this.ctx.env,
          this.ctx.doc,
          target,
          { exprs: r.oldExprs, rect: r.oldRect, angle: r.oldAngle },
          { exprs: r.newExprs, rect: r.newRect, angle: r.newAngle },
        ),
      );
    }
    return target;
  }

  /** C++ `changeZOrder(type)`: 1 to the front, else to the back. */
  changeZOrder(target: EditTarget | null, type: number): void {
    if (target === null || isMulti(target)) return;
    this.ctx.tx.run(new ObjectOrderChangeAction(this.ctx.env, this.ctx.doc, target, type === 1));
  }

  /** C++ `canMoveToFront` / `canMoveToBack`: more than one object on the page. */
  canChangeZOrder(): boolean {
    return this.ctx.doc.activePage().objectStore.size > 1;
  }

  /** C++ `groupSelectedObjects` → `MultiSelectedObjects::groupObjects`. */
  group(target: EditTarget | null): SelectionChange {
    if (!isMulti(target)) return undefined;
    const tobjs = target.objects.filter((o): o is TemplatedObject => o instanceof TemplatedObject);
    // C++ counts every selected object here, connectors included.
    if (target.objects.length < 2) return null;
    const act = new GroupAction(this.ctx.env, this.ctx.doc, tobjs);
    this.ctx.tx.run(act);
    return act.groupObject() ?? null;
  }

  /** C++ `ungroup(obj)`: selects the first former member. */
  ungroup(target: EditTarget | null): SelectionChange {
    if (!(target instanceof GroupObject)) return undefined;
    const first = target.objects()[0]?.object ?? null;
    this.ctx.tx.run(new GroupAction(this.ctx.env, this.ctx.doc, target));
    return first ?? undefined;
  }

  /**
   * C++ `duplicate(obj, displace)`: a multi-selection clones its objects (displaced), a group
   * `performClone`s, anything else is cloned and moved by `cloneDisplacement`. One undo step.
   */
  duplicate(target: EditTarget | null, displace = true): SelectionChange {
    if (target === null) return undefined;
    const ctx = this.ctx;
    const d = ctx.config.cloneDisplacement;
    if (isMulti(target)) {
      for (const o of target.objects) o.getDrawingProfile().setIsSelected(false);
      const { clones } = cloneObjects(target.objects, false, ctx.doc.activePage().objectStore.size);
      for (const c of clones) {
        if (c instanceof TemplatedObject) {
          c.ds.setCx(c.ds.cx() + d);
          c.ds.setCy(c.ds.cy() + d);
        }
      }
      ctx.tx.run(new AddObjectAction(ctx.env, ctx.doc, clones));
      return new MultiSelection(clones);
    }
    if (target instanceof GroupObject) return performGroupClone(ctx, target);
    const clone = target.clone();
    if (clone === null) return undefined;
    if (displace) {
      clone.startModification();
      clone.translate(d, d);
    }
    ctx.tx.run(new AddObjectAction(ctx.env, ctx.doc, clone));
    return clone;
  }

  /** C++ `del(obj)`. */
  del(target: EditTarget | null): SelectionChange {
    return this.clipboard.del(target);
  }

  /** C++ `clear` → `ObjectStore::clearWithUndoManager`: every object of the page, one undo step. */
  clear(): SelectionChange {
    const doc = this.ctx.doc;
    const objs: LekhObject[] = [...doc.activePage().objectStore.objects];
    if (objs.length > 0) this.ctx.tx.run(new DeleteObjectAction(this.ctx.env, doc, objs));
    return null;
  }

  /** C++ `undo`: the selection is cleared first. */
  undo(): SelectionChange {
    this.ctx.undo.undo();
    return null;
  }

  /** C++ `redo`. */
  redo(): SelectionChange {
    this.ctx.undo.redo();
    return null;
  }
}
