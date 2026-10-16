// The attribute, page and document operations of the delta compiler (C++ `SemanticDelta.cpp`
// lines 4938-7777 minus what ops-nodes.ts takes: set_text, set_title, set_shape,
// set_template_params, set_style and its helpers, set_arrow, set_edge_route, set_edge_texts, the
// page operations and their helpers, set_grid, set_scaling). Conventions: compilation-base.ts.
import { Point, Rect } from '../../geometry';
import { parseStyle, serializeStyle, serializeTemplateParams } from '../../io';
import {
  AutoType,
  BackgroundType,
  CanvasSizeType,
  ConnectionObject,
  ConnectionType,
  GroupObject,
  Page,
  PageSize,
  TemplatedObject,
  sideOfAngle,
  type LekhObject,
  type Params,
} from '../../model';
import { Length, PaintType, Style, TextDecoration, Unit } from '../../style';
import { ParamEditorType, textSideFromName, textSideName, TextSide, type ShapeTemplate } from '../../template';
import { consts } from '../../sync';
import {
  CAP_STYLES,
  FIXED_CANVAS_NEEDS_SIZE,
  FONT_STYLES,
  FONT_WEIGHTS,
  JOIN_STYLES,
  KEY,
  PATH_SHAPE_ID,
  TEXT_ALIGN_HORIZONTALS,
  TEXT_ALIGN_VERTICALS,
  TEXT_DECORATIONS,
  autoTypeFromName,
  autoTypeMessage,
  autoTypeName,
  canvasTypeFromName,
  canvasTypeMessage,
  edgeTypeFromName,
  edgeTypeMessage,
  edgeTypeName,
  enumValue,
  hexToColor,
  inertStyleReason,
  isLineAutoType,
  isTextStyleKey,
  isUBend,
  marginToStored,
  noSizeMessage,
  semanticStyleKey,
  storedStyleKey,
  styleKeyMessage,
  textStyleKeyList,
  unitFromName,
  unitMessage,
  type EnumTable,
} from '../format';
import { isJsonObject, jsonEqual, sortedKeys, type JsonObject, type JsonOut, type JsonValue } from '../json';
import { PageSizeArgs, byteOrder, structuredJson, type Working } from './compilation-base';
import {
  ARROWHEAD_IS,
  CANVAS_NAME_IS_STRING,
  FrameKind,
  INVALID_OPERATION,
  K_CANVAS_NAME,
  K_CANVAS_TYPE,
  K_INDEX,
  K_PAGE,
  K_PARAMS,
  K_PRESENT,
  K_REMOVE,
  K_SCALE,
  K_TO_INDEX,
  LoopSides,
  MARGIN_NEEDS,
  MARGIN_REMOVE_ALONE,
  MARGIN_REMOVE_VALUE,
  OBJECT_NOT_FOUND,
  OP,
  PAGE_NOT_FOUND,
  REACH_MESSAGE,
  RESIZE_NEEDS,
  STORED,
  UNIT_NEEDS_BOTH,
  UNKNOWN_STENCIL,
  arrowheadMessage,
  arrowheadRefusal,
  bodySlots,
  declaresImageSlot,
  defaultCanvasName,
  drawsArrowheads,
  endSteps,
  existsNode,
  hasLabel,
  inertStyleMessage,
  labelMemberMessage,
  labelPosition,
  latentEdgeKey,
  loopSidesOnTwoNodesMessage,
  numberOf,
  numberWord,
  positionOf,
  readLoopSides,
  setEndSteps,
  settledCopy,
  slotClearedTextKeys,
  spelledOf,
  storeJson,
  styleTargetFor,
  titleSideMessage,
  titleSlotOf,
  unknownLabelMember,
  whatItIs,
} from './helpers';
import { NodeOps } from './ops-nodes';

/** Own member of a JSON object, or undefined (C++ `getMember` → nullptr). */
function mem(node: JsonValue | undefined, name: string): JsonValue | undefined {
  return isJsonObject(node) && Object.prototype.hasOwnProperty.call(node, name) ? node[name] : undefined;
}

/** A node this compilation built (a deep copy it owns), viewed as writable. */
function writable(node: JsonObject): JsonOut {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- JsonObject is readonly; the node is a copy this compilation owns
  return node as JsonOut;
}

/** A mutable deep copy of an object node. */
function cloneObj(node: JsonValue | undefined): JsonOut {
  return isJsonObject(node) ? (structuredJson(node) as JsonOut) : {};
}

/** C++ `getField(name, int*)`: an integral number, or null. */
function intField(node: JsonValue | undefined, name: string): number | null {
  const v = mem(node, name);
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

/** C++ `getField(name, string*)`. */
function strField(node: JsonValue | undefined, name: string): string | null {
  const v = mem(node, name);
  return typeof v === 'string' ? v : null;
}

/**
 * Whether a text slot's stored `style` lets the master clear `storedKey`: its `nonoverridables`
 * names the attribute in camel case, compared without case.
 */
function slotKeyOverridable(slotStyle: JsonObject, storedKey: string): boolean {
  const names = slotStyle['nonoverridables'];
  if (!Array.isArray(names)) return true;
  const want = storedKey.toLowerCase();
  for (const name of names as readonly JsonValue[]) {
    if (typeof name !== 'string') continue;
    if (name.length === storedKey.length && name.toLowerCase() === want) return false;
  }
  return true;
}

/** Path lookup in a serialized node: `a.b.3.c` (array segments are indices). */
function memberAt(root: JsonValue | undefined, path: string): JsonValue | undefined {
  let at: JsonValue | undefined = root;
  for (const segment of path.split('.')) {
    if (at === undefined || at === null) return undefined;
    if (Array.isArray(at)) {
      const list = at as readonly JsonValue[];
      const index = parseInt(segment, 10) || 0;
      at = index < list.length ? list[index] : undefined;
    } else if (isJsonObject(at)) {
      at = mem(at, segment);
    } else {
      return undefined;
    }
  }
  return at;
}

const NAMED_ENUMS: readonly (readonly [string, EnumTable])[] = Object.freeze([
  ['join_style', JOIN_STYLES],
  ['cap_style', CAP_STYLES],
  ['text_align_horizontal', TEXT_ALIGN_HORIZONTALS],
  ['text_align_vertical', TEXT_ALIGN_VERTICALS],
  ['font_weight', FONT_WEIGHTS],
  ['font_style', FONT_STYLES],
] as const);

export abstract class EditOps extends NodeOps {
  /** A probe object running `stl` at the working geometry (C++ `new TemplatedObject(stl, rect, angle, false)`). */
  private probeOf(stl: ShapeTemplate, w: Working, id: string): TemplatedObject {
    return new TemplatedObject(
      this.codec.env.objects,
      stl,
      Rect.fromCenter(new Point(w.cx, w.cy), w.width, w.height),
      w.angle,
      null,
      id,
    );
  }

  // ---------------------------------------------------------------- set_text

  doSetText(opNode: JsonObject, at: number): boolean {
    const id = this.resolveId(opNode, at, true);
    if (id === null) return false;
    const tobj = this.existingTemplated(id, at, OP.setText);
    if (tobj === null) return false;

    const text = strField(opNode, KEY.text);
    if (text === null) return this.failAt(INVALID_OPERATION, 'set_text needs `text`', at);

    // The template is the working one; the condition is the slot's text as read.
    const w = this.workingFor(id, tobj);
    const stl = this.currentTemplate(w, tobj) as ShapeTemplate;
    const tnode = cloneObj(w.tnode);
    const stored = tobj.shapeTemplate();
    const asRead = w.installed === null && stored !== null ? this.codec.templates.serialize(stored) : null;
    const storedMember = (path: string): JsonValue | undefined =>
      asRead === null ? undefined : memberAt(asRead, path);

    if (stl.interpretText()) {
      const index = numberOf(mem(opNode, K_INDEX));
      if (index !== null && Math.trunc(index) !== 0) {
        return this.failAt(
          INVALID_OPERATION,
          "this shape's generator parses its text, so it has exactly one slot: use index 0 or no index",
          at,
        );
      }
      if (mem(opNode, KEY.row) !== undefined || mem(opNode, KEY.col) !== undefined) {
        return this.failAt(
          INVALID_OPERATION,
          "this shape's generator does not address text by cell: use index 0 or no index",
          at,
        );
      }
      const genNode = mem(tnode, STORED.generator);
      if (genNode === undefined || genNode === null || !isJsonObject(genNode)) {
        return this.failAt(INVALID_OPERATION, "this shape's generator carries no text to change", at);
      }
      const conditionPath = `${this.objPath(id)}.${consts.stemplate}.${STORED.generator}.${STORED.text}`;
      if (asRead !== null && storedMember(STORED.generator) !== undefined) {
        const currentText = storedMember(`${STORED.generator}.${STORED.text}`);
        this.condition(FrameKind.ChangeAttr, conditionPath, typeof currentText === 'string' ? currentText : '');
      }
      writable(genNode)[STORED.text] = text;
    } else {
      const texts = mem(tnode, consts.texts);
      if (!Array.isArray(texts) || texts.length === 0) {
        return this.failAt(
          INVALID_OPERATION,
          'this shape has no text slot to address; if it is a generated shape, ask stencil_get what its inputs are',
          at,
        );
      }
      const list = texts as JsonValue[];
      const body = bodySlots(list);
      const slotCount = body.length;

      let slot = -1;
      const row = numberOf(mem(opNode, KEY.row));
      const col = numberOf(mem(opNode, KEY.col));
      const index = numberOf(mem(opNode, K_INDEX));
      if (row !== null || col !== null) {
        if (index !== null) return this.failAt(INVALID_OPERATION, 'set_text takes one of `index` or `row`/`col`', at);
        if (row === null || col === null) {
          return this.failAt(INVALID_OPERATION, 'a cell address needs both `row` and `col`', at);
        }
        for (let i = 0; i < slotCount; i++) {
          const entry = list[body[i] as number];
          if (entry === undefined || entry === null) continue;
          const r = intField(entry, STORED.row);
          const c = intField(entry, STORED.col);
          if (r !== null && c !== null && r === Math.trunc(row) && c === Math.trunc(col)) {
            slot = i;
            break;
          }
        }
        if (slot < 0) {
          return this.failAt(
            INVALID_OPERATION,
            `no cell at row ${String(Math.trunc(row))}, col ${String(Math.trunc(col))} on this shape; it has ${String(slotCount)} text slot(s)`,
            at,
          );
        }
      } else if (index !== null) {
        slot = Math.trunc(index);
      } else {
        slot = 0;
      }

      if (slot < 0 || slot >= slotCount) {
        const titled = titleSlotOf(list) >= 0;
        return this.failAt(
          INVALID_OPERATION,
          `text index ${String(slot)} is out of range: this shape has ${String(slotCount)} text slot(s)` +
            (titled ? '; its title is not one, change it with set_title' : ''),
          at,
        );
      }

      const storedSlot = body[slot] as number;
      const entry = list[storedSlot];
      const slotPath = `${consts.texts}.${String(storedSlot)}`;
      if (asRead !== null && storedMember(slotPath) !== undefined) {
        const currentText = storedMember(`${slotPath}.${STORED.text}`);
        this.condition(
          FrameKind.ChangeAttr,
          `${this.objPath(id)}.${consts.stemplate}.${slotPath}.${STORED.text}`,
          typeof currentText === 'string' ? currentText : '',
        );
      }
      if (isJsonObject(entry)) writable(entry)[STORED.text] = text;
    }

    this.emitTemplateAndProbe(id, w, tnode);
    return true;
  }

  // ---------------------------------------------------------------- set_title

  doSetTitle(opNode: JsonObject, at: number): boolean {
    const id = this.resolveId(opNode, at, true);
    if (id === null) return false;
    const named = spelledOf(opNode);
    const obj = this.existing(id, at, OP.setTitle);
    if (obj === null) return this.failAt(OBJECT_NOT_FOUND, `no object "${id}" on page ${this.pageId}`, at);
    if (
      obj instanceof ConnectionObject ||
      obj instanceof GroupObject ||
      !(obj instanceof TemplatedObject) ||
      obj.shapeTemplate() === null
    ) {
      return this.failAt(
        INVALID_OPERATION,
        `set_title: node ${named} is ${whatItIs(obj)}; only a shape whose stencil declares a title has one`,
        at,
      );
    }
    const tobj = obj;

    const w = this.workingFor(id, tobj);
    const stl = this.currentTemplate(w, tobj) as ShapeTemplate;
    const slot = w.tnode !== null ? titleSlotOf(mem(w.tnode, consts.texts)) : -1;
    if (slot < 0) {
      return this.failAt(
        INVALID_OPERATION,
        `set_title: node ${named} (${stl.id()}) has no title; its stencil declares none`,
        at,
      );
    }

    const text = mem(opNode, KEY.text);
    const side = mem(opNode, KEY.side);
    const style = mem(opNode, KEY.style);
    if (text === undefined && side === undefined && style === undefined) {
      return this.failAt(INVALID_OPERATION, 'set_title needs text, side, style, or a combination', at);
    }
    if (text !== undefined && typeof text !== 'string') {
      return this.failAt(INVALID_OPERATION, 'set_title.text is a string', at);
    }
    let newSide: TextSide = TextSide.None;
    if (side !== undefined) {
      if (typeof side === 'string') newSide = textSideFromName(side);
      if (newSide === TextSide.None) return this.failAt(INVALID_OPERATION, titleSideMessage('set_title'), at);
    }

    const tnode = cloneObj(w.tnode);
    const entry = (tnode[consts.texts] as JsonOut[])[slot] as JsonOut;
    const currentPins = mem(entry, consts.style);
    const pins: JsonOut = isJsonObject(currentPins) ? cloneObj(currentPins) : {};
    const patched: string[] = [];
    if (style !== undefined && !this.patchTitleStyle(style, pins, 'set_title', at, patched)) return false;

    // The conditions, at the values AS READ.
    const storedTemplate = tobj.shapeTemplate();
    const asRead =
      w.installed === null && storedTemplate !== null ? this.codec.templates.serialize(storedTemplate) : null;
    const readTexts = asRead !== null ? mem(asRead, consts.texts) : undefined;
    const readSlot = titleSlotOf(readTexts);
    if (readSlot >= 0) {
      const readEntry = (readTexts as readonly JsonValue[])[readSlot];
      const entryPath = `${this.objPath(id)}.${consts.stemplate}.${consts.texts}.${String(readSlot)}.`;
      if (text !== undefined) {
        this.condition(FrameKind.ChangeAttr, entryPath + STORED.text, strField(readEntry, STORED.text) ?? '');
      }
      if (side !== undefined) {
        this.condition(FrameKind.ChangeAttr, entryPath + STORED.external, strField(readEntry, STORED.external) ?? '');
      }
      const readPins = mem(readEntry, consts.style);
      for (const storedKey of patched) {
        const was = isJsonObject(readPins) ? mem(readPins, storedKey) : undefined;
        this.condition(
          FrameKind.ChangeAttr,
          `${entryPath}${consts.style}.${storedKey}`,
          was !== undefined ? structuredJson(was) : existsNode(false),
        );
      }
    }

    if (typeof text === 'string') entry[STORED.text] = text;
    if (side !== undefined) entry[STORED.external] = textSideName(newSide);
    if (style !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- C++ removeField(consts::style)
      if (Object.keys(pins).length === 0) delete entry[consts.style];
      else entry[consts.style] = pins;
    }

    this.emitTemplateAndProbe(id, w, tnode);
    return true;
  }

  patchTitleStyle(patch: JsonValue, pins: JsonOut, prefix: string, at: number, changed: string[]): boolean {
    if (!isJsonObject(patch)) {
      return this.failAt(
        INVALID_OPERATION,
        `${prefix}.style is an object of text style attributes, like { "font_size": 12 }; null removes a pin`,
        at,
      );
    }
    if (Object.keys(patch).length === 0) {
      return this.failAt(INVALID_OPERATION, `${prefix}.style needs at least one of ${textStyleKeyList()}`, at);
    }
    for (const k of sortedKeys(patch)) {
      const storedKey = storedStyleKey(k);
      if (storedKey === null) {
        return this.failAt(
          INVALID_OPERATION,
          `${prefix}.style.${k} is not a style attribute; a title takes ${textStyleKeyList()}`,
          at,
        );
      }
      if (!isTextStyleKey(storedKey)) {
        return this.failAt(
          INVALID_OPERATION,
          `${prefix}.style.${k} is not a text style key; restyle the node with set_style`,
          at,
        );
      }
      changed.push(storedKey);
      const v = patch[k];
      if (v === undefined || v === null) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- C++ removeField
        delete pins[storedKey];
        continue;
      }
      const value = this.storedStyleNode(k, v, mem(pins, storedKey), at, prefix + '.');
      if (value === undefined) return false;
      pins[storedKey] = value;
    }
    return true;
  }

  emitTemplateAndProbe(id: string, w: Working, tnode: JsonOut): void {
    this.change(FrameKind.ChangeAttr, `${this.objPath(id)}.${consts.stemplate}`, structuredJson(tnode));
    // The geometry the patched template produces (a text is a generator input): parsed back and
    // run at the working geometry, as the receiver will.
    const regenerated = this.codec.templates.parse(tnode);
    if (regenerated !== null) {
      regenerated.load();
      const probe = this.probeOf(regenerated, w, id);
      const base = `${this.objPath(id)}.${consts.params}.`;
      this.change(FrameKind.ChangeAttr, base + consts.cx, probe.ds.cx());
      this.change(FrameKind.ChangeAttr, base + consts.cy, probe.ds.cy());
      this.change(FrameKind.ChangeAttr, base + consts.width, probe.ds.width());
      this.change(FrameKind.ChangeAttr, base + consts.height, probe.ds.height());
      this.change(FrameKind.ChangeAttr, base + consts.angle, probe.ds.angle());
      NodeOps.setWorkingGeometry(w, probe.ds);
    }
    w.tnode = tnode;
  }

  // ---------------------------------------------------------------- set_shape

  doSetShape(opNode: JsonObject, at: number): boolean {
    const id = this.resolveId(opNode, at, true);
    if (id === null) return false;
    const tobj = this.existingTemplated(id, at, OP.setShape);
    if (tobj === null) return false;

    const shapeId = strField(opNode, KEY.shape) ?? '';
    if (shapeId === '') return this.failAt(INVALID_OPERATION, 'set_shape needs a `shape` template id', at);
    if (shapeId === PATH_SHAPE_ID) {
      return this.failAt(
        INVALID_OPERATION,
        'set_shape cannot produce a lekh.semantic.path — there is no drawing to give it; delete the node and add_node a path',
        at,
      );
    }
    const resolved = this.resolveTemplate(shapeId);
    if (resolved === null) {
      return this.failAt(
        UNKNOWN_STENCIL,
        `no stencil "${shapeId}": search for it with stencil_search rather than guessing an id`,
        at,
      );
    }
    const stl = resolved.stl;
    // A node cannot be turned into an image: set_shape carries no image reference.
    if (declaresImageSlot(stl)) {
      return this.failAt(
        INVALID_OPERATION,
        'set_shape cannot turn a node into an image: it carries no image reference, so the shape would draw as an empty box. Place an image with board_add_image',
        at,
      );
    }
    stl.load();

    const w = this.workingFor(id, tobj);
    const probe = this.probeOf(stl, w, id);

    const tnode = cloneObj(this.codec.templates.serialize(probe.shapeTemplate() as ShapeTemplate));
    const oldNode = cloneObj(w.tnode);

    // The style deviations are the working style's.
    const oldStyle = w.style !== null ? serializeStyle(w.style) : {};
    if (Object.keys(oldStyle).length > 0) {
      let newStyle = mem(tnode, consts.style);
      if (!isJsonObject(newStyle)) {
        newStyle = {};
        tnode[consts.style] = newStyle;
      }
      for (const k of sortedKeys(oldStyle)) {
        const v = oldStyle[k];
        if (semanticStyleKey(k) === null || v === undefined) continue;
        writable(newStyle)[k] = structuredJson(v);
      }
    }

    const oldTexts: string[] = [];
    const oldInterprets = (this.currentTemplate(w, tobj) as ShapeTemplate).interpretText();
    if (oldInterprets) {
      const genNode = mem(oldNode, STORED.generator);
      const t = strField(genNode, STORED.text);
      if (isJsonObject(genNode) && t !== null) oldTexts.push(t);
    }
    let oldTitle: JsonOut | null = null;
    if (!oldInterprets) {
      const texts = mem(oldNode, consts.texts);
      if (Array.isArray(texts)) {
        const list = texts as readonly JsonValue[];
        for (const i of bodySlots(list)) {
          const entry = list[i];
          oldTexts.push(entry !== undefined && entry !== null ? (strField(entry, STORED.text) ?? '') : '');
        }
        const title = titleSlotOf(list);
        if (title >= 0) oldTitle = cloneObj(list[title]);
      }
    }

    const newTemplate = probe.shapeTemplate() as ShapeTemplate;
    if (newTemplate.interpretText()) {
      const genNode = mem(tnode, STORED.generator);
      if (oldTexts.length > 0 && oldTexts[0] !== '' && isJsonObject(genNode)) {
        writable(genNode)[STORED.text] = oldTexts[0] as string;
      }
    } else {
      const texts = mem(tnode, consts.texts);
      if (Array.isArray(texts)) {
        const list = texts as JsonValue[];
        const body = bodySlots(list);
        const slots = Math.min(body.length, oldTexts.length);
        for (let i = 0; i < slots; i++) {
          const entry = list[body[i] as number];
          if (isJsonObject(entry) && oldTexts[i] !== '') writable(entry)[STORED.text] = oldTexts[i] as string;
        }
        const title = titleSlotOf(list);
        const entry = title >= 0 ? list[title] : undefined;
        if (isJsonObject(entry) && oldTitle !== null) {
          const e = writable(entry);
          e[STORED.text] = strField(oldTitle, STORED.text) ?? '';
          e[STORED.external] = strField(oldTitle, STORED.external) ?? '';
          const pins = mem(oldTitle, consts.style);
          if (pins !== undefined) e[consts.style] = structuredJson(pins);
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- C++ removeField
          else delete e[consts.style];
        }
      }
    }

    this.change(FrameKind.ChangeAttr, `${this.objPath(id)}.${consts.stemplate}`, structuredJson(tnode));

    let geometry = probe.ds;
    const regenerated = this.codec.templates.parse(tnode);
    if (regenerated !== null) {
      regenerated.load();
      geometry = this.probeOf(regenerated, w, id).ds;
    }
    const base = `${this.objPath(id)}.${consts.params}.`;
    this.change(FrameKind.ChangeAttr, base + consts.cx, geometry.cx());
    this.change(FrameKind.ChangeAttr, base + consts.cy, geometry.cy());
    this.change(FrameKind.ChangeAttr, base + consts.width, geometry.width());
    this.change(FrameKind.ChangeAttr, base + consts.height, geometry.height());
    this.change(FrameKind.ChangeAttr, base + consts.angle, geometry.angle());

    // The new template becomes the working one.
    NodeOps.setWorkingGeometry(w, geometry);
    const installed = this.codec.templates.parse(tnode);
    if (installed !== null) {
      installed.load();
      const parent = w.style !== null ? w.style.parent() : null;
      w.style = this.cloneProfile(installed.getStyle(), true);
      w.style.setParent(parent);
      w.installed = installed;
    }
    w.tnode = tnode;

    this.condition(
      FrameKind.ChangeAttr,
      `${this.objPath(id)}.${consts.stemplate}.${consts.id}`,
      (tobj.shapeTemplate() as ShapeTemplate).id(),
    );
    return true;
  }

  // ---------------------------------------------------------------- set_template_params

  doSetTemplateParams(opNode: JsonObject, at: number): boolean {
    const id = this.resolveId(opNode, at, true);
    if (id === null) return false;
    const tobj = this.existingTemplated(id, at, OP.setTemplateParams);
    if (tobj === null) return false;

    let values = mem(opNode, K_PARAMS);
    if (!isJsonObject(values)) {
      values = mem(opNode, KEY.templateParams);
      if (!isJsonObject(values)) {
        return this.failAt(INVALID_OPERATION, 'set_template_params needs `params` as a name/value object', at);
      }
    }
    if (Object.keys(values).length === 0) {
      return this.failAt(
        INVALID_OPERATION,
        'set_template_params needs at least one parameter in `params`; stencil_get lists the ones this shape takes',
        at,
      );
    }

    const w = this.workingFor(id, tobj);
    const stl = this.currentTemplate(w, tobj) as ShapeTemplate;
    if (stl.params.length === 0) {
      return this.failAt(
        INVALID_OPERATION,
        "this shape's template declares no parameters; ask stencil_get which shapes do",
        at,
      );
    }

    const workingParams = w.tnode !== null ? mem(w.tnode, consts.params) : undefined;
    const node: JsonOut =
      workingParams !== undefined ? cloneObj(workingParams) : cloneObj(serializeTemplateParams(stl.params));
    const storedTemplate = tobj.shapeTemplate();
    const asRead =
      w.installed === null && storedTemplate !== null ? serializeTemplateParams(storedTemplate.params) : null;

    for (const name of sortedKeys(values)) {
      const declared = stl.params.find((tp) => tp.name === name) ?? null;
      if (declared === null) {
        return this.failAt(
          INVALID_OPERATION,
          `this shape's template declares no parameter "${name}"; stencil_get lists the ones it does`,
          at,
        );
      }
      if (declared.editor.type === ParamEditorType.Hidden) {
        return this.failAt(INVALID_OPERATION, `template parameter "${name}" is Hidden and cannot be set`, at);
      }
      const value = values[name];
      if (value === undefined || (value !== null && typeof value === 'object')) {
        return this.failAt(INVALID_OPERATION, `template parameter "${name}" takes a number, a string or a boolean`, at);
      }
      const checked = this.checkParamValue(name, declared, value, at);
      if (checked === undefined) return false;

      const current = mem(node, name);
      if (current === undefined) {
        return this.failAt(INVALID_OPERATION, `template parameter "${name}" has no stored value to change`, at);
      }
      const paramPath = `${this.objPath(id)}.${consts.stemplate}.${consts.params}.${name}`;
      const read = asRead !== null ? mem(asRead, name) : undefined;
      if (isJsonObject(current) && mem(current, STORED.value) !== undefined) {
        if (isJsonObject(read) && mem(read, STORED.value) !== undefined) {
          this.condition(
            FrameKind.ChangeTemplateParams,
            `${paramPath}.${STORED.value}`,
            structuredJson(mem(read, STORED.value) as JsonValue),
          );
        }
        writable(current)[STORED.value] = checked;
      } else {
        if (read !== undefined) this.condition(FrameKind.ChangeTemplateParams, paramPath, structuredJson(read));
        node[name] = checked;
      }
    }

    if (w.tnode !== null) w.tnode[consts.params] = structuredJson(node);
    this.change(FrameKind.ChangeTemplateParams, `${this.objPath(id)}.${consts.stemplate}.${consts.params}`, node);
    return true;
  }

  // ---------------------------------------------------------------- set_style

  doSetStyle(opNode: JsonObject, at: number): boolean {
    const id = this.resolveId(opNode, at, true, true);
    if (id === null) return false;
    const obj = this.existing(id, at, OP.setStyle);
    if (obj === null) return this.failAt(OBJECT_NOT_FOUND, `no object "${id}" on page ${this.pageId}`, at);
    const style = mem(opNode, KEY.style);
    if (!isJsonObject(style) || Object.keys(style).length === 0) {
      return this.failAt(INVALID_OPERATION, 'set_style needs a `style` object with at least one attribute', at);
    }

    // A group is restyled the way the app restyles one.
    if (obj instanceof GroupObject) {
      for (const k of sortedKeys(style)) {
        if (storedStyleKey(k) === null) return this.failAt(INVALID_OPERATION, styleKeyMessage(k), at);
        if (this.storedStyleNode(k, style[k], undefined, at) === undefined) return false;
      }
      return this.restyleGroupTree(obj, this.objPath(id), style, at, new Map());
    }

    const tobj = obj instanceof TemplatedObject ? obj : null;
    const hasTemplate = tobj !== null && tobj.shapeTemplate() !== null;
    let base = `${this.objPath(id)}.`;
    base += hasTemplate ? `${consts.stemplate}.${consts.style}.` : `${consts.style}.`;

    const currentStyle = serializeStyle(obj.getDrawingProfile());
    const w = this.workingFor(id, obj);
    const workingStyle = w.style !== null ? serializeStyle(w.style) : null;
    const written: JsonOut = {};

    const scratch = w.style !== null ? this.cloneProfile(w.style, hasTemplate) : null;
    const textKeys = slotClearedTextKeys();
    const unpinKeys: string[] = [];
    const target = styleTargetFor(obj, tobj !== null ? this.currentTemplate(w, tobj) : null);
    let labelless = false;
    if (obj instanceof ConnectionObject) {
      const labelled = this.edgeLabelled.get(id);
      labelless = labelled !== undefined ? !labelled : !hasLabel(obj.texts);
    }
    const latent: string[] = [];
    for (const k of sortedKeys(style)) {
      const storedKey = storedStyleKey(k);
      if (storedKey === null) return this.failAt(INVALID_OPERATION, styleKeyMessage(k), at);
      const current = mem(currentStyle, storedKey);
      const workingCurrent = workingStyle !== null ? mem(workingStyle, storedKey) : current;
      const value = this.storedStyleNode(k, style[k], workingCurrent, at);
      if (value === undefined) return false;
      const changes = this.styleWriteChanges(scratch, w.tnode, storedKey, value);
      const inert = inertStyleReason(target, k);
      if (inert !== null && changes) {
        return this.failAt(INVALID_OPERATION, inertStyleMessage(spelledOf(opNode), k, inert), at);
      }
      written[storedKey] = structuredJson(value);
      if (!changes) continue;
      if (labelless && latentEdgeKey(k)) latent.push(k);
      if (textKeys.includes(storedKey)) unpinKeys.push(storedKey);
      this.change(FrameKind.ChangeStyle, base + storedKey, value);
      this.condition(
        FrameKind.ChangeStyle,
        base + storedKey,
        current !== undefined ? structuredJson(current) : existsNode(false),
      );
    }
    if (tobj !== null && hasTemplate) this.unpinSlotTextStyle(tobj, this.objPath(id), unpinKeys);
    this.applyStyleToWorking(w, written);
    this.noteLatentKeys(id, spelledOf(opNode), latent);
    return true;
  }

  restyleGroupTree(
    obj: LekhObject,
    path: string,
    style: JsonObject,
    at: number,
    written: Map<string, string>,
  ): boolean {
    const group = obj instanceof GroupObject ? obj : null;
    const tobj = obj instanceof TemplatedObject ? obj : null;
    const templated = group !== null || (tobj !== null && tobj.shapeTemplate() !== null);
    const base = `${path}.${templated ? `${consts.stemplate}.${consts.style}` : consts.style}.`;
    if (group !== null) {
      let first = new Map<string, string>();
      let isFirst = true;
      for (const contained of group.objects()) {
        const member = contained.object as LekhObject | null;
        if (member === null) continue;
        const memberWritten = new Map<string, string>();
        const memberPath = `${path}.${consts.objects}.${member.id}.object`;
        if (!this.restyleGroupTree(member, memberPath, style, at, memberWritten)) return false;
        if (isFirst) first = memberWritten;
        isFirst = false;
      }
      for (const key of [...first.keys()].sort(byteOrder)) {
        const changes = this.frame(FrameKind.ChangeStyle).changes;
        const changePath = first.get(key) as string;
        if (!changes.has(changePath)) continue;
        this.change(FrameKind.ChangeStyle, base + key, structuredJson(changes.get(changePath) as JsonValue));
        written.set(key, base + key);
      }
      return true;
    }

    // A leaf: its own working state; written only when the write changes what it draws.
    const currentStyle = serializeStyle(obj.getDrawingProfile());
    const w = this.workingFor(obj.id, obj);
    const workingStyle = w.style !== null ? serializeStyle(w.style) : null;
    const scratch = w.style !== null ? this.cloneProfile(w.style, templated) : null;
    const applied: JsonOut = {};
    for (const k of sortedKeys(style)) {
      const storedKey = storedStyleKey(k) as string;
      const current = mem(currentStyle, storedKey);
      const workingCurrent = workingStyle !== null ? mem(workingStyle, storedKey) : current;
      const value = this.storedStyleNode(k, style[k], workingCurrent, at);
      if (value === undefined) return false;
      applied[storedKey] = structuredJson(value);
      if (!this.styleWriteChanges(scratch, w.tnode, storedKey, value)) continue;
      this.change(FrameKind.ChangeStyle, base + storedKey, value);
      this.condition(
        FrameKind.ChangeStyle,
        base + storedKey,
        current !== undefined ? structuredJson(current) : existsNode(false),
      );
      written.set(storedKey, base + storedKey);
    }
    this.applyStyleToWorking(w, applied);
    return true;
  }

  /** B1: does this write change what the object draws? (`scratch` keeps the key afterwards.) */
  styleWriteChanges(scratch: Style | null, tnode: JsonOut | null, storedKey: string, value: JsonValue): boolean {
    if (tnode !== null && slotClearedTextKeys().includes(storedKey)) {
      const texts = mem(tnode, consts.texts);
      if (Array.isArray(texts)) {
        for (const slot of texts as readonly JsonValue[]) {
          if (!isJsonObject(slot)) continue;
          const slotStyle = mem(slot, consts.style);
          if (!isJsonObject(slotStyle)) continue;
          const pinned = mem(slotStyle, storedKey);
          if (
            pinned !== undefined &&
            slotKeyOverridable(slotStyle, storedKey) &&
            !this.sameStoredStyleValue(storedKey, pinned, value)
          ) {
            return true;
          }
        }
      }
    }
    if (scratch === null) return true;

    const before = serializeStyle(scratch, true);
    const node: JsonOut = { ...serializeStyle(scratch) };
    node[storedKey] = structuredJson(value);
    this.parseAsLoaded(scratch, node);
    const after = serializeStyle(scratch, true);
    const was = mem(before, storedKey);
    const is = mem(after, storedKey);
    return was === undefined || is === undefined ? was !== is : !jsonEqual(was, is);
  }

  unpinSlotTextStyle(tobj: TemplatedObject, path: string, keys: readonly string[]): void {
    if (keys.length === 0) return;
    const w = this.workingFor(tobj.id, tobj);
    if (w.tnode === null) return;
    const texts = mem(w.tnode, consts.texts);
    if (!Array.isArray(texts)) return;

    const storedTemplate = tobj.shapeTemplate();
    const asRead =
      w.installed === null && storedTemplate !== null ? this.codec.templates.serialize(storedTemplate) : null;
    const storedTexts = asRead !== null ? mem(asRead, consts.texts) : undefined;

    const templatePath = `${path}.${consts.stemplate}`;
    let changed = false;
    const list = texts as JsonValue[];
    for (let i = 0; i < list.length; i++) {
      const slot = list[i];
      if (!isJsonObject(slot)) continue;
      const slotStyle = mem(slot, consts.style);
      if (!isJsonObject(slotStyle)) continue;
      const ss = writable(slotStyle);
      const storedList = Array.isArray(storedTexts) ? (storedTexts as readonly JsonValue[]) : null;
      const storedSlot =
        storedList !== null && i < storedList.length && storedList[i] !== undefined && storedList[i] !== null;
      const storedSlotStyle = storedSlot ? mem(storedList[i], consts.style) : undefined;
      for (const key of keys) {
        if (mem(ss, key) === undefined) continue;
        if (!slotKeyOverridable(ss, key)) continue;
        if (storedSlot) {
          const was = isJsonObject(storedSlotStyle) ? mem(storedSlotStyle, key) : undefined;
          this.condition(
            FrameKind.ChangeAttr,
            `${templatePath}.${consts.texts}.${String(i)}.${consts.style}.${key}`,
            was !== undefined ? structuredJson(was) : existsNode(false),
          );
        }
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- C++ removeField
        delete ss[key];
        changed = true;
      }
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- C++ removeField
      if (Object.keys(ss).length === 0) delete writable(slot)[consts.style];
    }
    if (changed) this.change(FrameKind.ChangeAttr, templatePath, structuredJson(w.tnode));
  }

  sameStoredStyleValue(storedKey: string, a: JsonValue | undefined, b: JsonValue | undefined): boolean {
    // Each value is parsed into a bare Style and serialized back, so two spellings of one value
    // compare equal exactly when the loader would read them alike.
    const normalised = (v: JsonValue | undefined): JsonObject => {
      const style = new Style();
      parseStyle(style, { [storedKey]: v === undefined ? null : structuredJson(v) }, false);
      return serializeStyle(style);
    };
    const va = mem(normalised(a), storedKey);
    const vb = mem(normalised(b), storedKey);
    return va === undefined || vb === undefined ? jsonEqual(a, b) : jsonEqual(va, vb);
  }

  storedStyleNode(
    semanticKey: string,
    value: JsonValue | undefined,
    currentStored: JsonValue | undefined,
    at: number,
    prefix = '',
  ): JsonValue | undefined {
    const refuse = (why: string): JsonValue | undefined => {
      this.failAt(INVALID_OPERATION, `${prefix}style.${semanticKey}: ${why}`, at);
      return undefined;
    };
    if (value === undefined || value === null) {
      return refuse('a style attribute cannot be set to null; name a value');
    }

    // Paints.
    if (semanticKey === 'stroke' || semanticKey === 'fill' || semanticKey === 'text_color') {
      if (typeof value !== 'string') {
        return refuse('a paint is "none" or a colour like "#3366ff"; authoring a gradient is not on this surface');
      }
      if (value === 'none') return { [consts.type]: PaintType.NoPaint };
      const color = hexToColor(value);
      if (color === null) return refuse(`"${value}" is not a colour; use #rgb, #rrggbb or #rrggbbaa, or "none"`);
      let currentType: number = PaintType.Solid;
      if (isJsonObject(currentStored)) {
        const t = intField(currentStored, consts.type);
        if (t !== null) currentType = t;
      }
      if (
        currentType === PaintType.LinearGradient ||
        currentType === PaintType.RadialGradient ||
        currentType === PaintType.Pattern
      ) {
        // A write is a patch: the gradient keeps its stops, spread and geometry.
        const paint = cloneObj(currentStored);
        paint[consts.color] = color.toInt();
        return paint;
      }
      return { [consts.type]: PaintType.Solid, [consts.color]: color.toInt() };
    }

    // Named enums.
    for (const [key, table] of NAMED_ENUMS) {
      if (semanticKey !== key) continue;
      if (typeof value !== 'string') return refuse('expects one of the words the projection reports');
      const ordinal = enumValue(table, value);
      if (ordinal === null) return refuse(`"${value}" is not a value this attribute takes`);
      return ordinal;
    }

    // The bit field.
    if (semanticKey === 'text_decoration') {
      if (!Array.isArray(value)) return refuse('is a list, e.g. ["underline"] or []');
      let bits = 0;
      for (const entry of value as readonly JsonValue[]) {
        if (typeof entry !== 'string') return refuse('is a list of words');
        const bit = enumValue(TEXT_DECORATIONS, entry);
        if (bit === null) return refuse(`"${entry}" is not a decoration`);
        bits |= bit;
      }
      return bits === 0 ? TextDecoration.Normal : bits;
    }

    // The dash array, in the form the loader keeps: at most four whole lengths.
    if (semanticKey === 'dash_array') {
      if (!Array.isArray(value)) return refuse('is a list of dash lengths');
      const lengths: number[] = [];
      for (const entry of value as readonly JsonValue[]) {
        const length = numberOf(entry);
        if (length === null) return refuse('is a list of numbers');
        if (!Number.isFinite(length)) return refuse('is not a finite number');
        if (length < 0) return refuse(`${numberWord(length)} is not a dash length; use 0 or more`);
        lengths.push(length);
      }
      const arr: number[] = [];
      let anyDash = false;
      for (let i = 0; i < lengths.length && i < 4; i++) {
        const whole = Math.trunc(lengths[i] as number);
        if (whole !== 0) anyDash = true;
        arr.push(whole);
      }
      if (lengths.length > 0 && !anyDash) {
        return refuse(
          'every length truncates to 0, which draws no dash; use whole lengths of 1 or more, or [] for a solid line',
        );
      }
      return arr;
    }
    if (semanticKey === 'font_family' || semanticKey === 'font_face') {
      if (typeof value !== 'string') return refuse('is a string');
      return value;
    }
    if (semanticKey === 'disabled') {
      if (typeof value !== 'boolean') return refuse('is true or false');
      return value;
    }

    // Numbers.
    const number = numberOf(value);
    if (number === null) return refuse('is a number');
    if (!Number.isFinite(number)) return refuse('is not a finite number');
    if (semanticKey === 'stroke_width' && number < 0) {
      return refuse(`${numberWord(number)} is not a width; use 0 or more (stroke "none" hides the outline)`);
    }
    if (semanticKey === 'font_size' && number <= 0) {
      return refuse(`${numberWord(number)} would make the text undrawable; use a size greater than 0`);
    }
    if (semanticKey === 'font_size_scale' && number <= 0) {
      return refuse(`${numberWord(number)} would make the text undrawable; use a scale greater than 0`);
    }
    if (semanticKey === 'dash_pattern_phase') {
      if (number < 0) return refuse(`${numberWord(number)} is not a phase; use a whole number, 0 or more`);
      const whole = Math.trunc(number);
      if (whole === 0 && number !== 0) {
        return refuse(`${numberWord(number)} is kept as a whole number and would become 0; use 0, or 1 or more`);
      }
      return whole;
    }
    return number;
  }

  // ---------------------------------------------------------------- set_arrow

  doSetArrow(opNode: JsonObject, at: number): boolean {
    const id = this.resolveId(opNode, at, true, true);
    if (id === null) return false;
    const obj = this.existing(id, at, OP.setArrow);
    if (obj === null) return this.failAt(OBJECT_NOT_FOUND, `no object "${id}" on page ${this.pageId}`, at);
    if (obj instanceof GroupObject) {
      return this.failAt(INVALID_OPERATION, `"${id}" is a group, and a group cannot carry an arrowhead`, at);
    }
    if (!(obj instanceof TemplatedObject) && !(obj instanceof ConnectionObject)) {
      return this.failAt(INVALID_OPERATION, `"${id}" cannot carry an arrowhead`, at);
    }
    // An arrowhead only where it is drawn, decided by the stored template.
    if (obj instanceof TemplatedObject && !drawsArrowheads(obj.shapeTemplate())) {
      const ends = [KEY.start, KEY.end] as const;
      for (let e = 0; e < 2; e++) {
        const member = mem(opNode, ends[e] as string);
        if (typeof member !== 'string' || member === '') continue;
        const wanted = this.resolveArrow(member);
        if (wanted === null) continue;
        const held = e === 0 ? obj.arrows.start() : obj.arrows.end();
        if (held !== null && held.id() === wanted.id()) continue;
        return this.failAt(INVALID_OPERATION, arrowheadRefusal(obj.shapeTemplate(), spelledOf(opNode)), at);
      }
    }

    let wroteOne = false;
    const ends = [KEY.start, KEY.end] as const;
    const stored = [consts.start, consts.end] as const;
    for (let e = 0; e < 2; e++) {
      const member = mem(opNode, ends[e] as string);
      if (member === undefined) continue;
      wroteOne = true;
      const path = `${this.objPath(id)}.${consts.arrows}.${stored[e] as string}`;
      if (member === null) {
        this.change(FrameKind.ChangeArrow, path, null);
        continue;
      }
      if (typeof member !== 'string' || member === '') return this.failAt(INVALID_OPERATION, ARROWHEAD_IS, at);
      const arrow = this.resolveArrow(member);
      if (arrow === null) return this.failAt(UNKNOWN_STENCIL, arrowheadMessage(member), at);
      this.change(FrameKind.ChangeArrow, path, this.codec.templates.serialize(arrow));
    }
    if (!wroteOne) return this.failAt(INVALID_OPERATION, 'set_arrow needs `start`, `end`, or both', at);
    this.conditionExists(FrameKind.ChangeArrow, this.objPath(id));
    return true;
  }

  // ---------------------------------------------------------------- set_edge_route

  doSetEdgeRoute(opNode: JsonObject, at: number): boolean {
    const id = this.resolveId(opNode, at, false);
    if (id === null) return false;
    const con = this.existingConnection(id, at, OP.setEdgeRoute);
    if (con === null) return false;

    const currentType = con.getType();
    const present = (name: string): boolean => mem(opNode, name) !== undefined;

    const sides = new LoopSides();
    const sideMessage = readLoopSides(opNode, sides);
    if (sideMessage !== '') return this.failAt(INVALID_OPERATION, sideMessage, at);
    if (con.isSelfLoop() && con.first !== null) {
      const first = con.first;
      const named = first.id;
      const shape = settledCopy(first, this.config);
      const { from: angleFrom, to: angleTo } = con.selfLoopEndAngles();
      if (!sides.hasFrom) sides.from = sideOfAngle(shape, angleFrom);
      if (!sides.hasTo) sides.to = sideOfAngle(shape, angleTo);
      const anything =
        sides.any() || present(KEY.edgeType) || present(KEY.route) || present(KEY.autoType) || present(KEY.reach);
      if (!anything) {
        return this.failAt(INVALID_OPERATION, 'set_edge_route needs either an `auto_type` or a `route`', at);
      }
      const autoName = strField(opNode, KEY.autoType) ?? '';
      if (autoName !== '' && autoTypeFromName(autoName) === null) {
        return this.failAt(INVALID_OPERATION, autoTypeMessage(autoName), at);
      }
      const loop = this.selfLoopParams(opNode, at, first, named, sides, currentType, false);
      if (loop === null) return false;
      this.emitEdgeRoute(id, loop.params, loop.type, currentType);
      return true;
    }
    if (sides.any()) {
      const from = con.first !== null ? con.first.id : '';
      const to = con.second !== null ? con.second.id : '';
      return this.failAt(INVALID_OPERATION, loopSidesOnTwoNodesMessage(from, to), at);
    }

    let type: ConnectionType = currentType;
    const edgeName = strField(opNode, KEY.edgeType) ?? '';
    const hasEdgeType = edgeName !== '';
    if (hasEdgeType) {
      const t = edgeTypeFromName(edgeName);
      if (t === null) return this.failAt(INVALID_OPERATION, edgeTypeMessage(edgeName), at);
      type = t;
    }

    // A path connector's `edge_type` is not settable.
    const targetIsPath = type === ConnectionType.Path;
    if (targetIsPath && currentType !== ConnectionType.Path) {
      return this.failAt(
        INVALID_OPERATION,
        'an edge cannot be converted to `path`; the engine accepts only curve, line and orthogonal',
        at,
      );
    }

    let autoType: AutoType = AutoType.NoAuto;
    let autoName = strField(opNode, KEY.autoType) ?? '';
    let hasAuto = autoName !== '';
    if (hasAuto) {
      const a = autoTypeFromName(autoName);
      if (a === null) return this.failAt(INVALID_OPERATION, autoTypeMessage(autoName), at);
      autoType = a;
    }

    const routeMember = mem(opNode, KEY.route);
    const hasRoute = isJsonObject(routeMember);

    // A U-bend's reach.
    const currentAuto = con.getAutoType();
    const reachRead = this.readReach(opNode, at);
    if (reachRead === null) return false;
    const hasReach = reachRead.has;
    const reach = reachRead.value;
    if (hasReach) {
      if (hasRoute) return this.failAt(INVALID_OPERATION, REACH_MESSAGE, at);
      if (!hasAuto) {
        if (!isUBend(currentAuto)) return this.failAt(INVALID_OPERATION, REACH_MESSAGE, at);
        hasAuto = true;
        autoType = currentAuto;
        autoName = autoTypeName(currentAuto);
      } else if (!isUBend(autoType)) {
        return this.failAt(INVALID_OPERATION, REACH_MESSAGE, at);
      }
    }

    let params: Params;
    if (hasAuto && autoType !== AutoType.NoAuto) {
      if (hasRoute) {
        return this.failAt(
          INVALID_OPERATION,
          'an automatic route is recomputed from the endpoints every time the board loads: name an `auto_type` or give a `route`, not both',
          at,
        );
      }
      if (currentType === ConnectionType.Path) {
        return this.failAt(INVALID_OPERATION, 'a path edge has no automatic route', at);
      }
      if (con.first === null || con.second === null) {
        return this.failAt(
          INVALID_OPERATION,
          'this edge is missing an endpoint, so a route cannot be computed for it',
          at,
        );
      }
      // The numbers of an automatic route are derived: asked of a throwaway auto connection.
      const probe = ConnectionObject.getAutoConnection(this.codec.env.objects, con.first, con.second, autoType);
      params = probe.getParams();
      type = autoType > 1 ? ConnectionType.MultiLine : ConnectionType.GenericLine;
      if (hasEdgeType) {
        const namedType = edgeTypeFromName(edgeName) ?? ConnectionType.MultiLine;
        if (namedType !== type) {
          return this.failAt(
            INVALID_OPERATION,
            `auto_type \`${autoName}\` is an edge_type of \`${edgeTypeName(type)}\`, not \`${edgeName}\``,
            at,
          );
        }
      }
      // The first and last step.
      const storedSteps = isLineAutoType(currentAuto) ? endSteps(con.getParams()) : null;
      if (
        autoType === currentAuto &&
        type === currentType &&
        (!hasReach || (storedSteps !== null && storedSteps[0] === reach && storedSteps[1] === reach))
      ) {
        return true;
      }
      if (isLineAutoType(autoType)) {
        if (hasReach) setEndSteps(params, reach, reach);
        else if (storedSteps !== null) setEndSteps(params, storedSteps[0], storedSteps[1]);
      }
    } else if (hasRoute) {
      const p = this.routeToParams(routeMember, type, autoType, at);
      if (p === null) return false;
      params = p;
    } else {
      return this.failAt(INVALID_OPERATION, 'set_edge_route needs either an `auto_type` or a `route`', at);
    }

    this.emitEdgeRoute(id, params, type, currentType);
    return true;
  }

  // ---------------------------------------------------------------- set_edge_texts

  doSetEdgeTexts(opNode: JsonObject, at: number): boolean {
    const id = this.resolveId(opNode, at, false);
    if (id === null) return false;
    const con = this.existingConnection(id, at, OP.setEdgeTexts);
    if (con === null) return false;

    const texts = mem(opNode, KEY.texts);
    if (!Array.isArray(texts)) {
      return this.failAt(INVALID_OPERATION, 'set_edge_texts needs `texts` as an array of {text, position}', at);
    }
    const out: JsonValue[] = [];
    for (const entry of texts as readonly JsonValue[]) {
      if (!isJsonObject(entry)) return this.failAt(INVALID_OPERATION, 'each edge label is an object with a `text`', at);
      const unknown = unknownLabelMember(entry);
      if (unknown !== null) return this.failAt(INVALID_OPERATION, labelMemberMessage(unknown), at);
      const text = strField(entry, KEY.text);
      if (text === null) return this.failAt(INVALID_OPERATION, 'each edge label needs a `text`', at);
      const position = labelPosition(entry);
      if (!position.ok) return this.failAt(INVALID_OPERATION, position.message, at);
      // The serializer does not store an empty connector label.
      if (text === '') continue;
      out.push({ [STORED.text]: text, [STORED.param]: position.value });
    }
    this.edgeLabelled.set(id, out.length > 0);
    this.change(FrameKind.ChangeConnectionTexts, `${this.objPath(id)}.${consts.texts}`, out);
    this.conditionExists(FrameKind.ChangeConnectionTexts, this.objPath(id));
    return true;
  }

  // ---------------------------------------------------------------- pages

  doAddPage(opNode: JsonObject, at: number): boolean {
    const pageId = this.ctx.newId();
    const name = strField(opNode, KEY.name) ?? '';
    const page = new Page(
      pageId,
      name !== '' ? name : `Page ${String(this.doc.pages.length + this.addedPageIds.length + 1)}`,
      this.doc.storeOptions,
    );

    // `order` is a position from 0 to the working order's length; omitted is the end.
    this.buildPageOrder();
    let position = this.pageOrder.length;
    const order = mem(opNode, KEY.order);
    if (order !== undefined) {
      const p = positionOf(order, this.pageOrder.length);
      if (p === null) {
        return this.failAt(INVALID_OPERATION, `order is a position from 0 to ${String(this.pageOrder.length)}`, at);
      }
      position = p;
    }

    // The canvas: the first page's type, and its size with its unit.
    const args = this.readPageSizeArgs(opNode, at);
    if (args === null) return false;
    const first = this.doc.pages[0] ?? null;
    const firstType = first !== null ? first.canvasSizeType : CanvasSizeType.Infinite;
    const sizeType = args.hasType ? args.type : firstType;
    let size = first !== null ? first.size : new PageSize();
    if (sizeType !== CanvasSizeType.Fixed) {
      if (args.anySize()) return this.failAt(INVALID_OPERATION, noSizeMessage(sizeType), at);
    } else {
      if (args.hasUnit && !(args.hasWidth && args.hasHeight))
        return this.failAt(INVALID_OPERATION, UNIT_NEEDS_BOTH, at);
      size = new PageSize(
        args.hasUnit ? args.unit : size.unit,
        args.hasWidth ? args.width : size.width,
        args.hasHeight ? args.height : size.height,
      );
      if (!(size.width > 0 && size.height > 0)) return this.failAt(INVALID_OPERATION, FIXED_CANVAS_NEEDS_SIZE, at);
    }
    page.canvasSizeType = sizeType;
    page.size = size;
    if (args.hasName) page.canvasName = args.name;
    else if (first !== null && sizeType === firstType && !args.anySize()) page.canvasName = first.canvasName;
    else page.canvasName = defaultCanvasName(sizeType);

    const background = mem(opNode, KEY.background);
    if (background !== undefined && background !== null) {
      const hex = strField(background, KEY.color);
      if (hex !== null) {
        const color = hexToColor(hex);
        if (color === null) return this.failAt(INVALID_OPERATION, `"${hex}" is not a background colour`, at);
        page.background.setColor(color);
      }
    }

    this.addedPageIds.push(pageId);
    this.addedPages.set(pageId, page);
    page.order = this.placePage(pageId, position, false);
    return true;
  }

  doDeletePage(opNode: JsonObject, at: number): boolean {
    const pageId = strField(opNode, K_PAGE) ?? '';
    if (pageId === '') return this.failAt(INVALID_OPERATION, 'delete_page needs `page`', at);
    this.buildPageOrder();
    const slot = this.pageOrder.indexOf(pageId);
    if (this.doc.getPage(pageId) === null || slot < 0) {
      return this.failAt(PAGE_NOT_FOUND, `no page "${pageId}" on this board`, at);
    }
    let storedLeft = 0;
    for (const pid of this.pageOrder) if (!this.addedPages.has(pid)) storedLeft++;
    if (storedLeft <= 1) return this.failAt(INVALID_OPERATION, 'a board must keep at least one page', at);
    this.pageOrder.splice(slot, 1);
    this.change(FrameKind.DelPages, this.pagePath(pageId), null);
    this.conditionExists(FrameKind.DelPages, this.pagePath(pageId));
    return true;
  }

  doMovePage(opNode: JsonObject, at: number): boolean {
    const pageId = strField(opNode, K_PAGE) ?? '';
    if (pageId === '') return this.failAt(INVALID_OPERATION, 'move_page needs `page`', at);
    if (this.addedPages.has(pageId)) {
      return this.failAt(INVALID_OPERATION, 'move a page in the batch after the one that adds it', at);
    }
    this.buildPageOrder();
    const slot = this.pageOrder.indexOf(pageId);
    if (this.doc.getPage(pageId) === null || slot < 0) {
      return this.failAt(PAGE_NOT_FOUND, `no page "${pageId}" on this board`, at);
    }
    const n = this.pageOrder.length;
    const index = positionOf(mem(opNode, K_TO_INDEX), n - 1);
    if (index === null) {
      return this.failAt(INVALID_OPERATION, `to_index is a position from 0 to ${String(n - 1)}`, at);
    }
    if (slot === index) return true;
    this.pageOrder.splice(slot, 1);
    this.placePage(pageId, index, true);
    return true;
  }

  /** The working order starts as the document's pages sorted (stably) by stored key. */
  buildPageOrder(): void {
    if (this.pageOrderBuilt) return;
    this.pageOrderBuilt = true;
    const pages = [...this.doc.pages].sort((a, b) => a.order - b.order);
    for (const page of pages) {
      this.pageOrder.push(page.id);
      this.pageKeys.set(page.id, page.order);
      this.storedPageKeys.set(page.id, page.order);
    }
  }

  /** The condition on a page's key as read; a page the batch adds has none. */
  conditionPageOrder(pageId: string): void {
    const stored = this.storedPageKeys.get(pageId);
    if (stored === undefined) return;
    this.condition(FrameKind.ChangePageAttr, `${this.pagePath(pageId)}.${consts.order}`, stored);
  }

  /** Puts `pageId` at `index` of the working order and gives it a key (deterministic). */
  placePage(pageId: string, index: number, conditionNeighbours: boolean): number {
    const keyOf = (pid: string): number => this.pageKeys.get(pid) ?? 0;
    const hasPrev = index > 0;
    const hasNext = index < this.pageOrder.length;
    const prev = hasPrev ? keyOf(this.pageOrder[index - 1] as string) : 0;
    const next = hasNext ? keyOf(this.pageOrder[index] as string) : 0;

    let key = 0;
    const renumbered: string[] = [];
    if (hasPrev && hasNext) {
      if (next - prev > 1) {
        key = prev + Math.trunc((next - prev) / 2);
      } else {
        key = prev + 100;
        let before = key;
        for (let i = index; i < this.pageOrder.length; i++) {
          const following = this.pageOrder[i] as string;
          if (keyOf(following) > before) {
            before = keyOf(following);
            continue;
          }
          this.pageKeys.set(following, before + 100);
          before = before + 100;
          renumbered.push(following);
        }
      }
    } else if (hasNext) {
      key = next - 100;
    } else if (hasPrev) {
      key = prev + 100;
    }

    this.pageOrder.splice(index, 0, pageId);
    this.pageKeys.set(pageId, key);
    this.pageKeysWritten.add(pageId);
    for (const pid of renumbered) this.pageKeysWritten.add(pid);

    if (conditionNeighbours || renumbered.length > 0) {
      this.conditionPageOrder(pageId);
      for (const pid of renumbered) this.conditionPageOrder(pid);
      if (hasPrev) this.conditionPageOrder(this.pageOrder[index - 1] as string);
      if (hasNext) this.conditionPageOrder(this.pageOrder[index + 1] as string);
    }
    return key;
  }

  /** Each page gets one final key: in its `addpages` body, or as a `…order` change. */
  finishPageOrder(): void {
    for (const pid of [...this.addedPages.keys()].sort(byteOrder)) {
      const page = this.addedPages.get(pid) as Page;
      page.order = this.pageKeys.get(pid) ?? 0;
      this.change(FrameKind.AddPages, this.pagePath(pid), this.serializePage(page));
    }
    for (const pid of [...this.pageKeysWritten].sort(byteOrder)) {
      if (this.addedPages.has(pid)) continue;
      if (!this.pageOrder.includes(pid)) continue;
      if (this.pageKeys.get(pid) === this.storedPageKeys.get(pid)) continue;
      this.change(FrameKind.ChangePageAttr, `${this.pagePath(pid)}.${consts.order}`, this.pageKeys.get(pid) ?? 0);
    }
  }

  /** The page an op names, or the batch's (C++ `pageId.empty()` → `pageId_`). */
  private pageOf(opNode: JsonObject): string {
    const p = strField(opNode, K_PAGE) ?? '';
    return p === '' ? this.pageId : p;
  }

  doRenamePage(opNode: JsonObject, at: number): boolean {
    const pageId = this.pageOf(opNode);
    const page = this.doc.getPage(pageId);
    if (page === null) return this.failAt(PAGE_NOT_FOUND, `no page "${pageId}" on this board`, at);
    const name = strField(opNode, KEY.name);
    if (name === null) return this.failAt(INVALID_OPERATION, 'rename_page needs `name`', at);
    const path = `${this.pagePath(pageId)}.${consts.name}`;
    this.change(FrameKind.ChangePageAttr, path, name);
    this.condition(FrameKind.ChangePageAttr, path, page.name);
    return true;
  }

  doResizePage(opNode: JsonObject, at: number): boolean {
    const pageId = this.pageOf(opNode);
    const page = this.doc.getPage(pageId);
    if (page === null) return this.failAt(PAGE_NOT_FOUND, `no page "${pageId}" on this board`, at);

    const args = this.readPageSizeArgs(opNode, at);
    if (args === null) return false;
    if (!args.anySize() && !args.hasType && !args.hasName) return this.failAt(INVALID_OPERATION, RESIZE_NEEDS, at);

    const stored = page.size;
    const storedType = page.canvasSizeType;
    const sizeType = args.hasType ? args.type : storedType;
    let size = stored;
    if (sizeType !== CanvasSizeType.Fixed) {
      if (args.anySize()) return this.failAt(INVALID_OPERATION, noSizeMessage(sizeType), at);
    } else {
      if (args.hasUnit && !(args.hasWidth && args.hasHeight))
        return this.failAt(INVALID_OPERATION, UNIT_NEEDS_BOTH, at);
      size = new PageSize(
        args.hasUnit ? args.unit : size.unit,
        args.hasWidth ? args.width : size.width,
        args.hasHeight ? args.height : size.height,
      );
      if (!(size.width > 0 && size.height > 0)) return this.failAt(INVALID_OPERATION, FIXED_CANVAS_NEEDS_SIZE, at);
    }

    // Only what differs is written.
    const writeSize =
      args.anySize() && (size.width !== stored.width || size.height !== stored.height || size.unit !== stored.unit);
    const writeType = sizeType !== storedType;
    let name = '';
    let writeName = false;
    if (args.hasName) {
      name = args.name;
      writeName = name !== page.canvasName || writeSize || writeType;
    } else if (writeSize || writeType) {
      name = defaultCanvasName(sizeType);
      writeName = true;
    }
    if (!writeSize && !writeType && !writeName) return true;

    const base = `${this.pagePath(pageId)}.`;
    if (writeSize) {
      this.change(FrameKind.ChangePageAttr, base + consts.size, {
        [consts.height]: size.height,
        [consts.unit]: Length.unitStr(size.unit),
        [consts.width]: size.width,
      });
      const sizePath = `${base}${consts.size}.`;
      this.condition(FrameKind.ChangePageAttr, sizePath + consts.width, stored.width);
      this.condition(FrameKind.ChangePageAttr, sizePath + consts.height, stored.height);
      this.condition(FrameKind.ChangePageAttr, sizePath + consts.unit, Length.unitStr(stored.unit));
    }
    if (writeType) {
      this.change(FrameKind.ChangePageAttr, base + consts.canvassizetype, Page.sizeTypeToStr(sizeType));
      this.condition(FrameKind.ChangePageAttr, base + consts.canvassizetype, Page.sizeTypeToStr(storedType));
    }
    if (writeName) {
      this.change(FrameKind.ChangePageAttr, base + consts.canvasname, name);
      this.condition(FrameKind.ChangePageAttr, base + consts.canvasname, this.canvasNameCondition(page));
    }
    return true;
  }

  readUnit(opNode: JsonObject, at: number): { has: boolean; unit: Unit } | null {
    const member = mem(opNode, KEY.unit);
    if (member === undefined) return { has: false, unit: Unit.Point };
    const name = typeof member === 'string' ? member : storeJson(member);
    const unit = typeof member === 'string' ? unitFromName(name) : null;
    if (unit === null) {
      this.failAt(INVALID_OPERATION, unitMessage(name), at);
      return null;
    }
    return { has: true, unit };
  }

  readPageSizeArgs(opNode: JsonObject, at: number): PageSizeArgs | null {
    const out = new PageSizeArgs();
    const canvasType = strField(opNode, K_CANVAS_TYPE) ?? '';
    if (canvasType !== '') {
      const t = canvasTypeFromName(canvasType);
      if (t === null) {
        this.failAt(INVALID_OPERATION, canvasTypeMessage(canvasType), at);
        return null;
      }
      out.type = t;
      out.hasType = true;
    }
    const width = numberOf(mem(opNode, KEY.width));
    if (width !== null) {
      out.hasWidth = true;
      out.width = width;
    }
    const height = numberOf(mem(opNode, KEY.height));
    if (height !== null) {
      out.hasHeight = true;
      out.height = height;
    }
    const unit = this.readUnit(opNode, at);
    if (unit === null) return null;
    out.hasUnit = unit.has;
    if (unit.has) out.unit = unit.unit;
    const name = mem(opNode, K_CANVAS_NAME);
    if (name !== undefined) {
      if (typeof name !== 'string') {
        this.failAt(INVALID_OPERATION, CANVAS_NAME_IS_STRING, at);
        return null;
      }
      out.name = name;
      out.hasName = true;
    }
    return out;
  }

  /** `$in: ["", null]` for an unnamed page (a "" and a missing name cannot be told apart once loaded). */
  canvasNameCondition(page: Page): JsonValue {
    if (page.canvasName !== '') return page.canvasName;
    return { $in: ['', null] };
  }

  /** A document attribute the loader defaults: `$in: [<default>, null]` when the read value is the default. */
  defaultTolerantCondition(value: JsonValue, loaderDefault: JsonValue): JsonValue {
    if (!jsonEqual(value, loaderDefault)) return value;
    return { $in: [value, null] };
  }

  doSetPageBackground(opNode: JsonObject, at: number): boolean {
    const pageId = this.pageOf(opNode);
    const page = this.doc.getPage(pageId);
    if (page === null) return this.failAt(PAGE_NOT_FOUND, `no page "${pageId}" on this board`, at);

    let hex = '';
    const background = mem(opNode, KEY.background);
    if (background !== undefined && background !== null) hex = strField(background, KEY.color) ?? '';
    if (hex === '') hex = strField(opNode, KEY.color) ?? '';
    if (hex === '') return this.failAt(INVALID_OPERATION, 'set_page_background needs a `color` like "#ffffff"', at);
    const color = hexToColor(hex);
    if (color === null)
      return this.failAt(INVALID_OPERATION, `"${hex}" is not a colour; use #rgb, #rrggbb or #rrggbbaa`, at);

    const path = `${this.pagePath(pageId)}.${consts.background}`;
    this.change(FrameKind.ChangeBackground, path, { [consts.color]: color.toInt() });
    // An image page stores no `color`: the condition is its absence.
    this.condition(
      FrameKind.ChangeBackground,
      `${path}.${consts.color}`,
      page.background.type === BackgroundType.Image ? null : page.background.color.toInt(),
    );
    return true;
  }

  doSetPageMargin(opNode: JsonObject, at: number): boolean {
    const pageId = this.pageOf(opNode);
    const page = this.doc.getPage(pageId);
    if (page === null) return this.failAt(PAGE_NOT_FOUND, `no page "${pageId}" on this board`, at);
    const current = page.margin;
    const path = `${this.pagePath(pageId)}.${consts.margin}`;

    const remove = mem(opNode, K_REMOVE);
    if (remove !== undefined) {
      if (remove !== true) return this.failAt(INVALID_OPERATION, MARGIN_REMOVE_VALUE, at);
      if (
        mem(opNode, KEY.leftRight) !== undefined ||
        mem(opNode, KEY.topBottom) !== undefined ||
        mem(opNode, KEY.unit) !== undefined
      ) {
        return this.failAt(INVALID_OPERATION, MARGIN_REMOVE_ALONE, at);
      }
      if (!current.show) return true;
      this.change(FrameKind.ChangePageAttr, path, null);
      this.condition(FrameKind.ChangePageAttr, `${path}.${consts.width}`, current.size.width);
      this.condition(FrameKind.ChangePageAttr, `${path}.${consts.height}`, current.size.height);
      return true;
    }

    const leftRight = numberOf(mem(opNode, KEY.leftRight));
    const topBottom = numberOf(mem(opNode, KEY.topBottom));
    if (leftRight === null || topBottom === null || !(leftRight > 0) || !(topBottom > 0)) {
      return this.failAt(INVALID_OPERATION, MARGIN_NEEDS, at);
    }
    const unitRead = this.readUnit(opNode, at);
    if (unitRead === null) return false;
    const unit = unitRead.has ? unitRead.unit : current.show ? current.size.unit : page.size.unit;

    this.change(FrameKind.ChangePageAttr, path, marginToStored(leftRight, topBottom, unit));
    if (current.show) {
      this.condition(FrameKind.ChangePageAttr, `${path}.${consts.width}`, current.size.width);
      this.condition(FrameKind.ChangePageAttr, `${path}.${consts.height}`, current.size.height);
    } else {
      this.condition(FrameKind.ChangePageAttr, path, null);
    }
    return true;
  }

  // ---------------------------------------------------------------- document

  doSetGrid(opNode: JsonObject, at: number): boolean {
    let present = mem(opNode, K_PRESENT);
    if (typeof present !== 'boolean') present = mem(opNode, 'grid');
    if (typeof present !== 'boolean') {
      return this.failAt(INVALID_OPERATION, 'set_grid needs `present` as true or false', at);
    }
    const path = `${consts.doc}.${consts.attributes}.${consts.grid}.${consts.present}`;
    if (present === this.doc.grid.present && !this.frame(FrameKind.ChangeGrid).changes.has(path)) return true;
    this.change(FrameKind.ChangeGrid, path, present);
    this.condition(FrameKind.ChangeGrid, path, this.defaultTolerantCondition(this.doc.grid.present, true));
    return true;
  }

  doSetScaling(opNode: JsonObject, at: number): boolean {
    const scale = numberOf(mem(opNode, K_SCALE));
    if (scale === null || scale <= 0) return this.failAt(INVALID_OPERATION, 'set_scaling needs a positive `scale`', at);
    const given = this.readUnit(opNode, at);
    if (given === null) return false;
    const scaling = this.doc.scaling;
    const unit = Length.unitStr(given.has ? given.unit : scaling.unit);
    const path = `${consts.doc}.${consts.attributes}.${consts.scaling}`;
    const readUnit = Length.unitStr(scaling.unit);
    if (
      Math.fround(scale) === Math.fround(scaling.value) &&
      unit === readUnit &&
      !this.frame(FrameKind.ChangeScaling).changes.has(path)
    ) {
      return true;
    }
    this.change(FrameKind.ChangeScaling, path, { [consts.scale]: scale, [consts.unit]: unit });
    this.condition(FrameKind.ChangeScaling, `${path}.${consts.scale}`, this.defaultTolerantCondition(scaling.value, 1));
    this.condition(FrameKind.ChangeScaling, `${path}.${consts.unit}`, this.defaultTolerantCondition(readUnit, 'point'));
    return true;
  }
}
