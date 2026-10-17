// Cloning object sets for duplicate, paste and library inserts (ports of C++
// `ObjectStore::cloneObjects`, `GroupObject::cloneWithConnections` / `performClone`
// (`L/object/GroupObject.cpp:266-302`) and `MultiObjects::addToCanvas`
// (`L/object/MultiObjects.cpp:14-49`); spec 01 C8/C9: the model stays data, commands live here).
import { Point, Rect } from '../geometry';
import {
  ConnectionObject,
  GroupObject,
  TemplatedObject,
  stampNewContentFont,
  type LekhObject,
  type MultiObjects,
  type ObjectStore,
} from '../model';
import type { EditorContext } from './editor-context';
import { AddObjectAction } from './object-actions';

export interface CloneResult {
  readonly clones: LekhObject[];
  /** Each cloned original (group members included) → its clone. */
  readonly mapping: Map<LekhObject, LekhObject>;
}

/**
 * C++ `ObjectStore::cloneObjects`: shapes and groups first (groups cloned with their members
 * mapped), then the connectors whose two ends were cloned, between the clones. `storeSize` is the
 * page's top-level object count (a group clone's member indices count down from it, as C++ read
 * it from the active store).
 */
export function cloneObjects(objs: readonly LekhObject[], copyOrder: boolean, storeSize = 0): CloneResult {
  const connections: ConnectionObject[] = [];
  const mapping = new Map<LekhObject, LekhObject>();
  const clones: LekhObject[] = [];
  for (const o of objs) {
    if (o instanceof ConnectionObject) {
      connections.push(o);
      continue;
    }
    let clone: LekhObject | null;
    if (o instanceof GroupObject) {
      const members = new Map<LekhObject, LekhObject>();
      clone = o.cloneMapped(members, storeSize);
      for (const [k, v] of members) mapping.set(k, v);
    } else {
      clone = o.clone();
    }
    if (clone === null) continue;
    if (copyOrder) clone.order = o.order;
    clones.push(clone);
    mapping.set(o, clone);
  }
  for (const c of connections) {
    const first = c.first === null ? undefined : mapping.get(c.first);
    const second = c.second === null ? undefined : mapping.get(c.second);
    if (first === undefined || second === undefined) continue;
    const copy = c.getCopy(first, second);
    if (copyOrder) copy.order = c.order;
    clones.push(copy);
  }
  return { clones, mapping };
}

/**
 * C++ `GroupObject::cloneWithConnections`: the group cloned, plus a copy of every connector of the
 * page whose two ends are members of the group. Returns the connectors first, then the group.
 */
export function cloneWithConnections(
  group: GroupObject,
  store: ObjectStore,
): { group: GroupObject; objects: LekhObject[] } {
  const objSet = new Map<LekhObject, LekhObject>();
  const go = group.cloneMapped(objSet, store.size);
  const objects: LekhObject[] = [];
  for (const o of store.objects) {
    if (!(o instanceof ConnectionObject) || o.first === null || o.second === null) continue;
    const first = objSet.get(o.first);
    const second = objSet.get(o.second);
    if (first !== undefined && second !== undefined) objects.push(o.getCopy(first, second));
  }
  objects.push(go);
  return { group: go, objects };
}

/**
 * C++ `GroupObject::performClone`: the clone and its connectors are added (one undo step), then
 * the group clone is moved by `cloneDisplacement`. As C++, the move comes after the `addobjects`
 * update, so peers receive the clone at the original's position.
 */
export function performGroupClone(ctx: EditorContext, group: GroupObject): GroupObject {
  const doc = ctx.doc;
  const { group: go, objects } = cloneWithConnections(group, doc.activePage().objectStore);
  ctx.tx.run(new AddObjectAction(ctx.env, doc, objects));
  const d = ctx.config.cloneDisplacement;
  go.startModification();
  go.translate(d, d);
  return go;
}

/**
 * C++ `MultiObjects::addToCanvas(cx, cy)`: a clipboard or library payload cloned onto the active
 * page centred at (cx, cy), as one undo step. Returns the added objects (the caller selects them).
 */
export function addMultiToCanvas(ctx: EditorContext, multi: MultiObjects, cx: number, cy: number): LekhObject[] {
  const doc = ctx.doc;
  const infos = multi.objects();
  const { clones, mapping } = cloneObjects(
    infos.map((i) => i.object),
    false,
    doc.activePage().objectStore.size,
  );
  for (const info of infos) {
    const t = mapping.get(info.object);
    if (t instanceof TemplatedObject) {
      const r = t.ds.rect();
      t.setRect(Rect.fromCenter(new Point(cx + info.dx, cy + info.dy), r.width, r.height));
    }
  }
  // A library insert is new content (spec 06 §9): the clones get the bundled default font.
  stampNewContentFont(clones);
  ctx.tx.run(new AddObjectAction(ctx.env, doc, clones));
  return clones;
}
