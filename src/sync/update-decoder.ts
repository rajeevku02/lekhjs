// Frame → `UpdateAction` by `updates.type` (port of C++ `UpdateHandler::getAction` and the
// `get*Action` builders, `L/update/UpdateHandler.cpp:39-480`; spec 02 `UpdateDecoder`).
//
// `null` means "handled, nothing to do", exactly where C++ returned `nullptr`: an unknown type, a
// `load` with more than one change or whose key is not `doc` or whose value is not an object, a
// `changeattr` with a key shorter than six segments or not under `pages.*.objects.*`, a
// `changescaling` without a scaling key. The session still takes the frame's version for these,
// as C++ did. A `load` with no change at all (B3, C++ dereferenced `begin()` of an empty map)
// is rejected instead.
//
// The format stamp `doc.info.version` is removed before decoding (spec 04 §9.4: a TS receiver
// accepts it in any update type and applies the rest), so it never trips the six-segment rule.
import { isJsonObject, type JsonObject, type JsonValue } from '../template';
import { consts, updatetypes } from './consts';
import type { FrameUpdate } from './frame';
import { splitKey } from './paths';
import {
  AddDelObjectsUpdateAction,
  ArrowUpdateAction,
  AttrChangeUpdateAction,
  BackgroundChangeUpdateAction,
  ConnectionChangeUpdateAction,
  ConnectionTextsUpdateAction,
  DocReloadUpdateAction,
  GridChangeUpdateAction,
  PageAddDeleteAction,
  PageAttrChangeAction,
  RejectedUpdateAction,
  ScalingChangeUpdateAction,
  StyleChangeUpdateAction,
  TemplateParamUpdateAction,
  type AttrUpdate,
  type UpdateAction,
} from './update-actions';

type Changes = readonly (readonly [string, JsonValue])[];

/** C++ `isObjAdd`: `doc.pages.<p>.objects.<o>` with an object value. */
function isObjAdd(keys: readonly string[], v: JsonValue): v is JsonObject {
  return keys.length === 5 && keys[1] === consts.pages && keys[3] === consts.objects && isJsonObject(v);
}

function isTemplateAdd(keys: readonly string[], v: JsonValue): v is JsonObject {
  return keys.length === 3 && keys[1] === consts.templates && isJsonObject(v);
}

function isHelpAdd(keys: readonly string[], v: JsonValue): v is JsonObject {
  return keys.length === 3 && keys[1] === consts.help && isJsonObject(v);
}

/** C++ `isObjDelete`: the same path with a `null` (`JsonNode::NONE`) value. */
function isObjDelete(keys: readonly string[], v: JsonValue): boolean {
  return keys.length === 5 && keys[1] === consts.pages && keys[3] === consts.objects && v === null;
}

/** C++ `isDelAll`: `doc.pages.<p>.objects` set to `{}`. */
function isDelAll(keys: readonly string[], v: JsonValue): boolean {
  return (
    keys.length === 4 &&
    keys[1] === consts.pages &&
    keys[3] === consts.objects &&
    isJsonObject(v) &&
    Object.keys(v).length === 0
  );
}

/** C++ `JsonNode::longVal()` of a number (0 for anything else), truncated. */
function longVal(v: JsonValue): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
}

/** C++ `JsonNode::stringVal()` (empty for a non-string). */
function stringVal(v: JsonValue): string {
  return typeof v === 'string' ? v : '';
}

function addObjects(changes: Changes): AddDelObjectsUpdateAction {
  const act = new AddDelObjectsUpdateAction();
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (isObjAdd(keys, v)) {
      act.page = keys[2] as string;
      act.objects.push([keys[4] as string, v]);
    } else if (isTemplateAdd(keys, v)) {
      act.templates.push(v);
    } else if (isHelpAdd(keys, v)) {
      act.help.push(v);
    }
  }
  return act;
}

function delObjects(changes: Changes): AddDelObjectsUpdateAction {
  const act = new AddDelObjectsUpdateAction();
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (isObjDelete(keys, v)) {
      act.page = keys[2] as string;
      act.toBeDeleted.add(keys[4] as string);
    } else if (isDelAll(keys, v)) {
      act.page = keys[2] as string;
      act.delAll = true;
    }
  }
  return act;
}

function convertObjects(changes: Changes): AddDelObjectsUpdateAction {
  const act = new AddDelObjectsUpdateAction();
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (isObjAdd(keys, v)) {
      act.page = keys[2] as string;
      act.objects.push([keys[4] as string, v]);
    } else if (isObjDelete(keys, v)) {
      act.page = keys[2] as string;
      act.toBeDeleted.add(keys[4] as string);
    } else if (isDelAll(keys, v)) {
      act.page = keys[2] as string;
      act.delAll = true;
    }
  }
  return act;
}

function attrChange(changes: Changes): AttrChangeUpdateAction | null {
  const act = new AttrChangeUpdateAction();
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (keys.length < 6) return null;
    if (keys[1] !== consts.pages || keys[3] !== consts.objects) return null;
    const pageId = keys[2] as string;
    const objectId = keys[4] as string;
    let up: AttrUpdate | undefined = act.updates.find((u) => u.objectId === objectId && u.pageId === pageId);
    if (up === undefined) {
      up = { pageId, objectId, params: [], shapeTemplate: null, order: null };
      act.updates.push(up);
    }
    if (keys[5] === consts.params && keys.length === 7) {
      const name = keys[6] as string;
      const i = up.params.findIndex(([k]) => k === name);
      if (i >= 0) up.params[i] = [name, v];
      else up.params.push([name, v]);
    } else if (keys[5] === consts.stemplate && keys.length === 6) {
      up.shapeTemplate = v;
    } else if (keys[5] === consts.order && keys.length === 6) {
      up.order = v;
    }
  }
  // C++ kept `params` in a std::map: applied in name order.
  for (const u of act.updates) u.params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return act;
}

function arrowChange(changes: Changes): ArrowUpdateAction {
  const act = new ArrowUpdateAction();
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (keys.length === 7 && keys[1] === consts.pages && keys[3] === consts.objects && keys[5] === consts.arrows) {
      if (keys[6] === consts.start) {
        act.applyStart = true;
        act.start = v;
      }
      if (keys[6] === consts.end) {
        act.applyEnd = true;
        act.end = v;
      }
      act.pageId = keys[2] as string;
      act.objId = keys[4] as string;
    }
  }
  return act;
}

function templateParams(changes: Changes): TemplateParamUpdateAction {
  const act = new TemplateParamUpdateAction();
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (
      keys.length === 7 &&
      keys[1] === consts.pages &&
      keys[3] === consts.objects &&
      keys[5] === consts.stemplate &&
      keys[6] === consts.params
    ) {
      act.pageId = keys[2] as string;
      act.objId = keys[4] as string;
      act.params = v;
    }
  }
  return act;
}

function gridChange(changes: Changes): GridChangeUpdateAction {
  const act = new GridChangeUpdateAction();
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (keys.length === 4 && keys[1] === consts.attributes && keys[2] === consts.grid && keys[3] === consts.present) {
      act.val = v;
    }
  }
  return act;
}

function scalingChange(changes: Changes): ScalingChangeUpdateAction | null {
  let act: ScalingChangeUpdateAction | null = null;
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (keys.length === 3 && keys[1] === consts.attributes && keys[2] === consts.scaling) {
      act ??= new ScalingChangeUpdateAction();
      act.val = v;
    }
  }
  return act;
}

function connectionChange(changes: Changes): ConnectionChangeUpdateAction {
  const act = new ConnectionChangeUpdateAction();
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (keys.length !== 6 || keys[1] !== consts.pages || keys[3] !== consts.objects) continue;
    if (keys[5] === consts.params) {
      act.params = v;
    } else if (keys[5] === consts.ctype) {
      act.ctype = v;
    } else {
      continue;
    }
    act.pageId = keys[2] as string;
    act.objId = keys[4] as string;
  }
  return act;
}

function connectionTexts(changes: Changes): ConnectionTextsUpdateAction {
  const act = new ConnectionTextsUpdateAction();
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (keys.length === 6 && keys[1] === consts.pages && keys[3] === consts.objects && keys[5] === consts.texts) {
      act.val = v;
      act.pageId = keys[2] as string;
      act.objId = keys[4] as string;
    }
  }
  return act;
}

function backgroundChange(changes: Changes): BackgroundChangeUpdateAction {
  const act = new BackgroundChangeUpdateAction();
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (keys.length === 4 && keys[1] === consts.pages && keys[3] === consts.background) {
      act.val = v;
      act.pageId = keys[2] as string;
    }
  }
  return act;
}

function styleChange(changes: Changes): StyleChangeUpdateAction {
  const act = new StyleChangeUpdateAction();
  const put = (objId: string, pageId: string, attr: string, v: JsonValue) => {
    let os = act.styles.get(objId);
    if (os === undefined) {
      os = { pageId, style: [] };
      act.styles.set(objId, os);
    }
    os.pageId = pageId;
    const i = os.style.findIndex(([k]) => k === attr);
    if (i >= 0) os.style[i] = [attr, v];
    else os.style.push([attr, v]);
  };
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (
      keys.length === 8 &&
      keys[1] === consts.pages &&
      keys[3] === consts.objects &&
      keys[5] === consts.stemplate &&
      keys[6] === consts.style
    ) {
      put(keys[4] as string, keys[2] as string, keys[7] as string, v);
    } else if (
      keys.length === 7 &&
      keys[1] === consts.pages &&
      keys[3] === consts.objects &&
      keys[5] === consts.style
    ) {
      put(keys[4] as string, keys[2] as string, keys[6] as string, v);
    }
  }
  return act;
}

function pageAddDelete(changes: Changes): PageAddDeleteAction {
  const act = new PageAddDeleteAction();
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (keys.length === 3 && keys[1] === consts.pages) {
      if (v === null) act.deleted.add(keys[2] as string);
      else if (isJsonObject(v)) act.added.push([keys[2] as string, v]);
    }
  }
  return act;
}

function pageAttrChange(changes: Changes): PageAttrChangeAction {
  const act = new PageAttrChangeAction();
  for (const [key, v] of changes) {
    const keys = splitKey(key);
    if (keys.length !== 4) continue;
    const id = keys[2] as string;
    switch (keys[3]) {
      case consts.order:
        act.orders.push([id, longVal(v)]);
        break;
      case consts.name:
        act.names.push([id, stringVal(v)]);
        break;
      case consts.size:
        act.sizes.push([id, v]);
        break;
      case consts.canvasname:
        act.canvasNames.push([id, stringVal(v)]);
        break;
      case consts.canvassizetype:
        act.canvasSizeTypes.push([id, stringVal(v)]);
        break;
      case consts.margin:
        act.margins.push([id, v]);
        break;
    }
  }
  return act;
}

export const UpdateDecoder = Object.freeze({
  /** C++ `UpdateHandler::getAction`. `changes` must not hold the format stamp key. */
  decode(update: FrameUpdate, changes: Changes = update.changes): UpdateAction | null {
    switch (update.type) {
      case updatetypes.load: {
        if (changes.length === 0) return new RejectedUpdateAction('load_without_changes');
        if (changes.length > 1) return null;
        const [key, v] = changes[0] as readonly [string, JsonValue];
        const comps = splitKey(key);
        if (comps.length !== 1 || comps[0] !== consts.doc) return null;
        if (!isJsonObject(v)) return null;
        return new DocReloadUpdateAction(v);
      }
      case updatetypes.addObjects:
        return addObjects(changes);
      case updatetypes.delObjects:
      case updatetypes.delAllObjects:
        return delObjects(changes);
      case updatetypes.changeAttr:
        return attrChange(changes);
      case updatetypes.changeArrow:
        return arrowChange(changes);
      case updatetypes.changeTemplateParams:
        return templateParams(changes);
      case updatetypes.changeGrid:
        return gridChange(changes);
      case updatetypes.changeScaling:
        return scalingChange(changes);
      case updatetypes.changeConnectionParams:
        return connectionChange(changes);
      case updatetypes.changeConnectionTexts:
        return connectionTexts(changes);
      case updatetypes.changeBackground:
        return backgroundChange(changes);
      case updatetypes.changeStyle:
        return styleChange(changes);
      case updatetypes.convertObjects:
        return convertObjects(changes);
      case updatetypes.addPages:
      case updatetypes.delPages:
        return pageAddDelete(changes);
      case updatetypes.changePageAttr:
        return pageAttrChange(changes);
      default:
        return null;
    }
  },
});
