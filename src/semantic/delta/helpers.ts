// The delta compiler's vocabulary and free helpers: a port of everything in C++
// `semantic/SemanticDelta.cpp` before `class Compilation` (its anonymous namespace, lines 46-1332).
//
// CONVENTIONS (shared by every file of `semantic/delta/`):
//   - A C++ `JsonNode*` read from the batch is `JsonValue | undefined`: `undefined` = absent
//     (C++ nullptr), `null` = a JSON null (C++ a NONE node). A built node is `JsonOut`.
//   - Out-parameters become return values. `bool f(…, T* out)` → `T | null` (null = false);
//     `bool f(…, T* out, string* message)` → `{ ok: true, value } | { ok: false, message }`
//     (`Checked<T>` below); a C++ in/out struct (`LoopSides*`) is passed and mutated as in C++.
//   - C++ `std::map` iteration order = keys sorted (`sortedKeys`), wherever order is observable.
//   - Messages and codes are the C++ strings, word for word (`\xE2\x80\x94` is `—`).
import { formatG6, type Config } from '../../base';
import {
  AutoType,
  ConnectionObject,
  ConnectionType,
  GroupObject,
  Side,
  SideRelation,
  TemplatedObject,
  UnrecognizedObject,
  allowsSelfLoop,
  relationOf,
  type ConnectorTextInfo,
  type LayoutEnv,
  type LekhObject,
  type Params,
} from '../../model';
import { CanvasSizeType } from '../../model';
import { updatetypes } from '../../sync';
import {
  BezierCurveTemplate,
  PathTemplate,
  PolygonTemplate,
  TemplateFlags,
  TextSide,
  textSideFromName,
  validateSemanticExpression,
  type ShapeTemplate,
} from '../../template';
import { KEY, StyleTarget, autoTypeFromName, edgeTypeFromName, pathCommandArity } from '../format';
import { isJsonObject, sortedKeys, type JsonObject, type JsonOut, type JsonValue } from '../json';

/** `bool f(…, T* out, string* message)`. */
export type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/** C++ `MemberVocabulary` (SemanticDelta.h): the members a node may carry and the refusal for one it may not. */
export interface MemberVocabulary {
  readonly allowed: readonly string[];
  readonly refusal: (member: string, location: string) => string;
}

// ---------------------------------------------------------------- vocabulary

/** The operation names of /backend/subsystems/mcp/semantic-format.md §5. */
export const OP = Object.freeze({
  addNode: 'add_node',
  addEdge: 'add_edge',
  deleteNode: 'delete_node',
  deleteEdge: 'delete_edge',
  moveNode: 'move_node',
  resizeNode: 'resize_node',
  rotateNode: 'rotate_node',
  reorder: 'reorder',
  group: 'group',
  ungroup: 'ungroup',
  setText: 'set_text',
  setTitle: 'set_title',
  setShape: 'set_shape',
  setTemplateParams: 'set_template_params',
  setStyle: 'set_style',
  setArrow: 'set_arrow',
  setEdgeRoute: 'set_edge_route',
  setEdgeTexts: 'set_edge_texts',
  addPage: 'add_page',
  deletePage: 'delete_page',
  movePage: 'move_page',
  renamePage: 'rename_page',
  resizePage: 'resize_page',
  clearPage: 'clear_page',
  setPageBackground: 'set_page_background',
  setPageMargin: 'set_page_margin',
  setGrid: 'set_grid',
  setScaling: 'set_scaling',
} as const);

/** Stored DOCUMENT field names that `update/Consts.h` does not carry (Serializer.cpp's own table). */
export const STORED = Object.freeze({
  text: 'text',
  param: 'param',
  generator: 'generator',
  row: 'row',
  col: 'col',
  value: 'value',
  data: 'data',
  draw: 'draw',
  path: 'path',
  flags: 'flags',
  /** A text entry's side, on the one entry that is the title. */
  external: 'external',
} as const);

// Envelope keys that are not projection keys.
export const K_OP = 'op';
export const K_OPS = 'ops';
export const K_REF = 'ref';
export const K_NODE = 'node';
export const K_EDGE = 'edge';
export const K_PAGE = 'page';
export const K_TEMPLATES = 'templates';
export const K_CONFLICT_POLICY = 'conflict_policy';
export const K_FORCE = 'force';
export const K_INDEX = 'index';
export const K_TO = 'to';
export const K_PARAMS = 'params';
export const K_CANVAS_TYPE = 'canvas_type';
export const K_PRESENT = 'present';
export const K_SCALE = 'scale';
export const K_TO_INDEX = 'to_index';
export const K_CANVAS_NAME = 'canvas_name';
export const K_REMOVE = 'remove';
export const K_EXISTS = '$exists';

// Error codes (/backend/subsystems/mcp/tools-and-resources.md §8).
export const INVALID_OPERATION = 'invalid_operation';
export const UNKNOWN_STENCIL = 'unknown_stencil';
export const OBJECT_NOT_FOUND = 'object_not_found';
export const PAGE_NOT_FOUND = 'page_not_found';
export const VERSION_REQUIRED = 'version_required';

export const Z_ORDER_ZERO = 'z_order 0 means "no order" to the loader; use any other integer';
export const REACH_MESSAGE = 'reach applies to a u_bend_* edge only, as a number of points greater than 0';

// Page size and margin (/spec/pages-and-document.md §§2, 5).
export const UNIT_NEEDS_BOTH = 'a unit needs both width and height; the size is not converted';
export const RESIZE_NEEDS = 'resize_page needs width, height, unit, canvas_type or canvas_name';
export const CANVAS_NAME_IS_STRING = 'canvas_name is a string';
export const MARGIN_NEEDS =
  'set_page_margin needs left_right and top_bottom greater than 0; to remove the margin, send remove: true';
export const MARGIN_NAMES =
  'set_page_margin takes left_right and top_bottom (the inset on each side), not width and height';
export const MARGIN_REMOVE_ALONE = 'set_page_margin takes remove: true on its own';
export const MARGIN_REMOVE_VALUE = 'remove is true or absent';

/** A hint replacing the generic "it takes …" tail; a `whole` hint is the entire message. */
export interface OpHint {
  readonly member: string;
  readonly text: string;
  readonly whole: boolean;
}

/** One operation: the members its `doX` reads besides `op`, and its hints. */
export interface OpRow {
  readonly name: string;
  readonly members: readonly string[];
  readonly hints: readonly OpHint[];
}

const ID_HINT = "an object's id is minted by the server; name it for later operations with `ref`";
const MOVE_HINT = 'move with move_node';
const RESIZE_HINT = 'resize with resize_node';
const TURN_HINT = 'turn with rotate_node';
const TEMPLATE_HINT = 'a group answers no template';
const GROUP_GEOMETRY_HINT = "a group's geometry is its members'; move_node, resize_node or rotate_node it afterwards";
const NEW_PAGE_HINT = "a new page's id is reported in the answer's added_pages";
const OBJECT_PAGE_HINT = 'a batch addresses one page: put `page` on the envelope';

const h = (member: string, text: string, whole = false): OpHint => Object.freeze({ member, text, whole });

function buildOpVocabulary(): readonly OpRow[] {
  const rows: { name: string; members: string[]; hints: OpHint[] }[] = [
    {
      name: OP.addNode,
      members: [
        'ref',
        'shape',
        'cx',
        'cy',
        'width',
        'height',
        'angle',
        'text',
        'texts',
        'title',
        'template_params',
        'style',
        'arrow',
        'image',
        'z_order',
        'draw',
      ],
      hints: [h('id', ID_HINT)],
    },
    {
      name: OP.addEdge,
      members: [
        'ref',
        'from',
        'to',
        'auto_type',
        'reach',
        'edge_type',
        'route',
        'texts',
        'arrow',
        'style',
        'z_order',
        'from_side',
        'to_side',
        'bend',
      ],
      hints: [h('id', ID_HINT), h('text', 'a label goes in `texts: [{ "text": … }]`')],
    },
    { name: OP.deleteNode, members: ['node'], hints: [] },
    { name: OP.deleteEdge, members: ['edge'], hints: [] },
    {
      name: OP.moveNode,
      members: ['node', 'cx', 'cy'],
      hints: [h('width', RESIZE_HINT), h('height', RESIZE_HINT), h('angle', TURN_HINT)],
    },
    {
      name: OP.resizeNode,
      members: ['node', 'width', 'height'],
      hints: [h('cx', MOVE_HINT), h('cy', MOVE_HINT), h('angle', TURN_HINT)],
    },
    {
      name: OP.rotateNode,
      members: ['node', 'angle'],
      hints: [h('cx', MOVE_HINT), h('cy', MOVE_HINT), h('width', RESIZE_HINT), h('height', RESIZE_HINT)],
    },
    { name: OP.reorder, members: ['node', 'edge', 'to'], hints: [] },
    {
      name: OP.group,
      members: ['nodes', 'ref'],
      hints: [
        h('style', 'restyle the group with set_style naming it, in the next batch'),
        h('template_params', TEMPLATE_HINT),
        h('text', TEMPLATE_HINT),
        h('texts', TEMPLATE_HINT),
        h('shape', TEMPLATE_HINT),
        h('arrow', TEMPLATE_HINT),
        h('image', TEMPLATE_HINT),
        h('draw', TEMPLATE_HINT),
        h('cx', GROUP_GEOMETRY_HINT),
        h('cy', GROUP_GEOMETRY_HINT),
        h('width', GROUP_GEOMETRY_HINT),
        h('height', GROUP_GEOMETRY_HINT),
        h('angle', GROUP_GEOMETRY_HINT),
        h('z_order', "a group takes its first member's order; reorder it afterwards"),
      ],
    },
    { name: OP.ungroup, members: ['node'], hints: [] },
    {
      name: OP.setText,
      members: ['node', 'index', 'row', 'col', 'text'],
      hints: [h('texts', 'set_text changes one slot: index (or row and col) and text')],
    },
    { name: OP.setTitle, members: ['node', 'text', 'side', 'style'], hints: [] },
    { name: OP.setShape, members: ['node', 'shape'], hints: [] },
    { name: OP.setTemplateParams, members: ['node', 'params', 'template_params'], hints: [] },
    {
      name: OP.setStyle,
      members: ['node', 'edge', 'style'],
      hints: [
        h('draw', "a path's drawing is fixed by the add_node that creates it; set_style restyles the whole shape"),
      ],
    },
    {
      name: OP.setArrow,
      members: ['node', 'edge', 'start', 'end'],
      hints: [h('arrow', 'set_arrow takes start and end directly')],
    },
    {
      name: OP.setEdgeRoute,
      members: ['edge', 'auto_type', 'reach', 'route', 'edge_type', 'from_side', 'to_side', 'bend'],
      hints: [],
    },
    { name: OP.setEdgeTexts, members: ['edge', 'texts'], hints: [] },
    {
      name: OP.addPage,
      members: ['name', 'order', 'canvas_type', 'width', 'height', 'unit', 'canvas_name', 'background'],
      hints: [h('ref', NEW_PAGE_HINT), h('page', NEW_PAGE_HINT), h('color', 'write background: { color }')],
    },
    { name: OP.deletePage, members: ['page'], hints: [] },
    { name: OP.movePage, members: ['page', 'to_index'], hints: [h('order', 'move_page takes to_index')] },
    { name: OP.renamePage, members: ['page', 'name'], hints: [] },
    { name: OP.resizePage, members: ['page', 'canvas_type', 'width', 'height', 'unit', 'canvas_name'], hints: [] },
    { name: OP.clearPage, members: ['page'], hints: [] },
    { name: OP.setPageBackground, members: ['page', 'color', 'background'], hints: [] },
    {
      name: OP.setPageMargin,
      members: ['page', 'left_right', 'top_bottom', 'unit', 'remove'],
      hints: [h('width', MARGIN_NAMES, true), h('height', MARGIN_NAMES, true)],
    },
    { name: OP.setGrid, members: ['present', 'grid'], hints: [] },
    { name: OP.setScaling, members: ['scale', 'unit'], hints: [] },
  ];
  // The first eighteen rows are the object operations.
  for (let i = 0; i < 18; i++) rows[i]?.hints.push(h('page', OBJECT_PAGE_HINT));
  return Object.freeze(
    rows.map((r) => Object.freeze({ name: r.name, members: Object.freeze(r.members), hints: Object.freeze(r.hints) })),
  );
}

const OP_VOCABULARY: readonly OpRow[] = buildOpVocabulary();

/** C++ `opVocabulary()`: one row per operation, in `namespace op` order. */
export function opVocabulary(): readonly OpRow[] {
  return OP_VOCABULARY;
}

/** "a", "a and b", "a, b and c". */
export function spokenList(items: readonly string[]): string {
  let out = '';
  for (let i = 0; i < items.length; i++) {
    if (i > 0) out += i + 1 === items.length ? ' and ' : ', ';
    out += items[i] ?? '';
  }
  return out;
}

/** The row's vocabulary, as `refuseUnknownMembers` checks it. */
export function rowVocabulary(row: OpRow): MemberVocabulary {
  return {
    allowed: [...row.members, 'op'],
    refusal: (member: string): string => {
      for (const hint of row.hints) {
        if (hint.member === member) {
          return hint.whole ? hint.text : `${row.name} has no member "${member}"; ${hint.text}`;
        }
      }
      return `${row.name} has no member "${member}"; it takes ${spokenList(row.members)}`;
    },
  };
}

// The canvas names resize_page and add_page write when none is given.
export const CANVAS_NAME_CUSTOM = 'Custom';
export const CANVAS_NAME_AUTO = 'Auto';
export const CANVAS_NAME_INFINITE = 'Infinite';

export function defaultCanvasName(type: CanvasSizeType): string {
  if (type === CanvasSizeType.Auto) return CANVAS_NAME_AUTO;
  if (type === CanvasSizeType.Infinite) return CANVAS_NAME_INFINITE;
  return CANVAS_NAME_CUSTOM;
}

/** Sets the first and last orthogonal `step` of an automatic line route (mutates `params`). */
export function setEndSteps(params: Params, first: number, last: number): void {
  if (params.length === 0) return;
  (params[0] as Record<string, number>)['step'] = first;
  (params[params.length - 1] as Record<string, number>)['step'] = last;
}

/** The stored first and last `step`, when both maps carry one; else null. */
export function endSteps(params: Params): readonly [first: number, last: number] | null {
  if (params.length === 0) return null;
  const a = params[0]?.['step'];
  const b = params[params.length - 1]?.['step'];
  if (a === undefined || b === undefined) return null;
  return [a, b];
}

/** An edge label carries `text` and `position`; an unknown member is refused. */
export function labelMemberMessage(member: string): string {
  return (
    `"${member}" is not part of an edge label: a label carries ` +
    '`text` and `position`, the fraction along the route, 0 to 1, and ' +
    'the midpoint when it is omitted'
  );
}

/** The offending member (first in key order), if the entry carries one; else null. */
export function unknownLabelMember(entry: JsonValue | undefined): string | null {
  if (!isJsonObject(entry)) return null;
  for (const k of sortedKeys(entry)) {
    if (k !== KEY.text && k !== KEY.position) return k;
  }
  return null;
}

// ---------------------------------------------------------------- arrowheads

export const ARROWHEAD_IS = 'an arrowhead is a catalogue arrowhead name, an arrow template id, or null';

export function arrowheadMessage(value: string): string {
  return (
    `no arrowhead "${value}": name one of the 26 catalogue ` +
    'arrowheads, which the stencils guide lists and stencil_get resolves ' +
    '(stencil_search does not index arrowheads), or give an arrow template id'
  );
}

// ---------------------------------------------------------------- images

export const RES_PREFIX = 'res://';
export const IMAGE_TEMPLATE_ID = 'avabodh.basic.image';

/** Does this template declare an image slot the LOADER WILL KEEP (one with a `location`)? */
export function declaresImageSlot(stl: ShapeTemplate): boolean {
  const first = stl.imageData[0];
  return first !== undefined && first.location !== '';
}

// ---------------------------------------------------------------- groups

/** The group a member sits DIRECTLY inside, searched from one top-level group down; else null. */
export function enclosingGroup(group: GroupObject, objId: string): GroupObject | null {
  for (const contained of group.objects()) {
    const o = contained.object as LekhObject | null;
    if (o === null) continue;
    if (o.id === objId) return group;
    if (o instanceof GroupObject) {
      const found = enclosingGroup(o, objId);
      if (found !== null) return found;
    }
  }
  return null;
}

/** The same, over a whole page. Null when `objId` is top-level or absent. */
export function owningGroup(objects: readonly LekhObject[], objId: string): GroupObject | null {
  for (const obj of objects) {
    if (!(obj instanceof GroupObject)) continue;
    const found = enclosingGroup(obj, objId);
    if (found !== null) return found;
  }
  return null;
}

export function groupEndpointMessage(named: string): string {
  return `an edge attaches to a shape, not to a group; "${named}" is a group — name one of its members`;
}

/** The refusal for an endpoint that resolves to `obj`, or '' when it may be one. */
export function endpointKindRefusal(obj: LekhObject | null, named: string): string {
  if (obj === null) return '';
  if (obj instanceof GroupObject) return groupEndpointMessage(named);
  if (obj instanceof UnrecognizedObject) return `an edge cannot attach to a free-hand stroke; "${named}" is one`;
  return '';
}

// ---------------------------------------------------------------- self-loops

/** C++ `ConnectionObject::Side`. */
export type LoopSide = Side;
export const LOOP_SIDE_WORDS = 'top, right, bottom, left';

export function loopSideFromName(name: string): LoopSide | null {
  if (name === 'top') return Side.Top;
  if (name === 'right') return Side.Right;
  if (name === 'bottom') return Side.Bottom;
  if (name === 'left') return Side.Left;
  return null;
}

export function loopSideName(side: LoopSide): string {
  switch (side) {
    case Side.Top:
      return 'top';
    case Side.Right:
      return 'right';
    case Side.Bottom:
      return 'bottom';
    case Side.Left:
      return 'left';
  }
  return 'right';
}

export function loopSideIsHorizontal(side: LoopSide): boolean {
  return side === Side.Left || side === Side.Right;
}

/** What an op says about a loop's sides; an absent side is filled in by the caller. */
export class LoopSides {
  hasFrom = false;
  hasTo = false;
  hasBend = false;
  from: LoopSide = Side.Right;
  to: LoopSide = Side.Top;
  bend: LoopSide = Side.Top;

  any(): boolean {
    return this.hasFrom || this.hasTo || this.hasBend;
  }
}

/** Reads `from_side`, `to_side` and `bend` into `out`: '' or the refusal. A null member is an absent one. */
export function readLoopSides(opNode: JsonValue | undefined, out: LoopSides): string {
  const slots = [
    [KEY.fromSide, 'from'],
    [KEY.toSide, 'to'],
    [KEY.bend, 'bend'],
  ] as const;
  for (const [key, field] of slots) {
    const member = isJsonObject(opNode) && Object.prototype.hasOwnProperty.call(opNode, key) ? opNode[key] : undefined;
    if (member === undefined || member === null) continue;
    const side = typeof member === 'string' ? loopSideFromName(member) : null;
    if (side === null) return '`' + key + '` must be one of ' + LOOP_SIDE_WORDS;
    out[field] = side;
    if (field === 'from') out.hasFrom = true;
    else if (field === 'to') out.hasTo = true;
    else out.hasBend = true;
  }
  return '';
}

export function loopSidesOnTwoNodesMessage(from: string, to: string): string {
  return (
    '`from_side`, `to_side` and `bend` apply only to a self-loop; "' + from + '" and "' + to + '" are different nodes'
  );
}

export function loopEdgeTypeMessage(named: string, typeWord: string): string {
  return (
    `a self-loop is drawn as a curve or an orthogonal edge; "${named}" is both its from ` +
    'and its to — edge_type `' +
    typeWord +
    '` is not supported'
  );
}

export const LOOP_REACH_MESSAGE =
  'reach on a self-loop is the run-out of an orthogonal loop drawn from its sides, ' +
  'as a number of points greater than 0';

function stringMember(node: JsonValue | undefined, name: string): string | undefined {
  if (!isJsonObject(node)) return undefined;
  const v = node[name];
  return typeof v === 'string' ? v : undefined;
}

/** The rules of spec/mcp-self-loop.md §2.2 that need no object: '' or the refusal. */
export function loopRuleRefusal(
  opNode: JsonValue | undefined,
  sides: LoopSides,
  named: string,
  hasRoute: boolean,
): string {
  const edgeName = stringMember(opNode, KEY.edgeType);
  if (edgeName !== undefined && edgeName !== '') {
    const type = edgeTypeFromName(edgeName);
    if (type !== null && !allowsSelfLoop(type)) return loopEdgeTypeMessage(named, edgeName);
  }
  const autoName = stringMember(opNode, KEY.autoType);
  if (autoName !== undefined && autoName !== '') {
    const autoType = autoTypeFromName(autoName);
    if (autoType !== null && autoType !== AutoType.NoAuto) {
      return (
        'a self-loop has no automatic route; give `from_side`/`to_side` or a `route`, ' +
        'not `auto_type` "' +
        autoName +
        '"'
      );
    }
  }
  if (sides.any() && hasRoute) return 'give `from_side`/`to_side` or a `route` for a self-loop, not both';
  if (sides.hasBend) {
    if (relationOf(sides.from, sides.to) !== SideRelation.Opposite) {
      return '`bend` applies only to a self-loop between opposite sides';
    }
    if (loopSideIsHorizontal(sides.bend) === loopSideIsHorizontal(sides.from)) {
      const across = loopSideIsHorizontal(sides.from);
      return (
        `a loop between "${loopSideName(sides.from)}" and "${loopSideName(sides.to)}" bends \`` +
        (across ? 'top' : 'left') +
        '` or `' +
        (across ? 'bottom' : 'right') +
        '`'
      );
    }
  }
  return '';
}

/** The app never makes an open line, open path or Bezier curve a connection endpoint. */
export function isOpenLineNode(obj: LekhObject): boolean {
  if (!(obj instanceof TemplatedObject) || obj instanceof GroupObject) return false;
  const stl = obj.shapeTemplate();
  if (stl instanceof PathTemplate) return !stl.closedPath();
  if (stl instanceof PolygonTemplate) return !stl.isClosed();
  return stl instanceof BezierCurveTemplate;
}

/**
 * A copy of `obj` whose outline exists (C++: the copy drawn on a NoOpPlatform; here laid out).
 * The board's object is never touched.
 */
export function settledCopy(obj: LekhObject, config: Config): LekhObject {
  const copy = obj.clone();
  if (copy === null) return obj;
  const env: LayoutEnv = {
    config,
    ensureLayout: (o: LekhObject) => {
      if (o.needsLayout()) o.layout(env);
    },
    objectById: () => undefined,
  };
  copy.layout(env);
  return copy;
}

/** `%g` of a number. */
export function wholeNumberText(value: number): string {
  return formatG6(value);
}

/** How many levels this group spans: 1 for a group of plain shapes, one more per nesting level. */
export function groupHeight(group: GroupObject): number {
  let deepest = 0;
  for (const contained of group.objects()) {
    const inner = contained.object as LekhObject;
    if (!(inner instanceof GroupObject)) continue;
    const below = groupHeight(inner);
    if (below > deepest) deepest = below;
  }
  return deepest + 1;
}

/** What an object IS, for a refusal that has to say so. */
export function whatItIs(obj: LekhObject): string {
  if (obj instanceof ConnectionObject) return 'an edge';
  if (obj instanceof GroupObject) return 'a group';
  if (obj instanceof TemplatedObject && obj.shapeTemplate() !== null) return 'a shape';
  return `a legacy ${obj.name()} object, which answers no template`;
}

// ---------------------------------------------------------------- the title

/** The stored index of the title entry of a serialized template's `texts`, or −1. */
export function titleSlotOf(texts: JsonValue | undefined): number {
  if (!Array.isArray(texts)) return -1;
  const list = texts as readonly JsonValue[];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const side = isJsonObject(entry) ? entry[STORED.external] : undefined;
    if (typeof side === 'string' && textSideFromName(side) !== TextSide.None) return i;
  }
  return -1;
}

/** The stored indices of a serialized template's body slots, by projected index. */
export function bodySlots(texts: JsonValue | undefined): number[] {
  const out: number[] = [];
  if (!Array.isArray(texts)) return out;
  const title = titleSlotOf(texts);
  for (let i = 0; i < (texts as readonly JsonValue[]).length; i++) if (i !== title) out.push(i);
  return out;
}

/** The same, for a loaded template's `textData`. */
export function bodySlotsOf(stl: ShapeTemplate): number[] {
  const out: number[] = [];
  const title = stl.titleIndex();
  for (let i = 0; i < stl.textData.length; i++) if (i !== title) out.push(i);
  return out;
}

/** "<where>.side is one of …", set_title's and add_node.title's. */
export function titleSideMessage(where: string): string {
  return `${where}.side is one of "top", "bottom", "left", "right"`;
}

// ---------------------------------------------------------------- frames

/** The frame order of /backend/subsystems/mcp/semantic-format.md §5.2: the order of this table. */
export const FrameKind = Object.freeze({
  AddPages: 0,
  AddObjects: 1,
  ConvertObjects: 2,
  ChangeAttr: 3,
  ChangeTemplateParams: 4,
  ChangeStyle: 5,
  ChangeArrow: 6,
  ChangeConnectionParams: 7,
  ChangeConnectionTexts: 8,
  ChangeBackground: 9,
  ChangePageAttr: 10,
  ChangeGrid: 11,
  ChangeScaling: 12,
  DelObjects: 13,
  DelPages: 14,
} as const);
export type FrameKind = (typeof FrameKind)[keyof typeof FrameKind];
export const FRAME_COUNT = 15;

export function frameType(kind: FrameKind): string {
  switch (kind) {
    case FrameKind.AddPages:
      return updatetypes.addPages;
    case FrameKind.AddObjects:
      return updatetypes.addObjects;
    case FrameKind.ConvertObjects:
      return updatetypes.convertObjects;
    case FrameKind.ChangeAttr:
      return updatetypes.changeAttr;
    case FrameKind.ChangeTemplateParams:
      return updatetypes.changeTemplateParams;
    case FrameKind.ChangeStyle:
      return updatetypes.changeStyle;
    case FrameKind.ChangeArrow:
      return updatetypes.changeArrow;
    case FrameKind.ChangeConnectionParams:
      return updatetypes.changeConnectionParams;
    case FrameKind.ChangeConnectionTexts:
      return updatetypes.changeConnectionTexts;
    case FrameKind.ChangeBackground:
      return updatetypes.changeBackground;
    case FrameKind.ChangePageAttr:
      return updatetypes.changePageAttr;
    case FrameKind.ChangeGrid:
      return updatetypes.changeGrid;
    case FrameKind.ChangeScaling:
      return updatetypes.changeScaling;
    case FrameKind.DelObjects:
      return updatetypes.delObjects;
    default:
      return updatetypes.delPages;
  }
}

/** One frame under construction: C++ `std::map`s, so iterate with `sortedKeys` where order shows. */
export interface Frame {
  readonly changes: Map<string, JsonValue>;
  readonly conditions: Map<string, JsonValue>;
}

export function newFrame(): Frame {
  return { changes: new Map(), conditions: new Map() };
}

// ---------------------------------------------------------------- small helpers

/** C++ `numberOf(node, &out)`: the node's number, or null. */
export function numberOf(node: JsonValue | undefined): number | null {
  return typeof node === 'number' ? node : null;
}

/** A number as a message writes it: `%g`, six significant digits ("-3", "0.5", "1000"). */
export function numberWord(n: number): string {
  return formatG6(n);
}

/** A position in a list of `max + 1` slots: an integral number from 0 to `max`; else null. */
export function positionOf(node: JsonValue | undefined, max: number): number | null {
  if (typeof node !== 'number') return null;
  if (!(node >= 0 && node <= max) || node !== Math.trunc(node)) return null;
  return node;
}

/** `addField` after `removeField`: a patch that replaces. */
export function setField(node: JsonOut, name: string, value: JsonValue): void {
  node[name] = value;
}

export function setStringField(node: JsonOut, name: string, value: string): void {
  node[name] = value;
}

/** `{"$exists": val}` — a Mongo filter fragment, which a `conditions` entry becomes. */
export function existsNode(val: boolean): JsonOut {
  return { [K_EXISTS]: val };
}

/** The document-level `templates` map key: dots replaced with underscores. */
export function templateKey(templateId: string): string {
  return templateId.replaceAll('.', '_');
}

// ---------------------------------------------------------------- paths (write side)

export const POLYGON_ID = 'avabodh.basic.polygon';
export const CURVE_ID = 'avabodh.basic.curve';
export const NATIVE_PATH_ID = 'avabodh.basic.path';

export const PATH_NEEDS_SIZE =
  'a lekh.semantic.path needs width and height: a drawing in w and h has no size of its own';
export const PATH_NEEDS_DRAW = 'a lekh.semantic.path needs a draw array with at least one entry';
export const DRAW_ONLY_ON_PATH = 'draw is only accepted with shape "lekh.semantic.path"';
export const EXPRESSION_VOCABULARY = '; the names are w and h, and the functions min, max, sin, cos, tan';

export interface PathPlan {
  /** Every argument, in order across the entries. */
  data: string[];
  /** Per entry: command letters and data indices. */
  draws: string[];
  nativeId: string;
  flags: number;
}

export function entryAt(i: number): string {
  return `draw[${String(i)}]`;
}

export function tokenAt(i: number, j: number): string {
  return `${entryAt(i)} token ${String(j)}`;
}

/** A JSON value's type with its article, for a message. */
export function aJsonType(node: JsonValue | undefined): string {
  if (node === undefined || node === null) return 'a null';
  if (Array.isArray(node)) return 'an array';
  switch (typeof node) {
    case 'number':
      return 'a number';
    case 'string':
      return 'a string';
    case 'boolean':
      return 'a boolean';
  }
  return 'an object';
}

function cppEscape(s: string): string {
  let out = '';
  for (const c of s) {
    switch (c) {
      case '\\':
        out += '\\\\';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      case '"':
        out += '\\"';
        break;
      default:
        out += c;
    }
  }
  return out;
}

/** C++ `JsonParser::store`: keys in `std::map` order, floats `%g`. */
export function storeJson(node: JsonValue | undefined): string {
  if (node === undefined || node === null) return 'null';
  if (Array.isArray(node)) return '[' + (node as readonly JsonValue[]).map(storeJson).join(',') + ']';
  switch (typeof node) {
    case 'number':
      return Number.isInteger(node) ? String(node) : formatG6(Math.fround(node));
    case 'string':
      return '"' + cppEscape(node) + '"';
    case 'boolean':
      return node ? 'true' : 'false';
  }
  const o = node as JsonObject;
  return (
    '{' +
    sortedKeys(o)
      .map((k) => `"${k}":${storeJson(o[k])}`)
      .join(',') +
    '}'
  );
}

/** A JSON value as the agent wrote it, for a message. */
export function jsonText(node: JsonValue | undefined): string {
  if (node === undefined || node === null) return 'null';
  if (typeof node === 'string') return `"${node}"`;
  return storeJson(node);
}

/** An edge label's position: absent = 0.5; else a number from 0 to 1, or the refusal. */
export function labelPosition(entry: JsonValue | undefined): Checked<number> {
  const position =
    isJsonObject(entry) && Object.prototype.hasOwnProperty.call(entry, KEY.position) ? entry[KEY.position] : undefined;
  if (position === undefined) return { ok: true, value: 0.5 };
  const value = numberOf(position);
  if (value !== null && value >= 0 && value <= 1) return { ok: true, value };
  return { ok: false, message: 'label position is a fraction from 0 to 1; got ' + jsonText(position) };
}

/** One of the four commands — upper case, exactly. */
export function isPathCommand(token: JsonValue | undefined): boolean {
  return typeof token === 'string' && token.length === 1 && pathCommandArity(token) >= 0;
}

const isAlpha = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

/** V2–V10 of /spec/write-path.md, then the classification: the plan, or the first refusal. */
export function planPathDraw(draw: JsonValue | undefined): Checked<PathPlan> {
  if (!Array.isArray(draw) || draw.length === 0) return { ok: false, message: PATH_NEEDS_DRAW };
  const entries = draw as readonly JsonValue[];

  interface Command {
    letter: string;
    token: number;
  }
  const commands: Command[][] = entries.map(() => []);
  const tokenLists: (readonly JsonValue[])[] = [];
  const shapeMessage = (i: number): string =>
    entryAt(i) + ': an entry must be an object with `path`, an array of command letters and argument strings';

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isJsonObject(entry)) return { ok: false, message: shapeMessage(i) };
    for (const m of sortedKeys(entry)) {
      if (m !== KEY.path && m !== KEY.style) {
        return {
          ok: false,
          message: `${entryAt(i)}: unexpected member "${m}"; an entry holds \`path\` and \`style\` only`,
        };
      }
    }
    const path = Object.prototype.hasOwnProperty.call(entry, KEY.path) ? entry[KEY.path] : undefined;
    if (!Array.isArray(path)) return { ok: false, message: shapeMessage(i) };
    const tokens = path as readonly JsonValue[];
    tokenLists[i] = tokens;

    const oneSubPath =
      entryAt(i) +
      ': an entry is one sub-path — it starts with M and has no other M; put another sub-path in another entry';
    if (tokens.length === 0 || tokens[0] !== 'M') return { ok: false, message: oneSubPath };

    let drawsSomething = false;
    let j = 0;
    while (j < tokens.length) {
      const token = tokens[j];
      if (typeof token !== 'string') {
        return { ok: false, message: `${tokenAt(i, j)}: expected a command (M, L, C or Z), got ${jsonText(token)}` };
      }
      const word = token;
      const arity = word.length === 1 ? pathCommandArity(word) : -1;
      if (arity < 0) {
        const letter = word.length === 1 && isAlpha(word);
        let message: string;
        if (letter && pathCommandArity(word.toUpperCase()) >= 0) {
          message = `${tokenAt(i, j)}: "${word}" — only absolute commands M, L, C and Z are accepted; relative forms are not`;
        } else if (letter) {
          message = `${tokenAt(i, j)}: "${word}" is not a path command; the commands are M, L, C and Z`;
        } else {
          message = `${tokenAt(i, j)}: expected a command (M, L, C or Z), got "${word}"`;
        }
        return { ok: false, message };
      }
      if (word === 'M' && j > 0) return { ok: false, message: oneSubPath };
      if (word === 'Z' && j + 1 !== tokens.length) {
        return { ok: false, message: `${entryAt(i)}: Z closes the entry and must be last` };
      }
      let got = 0;
      while (got < arity && j + 1 + got < tokens.length && !isPathCommand(tokens[j + 1 + got])) got++;
      if (got < arity) {
        return { ok: false, message: `${tokenAt(i, j)}: ${word} takes ${String(arity)} arguments, got ${String(got)}` };
      }
      for (let k = 1; k <= arity; k++) {
        if (typeof tokens[j + k] !== 'string') {
          return {
            ok: false,
            message: `${tokenAt(i, j + k)}: an argument is a string — write a number as "12", an expression as "0.5*w"`,
          };
        }
      }
      if (word === 'L' || word === 'C') drawsSomething = true;
      (commands[i] as Command[]).push({ letter: word, token: j });
      j += 1 + arity;
    }
    if (!drawsSomething) return { ok: false, message: `${entryAt(i)}: an entry needs at least one L or C after M` };
  }

  // V10: each argument under the whitelist.
  for (let i = 0; i < entries.length; i++) {
    const tokens = tokenLists[i] as readonly JsonValue[];
    for (const c of commands[i] as Command[]) {
      for (let k = 1; k <= pathCommandArity(c.letter); k++) {
        const text = tokens[c.token + k] as string;
        const check = validateSemanticExpression(text);
        if (!check.ok) {
          return {
            ok: false,
            message: `${tokenAt(i, c.token + k)}: "${text}" — ${check.reason}${check.offending === '' ? '' : EXPRESSION_VOCABULARY}`,
          };
        }
      }
    }
  }

  // Classification (/spec/write-path.md §4).
  let curve = false;
  let polygon = false;
  let closed = false;
  if (entries.length === 1) {
    const only = commands[0] as Command[];
    curve = only.length === 2 && only[1]?.letter === 'C';
    polygon = true;
    for (let c = 1; c < only.length; c++) {
      const last = c + 1 === only.length;
      const l = only[c]?.letter;
      if (l !== 'L' && !(last && l === 'Z')) polygon = false;
    }
  }
  for (const entry of commands) if (entry[entry.length - 1]?.letter === 'Z') closed = true;

  const plan: PathPlan = { data: [], draws: [], nativeId: '', flags: 0 };
  for (let i = 0; i < entries.length; i++) {
    const tokens = tokenLists[i] as readonly JsonValue[];
    let cmds = '';
    const mIndex = plan.data.length;
    for (const c of commands[i] as Command[]) {
      if (cmds !== '') cmds += ' ';
      if (c.letter === 'Z' && polygon) {
        // A closed polygon returns with `L` to the `M`'s own indices and sets the closed flag.
        cmds += `L ${String(mIndex)} ${String(mIndex + 1)}`;
        continue;
      }
      cmds += c.letter;
      for (let k = 1; k <= pathCommandArity(c.letter); k++) {
        cmds += ' ' + String(plan.data.length);
        plan.data.push(tokens[c.token + k] as string);
      }
    }
    plan.draws.push(cmds);
  }

  const primitives =
    TemplateFlags.PrimitiveForDist | TemplateFlags.PrimitiveForIntersect | TemplateFlags.PrimitiveForInside;
  if (curve) {
    plan.nativeId = CURVE_ID;
    plan.flags = primitives;
  } else if (polygon) {
    plan.nativeId = POLYGON_ID;
    plan.flags = TemplateFlags.TextCentroid | (closed ? TemplateFlags.Closed : 0);
  } else {
    plan.nativeId = NATIVE_PATH_ID;
    plan.flags = primitives | (closed ? TemplateFlags.Closed : 0);
  }
  return { ok: true, value: plan };
}

/** "Closed" on a path: `closedPath()` or the stored `FLAG_CLOSED`. */
export function pathIsClosed(stl: ShapeTemplate): boolean {
  if (stl instanceof PathTemplate && stl.closedPath()) return true;
  return (stl.getFlags() & TemplateFlags.Closed) !== 0;
}

/** Where an arrowhead is drawn: an open polygon, a curve, a single-entry open path. */
export function drawsArrowheads(stl: ShapeTemplate | null): boolean {
  if (stl === null) return false;
  if (stl instanceof PolygonTemplate) return !stl.isClosed();
  if (stl instanceof BezierCurveTemplate) return true;
  if (stl instanceof PathTemplate) return stl.pathData.length === 1 && !pathIsClosed(stl);
  return false;
}

/** The refusal for a non-null arrowhead on `stl`, quoting the caller's spelling. */
export function arrowheadRefusal(stl: ShapeTemplate | null, named: string): string {
  const tail = 'an arrowhead is drawn only on an edge, a line, a curve or an open path; send null to clear one';
  if (stl instanceof PathTemplate) {
    if (stl.pathData.length > 1) {
      return `"${named}" is a drawing with more than one draw entry, and draws no arrowheads; ${tail}`;
    }
    return `"${named}" is a closed path, and ${tail}`;
  }
  return `"${named}" is a closed shape (${stl !== null ? stl.id() : 'no template'}), and ${tail}`;
}

/** B.17: which row of the per-kind style table an object answers to. */
export function styleTargetFor(obj: LekhObject, stl: ShapeTemplate | null): StyleTarget {
  if (obj instanceof ConnectionObject) return StyleTarget.Edge;
  if (obj instanceof GroupObject || stl === null) return StyleTarget.Other;
  if (stl.id() === IMAGE_TEMPLATE_ID) return StyleTarget.Image;
  if (stl.id() === 'avabodh.basic.text') return StyleTarget.FloatingLabel;
  if (stl.generator === null && stl.texts().length === 0) return StyleTarget.Slotless;
  return StyleTarget.Other;
}

export function inertStyleMessage(named: string, key: string, reason: string): string {
  return `"${named}" does not draw ${key}: ${reason}; leave ${key} out`;
}

/** The text keys an edge stores for a label it does not have yet. */
export function latentEdgeKey(semanticKey: string): boolean {
  return semanticKey === 'text_color' || semanticKey === 'text_decoration' || semanticKey.startsWith('font_');
}

/** Whether an edge draws a label: one with text. */
export function hasLabel(labels: readonly ConnectorTextInfo[]): boolean {
  for (const label of labels) if (label.text !== '') return true;
  return false;
}

/** The caller's spelling of the object an operation addresses: its `node`, or its `edge`. */
export function spelledOf(opNode: JsonValue | undefined): string {
  const n = stringMember(opNode, K_NODE);
  if (n !== undefined && n !== '') return n;
  return stringMember(opNode, K_EDGE) ?? '';
}

/** The caller's spelling of the object an `add_node` makes: its `ref`, or the shape id. */
export function addNamed(opNode: JsonValue | undefined): string {
  const r = stringMember(opNode, K_REF);
  if (r !== undefined && r !== '') return r;
  return stringMember(opNode, KEY.shape) ?? '';
}

/** Whether an `arrow` / `set_arrow` names an arrowhead at either end (a `null` end does not). */
export function namesAnArrowhead(holder: JsonValue | undefined): boolean {
  if (!isJsonObject(holder)) return false;
  for (const end of [KEY.start, KEY.end]) {
    const member = Object.prototype.hasOwnProperty.call(holder, end) ? holder[end] : undefined;
    if (member !== undefined && member !== null) return true;
  }
  return false;
}

/** Re-exported for the compilation files. */
export { ConnectionType };

/** C++ `refuseUnknownMembers`: the refusal for the first member (in key order) not allowed, or ''. */
export function refuseUnknownMembers(
  node: JsonValue | undefined,
  vocabulary: MemberVocabulary,
  location: string,
): string {
  if (!isJsonObject(node)) return '';
  for (const k of sortedKeys(node)) {
    if (!vocabulary.allowed.includes(k)) return vocabulary.refusal(k, location);
  }
  return '';
}

/**
 * C++ `slotClearedTextKeys`: exactly the text keys this surface writes whose `GroupStyle::set…`
 * in master mode removes the value from every child profile.
 */
const SLOT_CLEARED_TEXT_KEYS: readonly string[] = Object.freeze([
  'textalignhorizontal',
  'textalignvertical',
  'textfill',
  'fontsize',
  'fontmultiplier',
  'fontweight',
  'fontstyle',
  'fontfamily',
  'fontmodifier',
  'textdecoration',
]);

export function slotClearedTextKeys(): readonly string[] {
  return SLOT_CLEARED_TEXT_KEYS;
}
