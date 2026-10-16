// One compilation in progress: the C++ `class Compilation` of `semantic/SemanticDelta.cpp`
// (declaration lines 1333-1763), split over three files so three porters can work at once:
//
//   compilation-base.ts  CompilationBase: every field, the CORE methods (C++ lines 1764-3194 and
//                        the "shared bits" 7778-8312), and every other method as `abstract`.
//   ops-nodes.ts         NodeOps extends CompilationBase: C++ 3195-4937 (add_node … reorder) plus
//                        the route helpers of 6473-6895 (endpointAngle, routeToParams, readReach,
//                        emitEdgeRoute, refuseUnknownMembers).
//   ops-edits.ts         EditOps extends NodeOps: the rest of 4938-7777 (set_text … set_scaling).
//   compilation.ts       Compilation extends EditOps: the concrete class `compileToNode` runs.
//
// TYPE MAPPING (every file of semantic/delta/ follows it; see also helpers.ts):
//   JsonNode* (read)       → JsonValue | undefined   (absent = undefined, JSON null = null)
//   JsonNode* (built)      → JsonOut (mutable; C++ `setField` = plain assignment)
//   LekhObject::Ptr        → LekhObject | null; TemplatedObject / ConnectionObject / GroupObject likewise
//                            (NB: GroupObject and UnrecognizedObject extend TemplatedObject here, as
//                            in C++, so test `instanceof GroupObject` before `TemplatedObject`)
//   ShapeTemplate*         → ShapeTemplate | null (GC: no delete)
//   DrawingProfile* / Style* → Style (a GroupStyle for a template's master style)
//   IArrowObject*          → ArrowHeads (`obj.arrows`) | null
//   DataStore*             → DataStore
//   Params / ConnectionObject::Type / AutoType → Params / ConnectionType / AutoType (model)
//   size_t at              → number
//   `bool f(…, T* out)`    → returns T | null (null = false, a failAt already recorded)
//   std::map / std::set    → Map / Set; where the C++ iteration order shows, sort the keys.
//   JsonObjectSerializer ser_:
//     serializeObject(o)          → ctx.codec.writeObject(o)
//     parseObject(id, &o, node)   → ctx.codec.readObject(node, id, doc).object (throws LoadError)
//     serializeShapeTemplate(t)   → ctx.codec.templates.serialize(t)
//     parseShapeTemplate(n, &t)   → ctx.codec.templates.parse(n) (NOT loaded; call load())
//     serializeStyle(s[, d])      → serializeStyle(s, d) (io)
//     parseStyle(s, n, reset)     → parseStyle(s, n, reset) (io)
//     serializeTemplateParams(t)  → serializeTemplateParams(t.params) (io)
//     serializePage(p)            → new JsonDocumentWriter(ctx.codec.templates, { stamp: 'cloud' }).page(p)
//   TemplateStore::instance().getTemplate(id) → def = ctx.catalog.get(id); ctx.catalog.instantiate(def) (loaded)
//   TemplateStore::instance().getArrow(id)    → def = ctx.arrows.arrowhead(id); ctx.catalog.instantiate(def)
//   LekhDocument::getTemplate(id)             → this.docTemplate(id) (below)
//   Platform::newId                           → ctx.newId()
//   Config::instance()                        → ctx.config
//   arrowIdFor(name) / arrowNameFor(id)       → arrowIdFor(ctx.arrows, name) / arrowNameFor(ctx.arrows, id)
// Numbers in frames are stored values and are never rounded; numbers of the answer outside the
// frames that the C++ wrote as FLOAT (auto_placed cx/cy) go through `g6()`.
// The compiler never mutates the document: objects for an add are built detached.
import type { Config } from '../../base';
import { JsonDocumentWriter, LoadContext, parseStyle, serializeStyle, type DocumentCodec } from '../../io';
import {
  ConnectionObject,
  GroupObject,
  TemplatedObject,
  CanvasSizeType,
  type ArrowHeads,
  type AutoType,
  type ConnectionType,
  type LekhDocument,
  type LekhObject,
  type Page,
  type Params,
} from '../../model';
import { GroupStyle, GroupStyleMode, Style, Unit } from '../../style';
import {
  ParamEditorType,
  TextSide,
  textSideFromName,
  type DataStore,
  type ShapeTemplate,
  type TemplateParam,
} from '../../template';
import { consts } from '../../sync';
import type { JsonInput, SemanticContext } from '../context';
import { KEY, StyleTarget, arrowIdFor, inertStyleReason, storedStyleKey, styleKeyMessage } from '../format';
import { g6, isJsonObject, sortedKeys, type JsonObject, type JsonOut, type JsonValue } from '../json';
import type { PlacementBox } from '../placement';
import {
  ARROWHEAD_IS,
  FRAME_COUNT,
  FrameKind,
  INVALID_OPERATION,
  IMAGE_TEMPLATE_ID,
  K_CONFLICT_POLICY,
  K_EDGE,
  K_FORCE,
  K_NODE,
  K_OP,
  K_OPS,
  K_PAGE,
  K_REF,
  K_TEMPLATES,
  LoopSides,
  OBJECT_NOT_FOUND,
  OP,
  PAGE_NOT_FOUND,
  RES_PREFIX,
  UNKNOWN_STENCIL,
  VERSION_REQUIRED,
  aJsonType,
  arrowheadMessage,
  bodySlotsOf,
  declaresImageSlot,
  endpointKindRefusal,
  existsNode,
  frameType,
  groupEndpointMessage,
  inertStyleMessage,
  loopRuleRefusal,
  loopSidesOnTwoNodesMessage,
  newFrame,
  numberOf,
  numberWord,
  opVocabulary,
  owningGroup,
  readLoopSides,
  rowVocabulary,
  titleSideMessage,
  whatItIs,
  type Frame,
  type MemberVocabulary,
  type OpRow,
  type PathPlan,
} from './helpers';

/** C++ `ConflictPolicy` (SemanticDelta.h). */
export const ConflictPolicy = Object.freeze({ PerObject: 0, Strict: 1, Force: 2 } as const);
export type ConflictPolicy = (typeof ConflictPolicy)[keyof typeof ConflictPolicy];

/** The per-object working state: template, drawing profile, geometry (C++ `Working`). */
export interface Working {
  tnode: JsonOut | null;
  style: Style | null;
  installed: ShapeTemplate | null;
  hasGeometry: boolean;
  cx: number;
  cy: number;
  width: number;
  height: number;
  angle: number;
}

/** C++ `PageSizeArgs`. */
export class PageSizeArgs {
  hasWidth = false;
  hasHeight = false;
  hasUnit = false;
  hasType = false;
  hasName = false;
  width = 0;
  height = 0;
  unit: Unit = Unit.Point;
  type: CanvasSizeType = CanvasSizeType.Infinite;
  name = '';

  anySize(): boolean {
    return this.hasWidth || this.hasHeight || this.hasUnit;
  }
}

/** C++ `AutoPlaced`. */
export interface AutoPlaced {
  readonly id: string;
  readonly ref: string;
  readonly cx: number;
  readonly cy: number;
}

/** What `resolveTemplate` found: the loaded template, and the default size a catalogue entry wrapping it gave. */
export interface ResolvedTemplate {
  readonly stl: ShapeTemplate;
  readonly defaultWidth: number | null;
  readonly defaultHeight: number | null;
}

/** `resolveAddSize`'s answer. */
export interface AddSize {
  readonly stl: ShapeTemplate;
  readonly width: number;
  readonly height: number;
  readonly angle: number;
}

/** `selfLoopParams`'s answer. */
export interface LoopParams {
  readonly type: ConnectionType;
  readonly params: Params;
}

export { LoopSides };

export abstract class CompilationBase {
  readonly ctx: SemanticContext;
  readonly doc: LekhDocument;
  readonly batchInput: JsonInput;
  batch: JsonObject | null = null;
  // `page_` — non-null once parseEnvelope succeeded.
  page!: Page;
  pageId = '';
  version = 0;
  hasVersion = false;
  policy: ConflictPolicy = ConflictPolicy.PerObject;

  /** The batch's `templates` map, as given. */
  readonly suppliedTemplates = new Map<string, JsonObject>();
  readonly frames: Frame[] = Array.from({ length: FRAME_COUNT }, () => newFrame());
  /** ref → new uuid. */
  readonly refs = new Map<string, string>();
  /** Every object uuid minted, in op order. */
  readonly addedIds: string[] = [];
  /** How many adds have been compiled. */
  addCursor = 0;
  /** Page ids minted, in op order. */
  readonly addedPageIds: string[] = [];
  /** The pages add_page built, by id. */
  readonly addedPages = new Map<string, Page>();
  pageOrderBuilt = false;
  pageOrder: string[] = [];
  readonly pageKeys = new Map<string, number>();
  readonly storedPageKeys = new Map<string, number>();
  readonly pageKeysWritten = new Set<string>();
  /** What exists once the batch lands. */
  readonly endOfBatchIds = new Set<string>();
  readonly deletedIds = new Set<string>();
  /** C++ `std::set`: reported in sorted order. */
  readonly reportedDeletedEdges = new Set<string>();
  readonly convertConsumed = new Map<string, number>();
  readonly convertProduced = new Map<string, number>();
  readonly addedGroupIds: string[] = [];
  groupCursor = 0;
  readonly mintedAt = new Map<string, number>();
  readonly notes: string[] = [];
  /** objId → [index into notes, keys]. */
  readonly latentNotes = new Map<string, [number, string[]]>();
  readonly edgeLabelled = new Map<string, boolean>();
  /** member id → op index. */
  readonly consumedByGroup = new Map<string, number>();
  /** member id → [op index, group id]. */
  readonly freedByUngroup = new Map<string, [number, string]>();
  /** group id → op index. */
  readonly ungroupedAt = new Map<string, number>();
  readonly newObjects = new Map<string, LekhObject>();
  readonly emittedTemplateIds = new Set<string>();
  taken: PlacementBox[] = [];
  takenBuilt = false;
  hasPrev = false;
  prevCx = 0;
  prevCy = 0;
  prevHalfH = 0;
  readonly autoPlaced: AutoPlaced[] = [];
  failed = false;
  errorCode = '';
  errorMessage = '';
  hasErrorOp = false;
  errorOp = 0;
  readonly working = new Map<string, Working>();

  constructor(ctx: SemanticContext, batch: JsonInput) {
    this.ctx = ctx;
    this.doc = ctx.doc;
    this.batchInput = batch;
  }

  get codec(): DocumentCodec {
    return this.ctx.codec;
  }

  get config(): Config {
    return this.ctx.config;
  }

  /** The page the batch acts on (C++ `page_`), with its store. */
  pageObjects(): readonly LekhObject[] {
    return this.page.objectStore.objects;
  }

  /** C++ `LekhDocument::getTemplate`: a loaded copy of the document's own template, or null. */
  docTemplate(templateId: string): ShapeTemplate | null {
    const def = this.doc.get(templateId);
    if (def === undefined) return null;
    return new LoadContext(this.codec.env, this.doc).codec.instantiate(def);
  }

  /** C++ `TemplateStore::instance().getTemplate`: a loaded copy, or null. */
  storeTemplate(templateId: string): ShapeTemplate | null {
    const def = this.ctx.catalog.get(templateId);
    return def === undefined ? null : this.ctx.catalog.instantiate(def);
  }

  /** C++ `serializePage`. */
  serializePage(page: Page): JsonOut {
    return new JsonDocumentWriter(this.codec.templates, { stamp: 'cloud' }).page(page);
  }

  // ================================================================ CORE (C++ 1764-3194)

  frame(kind: FrameKind): Frame {
    return this.frames[kind] as Frame;
  }

  // ---------------------------------------------------------------- errors

  fail(code: string, message: string): boolean {
    if (!this.failed) {
      this.failed = true;
      this.errorCode = code;
      this.errorMessage = message;
    }
    return false;
  }

  failAt(code: string, message: string, at: number): boolean {
    if (!this.failed) {
      this.fail(code, message);
      this.hasErrorOp = true;
      this.errorOp = at;
    }
    return false;
  }

  // ---------------------------------------------------------------- paths

  objPath(objId: string): string {
    return `${consts.doc}.${consts.pages}.${this.pageId}.${consts.objects}.${objId}`;
  }

  pagePath(pageId: string): string {
    return `${consts.doc}.${consts.pages}.${pageId}`;
  }

  /** Last write wins. */
  change(kind: FrameKind, path: string, value: JsonValue): void {
    const f = this.frame(kind);
    f.changes.delete(path);
    f.changes.set(path, value);
  }

  /** First condition on a path wins; none under strict or force. */
  condition(kind: FrameKind, path: string, value: JsonValue): void {
    if (this.policy !== ConflictPolicy.PerObject) return;
    const f = this.frame(kind);
    if (f.conditions.has(path)) return;
    f.conditions.set(path, value);
  }

  conditionExists(kind: FrameKind, path: string): void {
    this.condition(kind, path, existsNode(true));
  }

  // ---------------------------------------------------------------- envelope

  parseEnvelope(): boolean {
    let batch: JsonValue | undefined;
    if (typeof this.batchInput === 'string') {
      try {
        batch = JSON.parse(this.batchInput) as JsonValue;
      } catch {
        batch = undefined;
      }
    } else {
      batch = this.batchInput;
    }
    if (!isJsonObject(batch)) return this.fail(INVALID_OPERATION, 'the batch is not a JSON object');
    this.batch = batch;

    const version = numberOf(batch[KEY.version]);
    if (version === null) {
      return this.fail(VERSION_REQUIRED, '`version` is required on every edit: send the version `board_read` returned');
    }
    this.version = Math.trunc(version);
    this.hasVersion = true;

    const policy = batch[K_CONFLICT_POLICY];
    if (typeof policy === 'string' && policy !== '') {
      if (policy === 'per_object') this.policy = ConflictPolicy.PerObject;
      else if (policy === 'strict') this.policy = ConflictPolicy.Strict;
      else if (policy === 'force') this.policy = ConflictPolicy.Force;
      else return this.fail(INVALID_OPERATION, `conflict_policy must be per_object, strict or force, not "${policy}"`);
    }
    if (batch[K_FORCE] === true) this.policy = ConflictPolicy.Force;

    const page = batch[K_PAGE];
    this.pageId = typeof page === 'string' ? page : '';
    if (this.pageId === '') {
      if (this.doc.pages.length === 0) return this.fail(PAGE_NOT_FOUND, 'the document has no pages');
      this.pageId = this.doc.activePage().id;
    }
    const found = this.doc.getPage(this.pageId);
    if (found === null) return this.fail(PAGE_NOT_FOUND, `no page "${this.pageId}" on this board`);
    this.page = found;

    const templates = batch[K_TEMPLATES];
    if (isJsonObject(templates)) {
      for (const k of sortedKeys(templates)) {
        const body = templates[k];
        if (!isJsonObject(body)) continue;
        // The 26 catalogue arrowhead names are reserved.
        const collides = arrowIdFor(this.ctx.arrows, k);
        if (collides !== '') {
          return this.fail(
            INVALID_OPERATION,
            `"${k}" is the catalogue name of the arrowhead ${collides}, so it cannot key a supplied template: give the body an id of your own`,
          );
        }
        this.suppliedTemplates.set(k, body);
      }
    }

    if (!Array.isArray(batch[K_OPS])) return this.fail(INVALID_OPERATION, '`ops` must be an array');
    return true;
  }

  /** The batch's `ops` (valid after parseEnvelope). */
  ops(): readonly JsonValue[] {
    const ops = this.batch?.[K_OPS];
    return Array.isArray(ops) ? (ops as readonly JsonValue[]) : [];
  }

  /** The pre-pass (semantic-format.md §5.1): mint refs, prove the batch coherent. */
  prepass(): boolean {
    const ops = this.ops();
    const refDefinedAt = new Map<string, number>();
    const objects = this.pageObjects();
    const store = this.page.objectStore;
    for (const obj of objects) this.endOfBatchIds.add(obj.id);

    // Pass one: mint the refs and collect what the batch removes.
    for (let i = 0; i < ops.length; i++) {
      const opNode = ops[i];
      if (!isJsonObject(opNode)) return this.failAt(INVALID_OPERATION, 'an operation must be an object', i);
      const name = typeof opNode[K_OP] === 'string' ? opNode[K_OP] : '';
      if (name === '') return this.failAt(INVALID_OPERATION, 'an operation must name an `op`', i);

      if (name === OP.addNode || name === OP.addEdge) {
        const uuid = this.ctx.newId();
        this.addedIds.push(uuid);
        this.endOfBatchIds.add(uuid);
        this.mintedAt.set(uuid, i);
        const ref = opNode[K_REF];
        if (typeof ref === 'string' && ref !== '') {
          if (this.refs.has(ref)) return this.failAt(INVALID_OPERATION, `ref "${ref}" is used twice in one batch`, i);
          this.refs.set(ref, uuid);
          refDefinedAt.set(ref, i);
        }
        continue;
      }

      if (name === OP.group) {
        const uuid = this.ctx.newId();
        this.addedGroupIds.push(uuid);
        this.endOfBatchIds.add(uuid);
        this.mintedAt.set(uuid, i);
        const ref = opNode[K_REF];
        if (typeof ref === 'string' && ref !== '') {
          if (this.refs.has(ref)) return this.failAt(INVALID_OPERATION, `ref "${ref}" is used twice in one batch`, i);
          this.refs.set(ref, uuid);
          refDefinedAt.set(ref, i);
        }
        const named = opNode[KEY.nodes];
        if (Array.isArray(named)) {
          for (const item of named as readonly JsonValue[]) {
            if (typeof item !== 'string' || item === '') continue;
            const id = this.refs.get(item) ?? item;
            this.endOfBatchIds.delete(id);
            this.consumedByGroup.set(id, i);
          }
        }
        continue;
      }

      if (name === OP.ungroup) {
        const spelled = opNode[K_NODE];
        if (typeof spelled !== 'string' || spelled === '') continue;
        const id = this.refs.get(spelled) ?? spelled;
        const gobj = store.getObject(id);
        if (!(gobj instanceof GroupObject)) continue;
        this.ungroupedAt.set(id, i);
        for (const contained of gobj.objects()) {
          const o = contained.object as LekhObject | null;
          if (o === null) continue;
          this.freedByUngroup.set(o.id, [i, id]);
        }
        continue;
      }

      if (name === OP.clearPage) {
        const target = Object.prototype.hasOwnProperty.call(opNode, K_PAGE) ? opNode[K_PAGE] : undefined;
        if (target !== undefined && target !== this.pageId) continue;
        for (const obj of objects) {
          this.deletedIds.add(obj.id);
          this.endOfBatchIds.delete(obj.id);
        }
        continue;
      }

      if (name === OP.deleteNode || name === OP.deleteEdge) {
        const isNode = name === OP.deleteNode;
        const id = this.resolveId(opNode, i, isNode);
        if (id === null) return false;
        this.deletedIds.add(id);
        this.endOfBatchIds.delete(id);
        if (isNode) {
          const obj = this.existingAnywhere(id);
          if (obj !== null) {
            for (const con of store.connectionsOf(obj)) {
              this.deletedIds.add(con.id);
              this.endOfBatchIds.delete(con.id);
            }
          }
        }
      }
    }

    const endpointResolves = (id: string): boolean => {
      if (this.endOfBatchIds.has(id)) return true;
      if (this.consumedByGroup.has(id)) return true;
      if (this.deletedIds.has(id)) return false;
      return owningGroup(objects, id) !== null;
    };

    // Pass two: add_edge endpoints, and the self-loop rules that need no object.
    for (let i = 0; i < ops.length; i++) {
      const opNode = ops[i] as JsonObject;
      if (opNode[K_OP] !== OP.addEdge) continue;
      const endNamed = ['', ''];
      const endId = ['', ''];
      for (let e = 0; e < 2; e++) {
        const which = e === 0 ? KEY.from : KEY.to;
        const named = opNode[which];
        if (typeof named !== 'string' || named === '') {
          return this.failAt(INVALID_OPERATION, 'add_edge needs both `from` and `to`', i);
        }
        const minted = this.refs.get(named);
        if (minted !== undefined && this.addedGroupIds.includes(minted)) {
          return this.failAt(INVALID_OPERATION, groupEndpointMessage(named), i);
        }
        if (minted !== undefined) {
          const at = refDefinedAt.get(named);
          if (at !== undefined && at >= i) {
            return this.failAt(
              INVALID_OPERATION,
              `add_edge \`${which}\`: ref "${named}" is defined by operation ${String(at)}, which is not earlier than this one — a \`ref\` endpoint must be created by an EARLIER operation, so move that op before this \`add_edge\``,
              i,
            );
          }
        }
        const id = minted ?? named;
        if (!endpointResolves(id)) {
          return this.failAt(
            INVALID_OPERATION,
            `add_edge \`${which}\`: "${named}" does not exist on this page and is not created by this batch`,
            i,
          );
        }
        if (this.addedGroupIds.includes(id)) return this.failAt(INVALID_OPERATION, groupEndpointMessage(named), i);
        const kind = endpointKindRefusal(store.getObject(id, true), named);
        if (kind !== '') return this.failAt(INVALID_OPERATION, kind, i);
        endNamed[e] = named;
        endId[e] = id;
      }
      const sides = new LoopSides();
      const sideMessage = readLoopSides(opNode, sides);
      if (sideMessage !== '') return this.failAt(INVALID_OPERATION, sideMessage, i);
      if (endId[0] !== endId[1]) {
        if (sides.any()) {
          return this.failAt(INVALID_OPERATION, loopSidesOnTwoNodesMessage(endNamed[0] ?? '', endNamed[1] ?? ''), i);
        }
        continue;
      }
      const hasRoute = isJsonObject(opNode[KEY.route]);
      const loopMessage = loopRuleRefusal(opNode, sides, endNamed[0] ?? '', hasRoute);
      if (loopMessage !== '') return this.failAt(INVALID_OPERATION, loopMessage, i);
    }

    // Pass three: `group` members follow the defined-by-an-earlier-operation rule.
    for (let i = 0; i < ops.length; i++) {
      const opNode = ops[i] as JsonObject;
      if (opNode[K_OP] !== OP.group) continue;
      const named = opNode[KEY.nodes];
      if (!Array.isArray(named)) continue;
      for (const item of named as readonly JsonValue[]) {
        if (typeof item !== 'string') continue;
        if (!this.refs.has(item)) continue;
        const defined = refDefinedAt.get(item);
        if (defined !== undefined && defined >= i) {
          return this.failAt(
            INVALID_OPERATION,
            `group \`nodes\`: ref "${item}" is defined by operation ${String(defined)}, which is not earlier than this one — a \`ref\` member must be created by an EARLIER operation, so move that op before this \`group\``,
            i,
          );
        }
      }
    }

    // Pass four: what an earlier (or later) `group` or `ungroup` of THIS batch did to the id.
    for (let i = 0; i < ops.length; i++) {
      const opNode = ops[i] as JsonObject;
      const name = typeof opNode[K_OP] === 'string' ? opNode[K_OP] : '';
      if (name === OP.addEdge || name === OP.group || name === OP.ungroup) continue;
      let spelled = typeof opNode[K_NODE] === 'string' ? opNode[K_NODE] : '';
      if (spelled === '') {
        spelled = typeof opNode[K_EDGE] === 'string' ? opNode[K_EDGE] : '';
        if (spelled === '') continue;
      }
      const id = this.refs.get(spelled) ?? spelled;

      if (name === OP.setStyle) {
        if (this.addedGroupIds.includes(id)) {
          return this.failAt(
            INVALID_OPERATION,
            `set_style cannot address group "${spelled}" in the batch that creates it; send it in the next batch`,
            i,
          );
        }
        const restyled = store.getObject(id);
        if (restyled instanceof GroupObject && (this.ungroupedAt.has(id) || this.consumedByGroup.has(id))) {
          return this.failAt(
            INVALID_OPERATION,
            `set_style on group "${spelled}" cannot share a batch with an operation that ungroups or regroups it; send it in its own batch`,
            i,
          );
        }
      }

      const freed = this.freedByUngroup.get(id);
      if (freed !== undefined && freed[0] < i) {
        return this.failAt(
          INVALID_OPERATION,
          `${name} cannot change "${spelled}" in this batch: operation ${String(freed[0])} ungrouped "${freed[1]}", and objects it freed become editable only in a later batch. Send the change as a second batch`,
          i,
        );
      }
      const addedNode = this.mintedAt.has(id) && !this.addedGroupIds.includes(id);
      const consumed = this.consumedByGroup.get(id);
      if (consumed !== undefined && consumed < i) {
        return this.failAt(
          INVALID_OPERATION,
          `${name} cannot change "${spelled}": operation ${String(consumed)} grouped it, so it is no longer on the page at that point — address the group instead, or ` +
            (addedNode ? 'give it on the add_node' : 'send the change in an earlier batch'),
          i,
        );
      }
      if (name !== OP.deleteNode && name !== OP.deleteEdge) {
        if (consumed !== undefined && consumed > i) {
          return this.failAt(
            INVALID_OPERATION,
            `${name} cannot change "${spelled}" in the batch that groups it: operation ${String(consumed)} groups it, and a batch writes its groups before its other changes, so this one would miss it. ` +
              (addedNode ? 'Give it on the add_node' : 'Send the change in an earlier batch') +
              ', or change the group in a later one',
            i,
          );
        }
        const dissolved = this.ungroupedAt.get(id);
        if (dissolved !== undefined && dissolved > i) {
          return this.failAt(
            INVALID_OPERATION,
            `${name} cannot change "${spelled}" in the batch that ungroups it: operation ${String(dissolved)} ungroups it, and a batch writes its ungroups before its other changes, so this one would miss it. Send the change in an earlier batch, or change the members in a later one`,
            i,
          );
        }
      }
    }

    // Pass five: one route change per edge per batch.
    const routeChangedAt = new Map<string, number>();
    for (let i = 0; i < ops.length; i++) {
      const opNode = ops[i] as JsonObject;
      if (opNode[K_OP] !== OP.setEdgeRoute) continue;
      const spelled = typeof opNode[K_EDGE] === 'string' ? opNode[K_EDGE] : '';
      if (spelled === '') continue;
      const known = this.refs.get(spelled);
      const id = known ?? spelled;
      const defined = refDefinedAt.get(spelled);
      if (known !== undefined && defined !== undefined && defined < i) {
        const definingOp = (ops[defined] as JsonObject)[K_OP];
        if (definingOp === OP.addEdge) {
          return this.failAt(
            INVALID_OPERATION,
            `"${spelled}" is added by operation ${String(defined)} of this batch; put its route on that add_edge (auto_type, reach, route, edge_type) instead of a set_edge_route`,
            i,
          );
        }
      }
      const changed = routeChangedAt.get(id);
      if (changed !== undefined) {
        return this.failAt(
          INVALID_OPERATION,
          `set_edge_route already changes "${spelled}" in this batch (operation ${String(changed)}); send the second change in a new batch`,
          i,
        );
      }
      routeChangedAt.set(id, i);
    }
    return true;
  }

  // ---------------------------------------------------------------- resolution

  /** The id an op addresses through `node` / `edge` (a ref resolved), or null after a failAt. */
  resolveId(opNode: JsonObject, at: number, wantNode: boolean, eitherKind = false): string | null {
    const node = typeof opNode[K_NODE] === 'string' ? opNode[K_NODE] : '';
    const edge = typeof opNode[K_EDGE] === 'string' ? opNode[K_EDGE] : '';
    const hasNode = node !== '';
    const hasEdge = edge !== '';
    if (hasNode && hasEdge) {
      this.failAt(INVALID_OPERATION, 'address one of `node` or `edge`, not both', at);
      return null;
    }
    let named: string;
    if (hasNode) named = node;
    else if (hasEdge) named = edge;
    else {
      this.failAt(
        INVALID_OPERATION,
        'this operation must address ' + (eitherKind ? 'one of `node` or `edge`' : wantNode ? 'a `node`' : 'an `edge`'),
        at,
      );
      return null;
    }
    return this.refs.get(named) ?? named;
  }

  existingAnywhere(objId: string): LekhObject | null {
    return this.newObjects.get(objId) ?? this.page.objectStore.getObject(objId, true);
  }

  /** Page level only: a member is refused, naming its group. */
  existing(objId: string, at: number, opName: string): LekhObject | null {
    const fresh = this.newObjects.get(objId);
    if (fresh !== undefined) return fresh;
    const top = this.page.objectStore.getObject(objId);
    if (top !== null) return top;
    const owner = owningGroup(this.pageObjects(), objId);
    if (owner !== null) {
      this.failAt(
        INVALID_OPERATION,
        `${opName} cannot change "${objId}": it is inside group "${owner.id}". Ungroup "${owner.id}" first, make the change, then group the objects again`,
        at,
      );
    }
    return null;
  }

  existingTemplated(objId: string, at: number, opName: string, groupsAllowed = false): TemplatedObject | null {
    const obj = this.existing(objId, at, opName);
    if (obj === null) {
      this.failAt(OBJECT_NOT_FOUND, `no object "${objId}" on page ${this.pageId}`, at);
      return null;
    }
    if (obj instanceof ConnectionObject) {
      this.failAt(INVALID_OPERATION, `${opName} addresses a node; "${objId}" is an edge`, at);
      return null;
    }
    if (obj instanceof GroupObject) {
      if (!groupsAllowed) {
        this.failAt(
          INVALID_OPERATION,
          `${opName} cannot change "${objId}": it is a group, and a group answers no template. Ungroup it and address the member you mean`,
          at,
        );
        return null;
      }
      return obj;
    }
    if (!(obj instanceof TemplatedObject) || obj.shapeTemplate() === null) {
      this.failAt(INVALID_OPERATION, `${opName} needs a templated shape; "${objId}" is ${whatItIs(obj)}`, at);
      return null;
    }
    return obj;
  }

  existingConnection(objId: string, at: number, opName: string): ConnectionObject | null {
    const obj = this.existing(objId, at, opName);
    if (obj === null) {
      this.failAt(OBJECT_NOT_FOUND, `no object "${objId}" on page ${this.pageId}`, at);
      return null;
    }
    if (!(obj instanceof ConnectionObject)) {
      this.failAt(INVALID_OPERATION, `${opName} addresses an edge; "${objId}" is a node`, at);
      return null;
    }
    return obj;
  }

  /**
   * A template id to a loaded body, from the batch's `templates`, the document, then the store.
   * A supplied catalogue entry `{template, params: {width, height}}` also gives the default size.
   */
  resolveTemplate(templateId: string): ResolvedTemplate | null {
    let defaultWidth: number | null = null;
    let defaultHeight: number | null = null;
    const supplied = this.suppliedTemplates.get(templateId);
    if (supplied !== undefined) {
      let body: JsonObject = supplied;
      const wrapped = body[consts.stemplate];
      if (isJsonObject(wrapped)) {
        const params = body[consts.params];
        if (isJsonObject(params)) {
          const w = numberOf(params['width']);
          if (w !== null && w > 0) defaultWidth = w;
          const h = numberOf(params['height']);
          if (h !== null && h > 0) defaultHeight = h;
        }
        body = wrapped;
      }
      // C++ `parseShapeTemplate` leaves the template unloaded; its callers load it.
      const stl = this.codec.templates.parse(body);
      if (stl !== null) return { stl, defaultWidth, defaultHeight };
    }
    const fromDoc = this.docTemplate(templateId);
    if (fromDoc !== null) return { stl: fromDoc, defaultWidth, defaultHeight };
    const fromStore = this.storeTemplate(templateId);
    return fromStore === null ? null : { stl: fromStore, defaultWidth, defaultHeight };
  }

  /** An arrowhead by catalogue name or template id (name first), or a supplied body; loaded. */
  resolveArrow(arrowValue: string): ShapeTemplate | null {
    const named = arrowIdFor(this.ctx.arrows, arrowValue);
    const def = this.ctx.arrows.arrowhead(named === '' ? arrowValue : named);
    if (def === undefined) {
      const supplied = this.suppliedTemplates.get(arrowValue);
      if (supplied !== undefined) {
        const wrapped = supplied[consts.stemplate];
        const body = isJsonObject(wrapped) ? wrapped : supplied;
        const parsed = this.codec.templates.parse(body);
        if (parsed !== null) {
          parsed.load();
          return parsed;
        }
      }
      return null;
    }
    return this.ctx.catalog.instantiate(def);
  }

  /** Deterministic: the page's own maximum order + 100 + offset. */
  nextOrder(offset: number): number {
    let maxOrder = 0;
    for (const obj of this.pageObjects()) if (obj.order > maxOrder) maxOrder = obj.order;
    return maxOrder + 100 + offset;
  }

  /** A stand-alone copy through the serializer: same id, same order, same bytes. */
  detachedCopy(obj: TemplatedObject | null): TemplatedObject | null {
    if (obj === null) return null;
    const node = this.codec.writeObject(obj);
    let parsed: LekhObject;
    try {
      parsed = this.codec.readObject(node, obj.id, this.doc).object;
    } catch {
      return null;
    }
    return parsed instanceof TemplatedObject ? parsed : null;
  }

  // ---------------------------------------------------------------- the working state

  cloneProfile(profile: Style, master: boolean): Style {
    const clone = profile.deepClone();
    if (clone instanceof GroupStyle) {
      if (master) clone.setMode(GroupStyleMode.Master);
      for (const child of clone.getProfiles()) child.setParent(clone);
    }
    clone.setParent(profile.parent());
    return clone;
  }

  static setWorkingGeometry(w: Working, ds: DataStore): void {
    w.hasGeometry = true;
    w.cx = ds.cx();
    w.cy = ds.cy();
    w.width = ds.width();
    w.height = ds.height();
    w.angle = ds.angle();
  }

  workingFor(objId: string, obj: LekhObject | null): Working {
    const found = this.working.get(objId);
    if (found !== undefined) return found;
    const w: Working = {
      tnode: null,
      style: null,
      installed: null,
      hasGeometry: false,
      cx: 0,
      cy: 0,
      width: 0,
      height: 0,
      angle: 0,
    };
    this.working.set(objId, w);
    if (obj === null) return w;
    const tobj = obj instanceof TemplatedObject ? obj : null;
    if (tobj !== null) CompilationBase.setWorkingGeometry(w, tobj.ds);
    if (obj instanceof GroupObject) return w;
    const stl = tobj?.shapeTemplate() ?? null;
    if (stl !== null) w.tnode = this.codec.templates.serialize(stl);
    const profile = obj.getDrawingProfile();
    w.style = this.cloneProfile(profile, stl !== null);
    return w;
  }

  currentTemplate(w: Working, tobj: TemplatedObject): ShapeTemplate | null {
    return w.installed ?? tobj.shapeTemplate();
  }

  /** `node` parsed into `profile` the way a reload reads it. */
  parseAsLoaded(profile: Style, node: JsonValue): void {
    if (profile instanceof GroupStyle) {
      parseStyle(profile, node, false);
      return;
    }
    const fresh = new Style();
    fresh.setParent(profile.parent());
    parseStyle(fresh, node, true);
    profile.copyFrom(fresh);
  }

  applyStyleToWorking(w: Working, values: JsonValue | undefined): void {
    if (w.style === null || !isJsonObject(values)) return;
    const node = { ...serializeStyle(w.style) };
    for (const k of sortedKeys(values)) {
      const v = values[k];
      if (v !== undefined) node[k] = structuredJson(v);
    }
    this.parseAsLoaded(w.style, node);
    if (w.tnode !== null) {
      const style = serializeStyle(w.style);
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- C++ removeField(consts::style)
      if (Object.keys(style).length === 0) delete w.tnode[consts.style];
      else w.tnode[consts.style] = style;
    }
  }

  /** The cross-frame condition rule (spec/01 §3.4): hoist or drop conditions an earlier frame shadows. */
  settleConditions(): void {
    if (this.policy !== ConflictPolicy.PerObject) return;
    const shadowingFrame = (path: string, before: number): number => {
      for (let k = 0; k < before; k++) {
        const changes = (this.frames[k] as Frame).changes;
        if (changes.size === 0) continue;
        if (changes.has(path)) return k;
        for (let dot = path.indexOf('.'); dot !== -1; dot = path.indexOf('.', dot + 1)) {
          if (changes.has(path.slice(0, dot))) return k;
        }
      }
      return FRAME_COUNT;
    };
    for (let k = 1; k < FRAME_COUNT; k++) {
      const conditions = (this.frames[k] as Frame).conditions;
      for (const path of [...conditions.keys()].sort(byteOrder)) {
        const value = conditions.get(path);
        if (isJsonObject(value) && value['$exists'] === true) continue;
        const earlier = shadowingFrame(path, k);
        if (earlier === FRAME_COUNT) continue;
        if (
          earlier !== FrameKind.AddPages &&
          earlier !== FrameKind.AddObjects &&
          earlier !== FrameKind.ConvertObjects
        ) {
          const target = (this.frames[earlier] as Frame).conditions;
          if (!target.has(path)) target.set(path, value ?? null);
        }
        conditions.delete(path);
      }
    }
  }

  /** The backstop: no later frame writes at or under a path `convertobjects` removed. */
  refuseWritesToRemoved(): boolean {
    const converted = this.frame(FrameKind.ConvertObjects).changes;
    const removed = new Set<string>();
    for (const [path, v] of converted) if (v === null) removed.add(path);
    if (removed.size === 0) return true;
    for (let k = FrameKind.ConvertObjects + 1; k < FRAME_COUNT; k++) {
      const changes = (this.frames[k] as Frame).changes;
      for (const path of [...changes.keys()].sort(byteOrder)) {
        const isNull = changes.get(path) === null;
        let hit = '';
        if (removed.has(path)) {
          if (isNull) continue;
          hit = path;
        } else {
          for (let dot = path.indexOf('.'); dot !== -1; dot = path.indexOf('.', dot + 1)) {
            if (removed.has(path.slice(0, dot))) {
              hit = path.slice(0, dot);
              break;
            }
          }
        }
        if (hit === '') continue;
        return this.fail(
          INVALID_OPERATION,
          `internal: this batch writes "${path}" after its group or ungroup removed "${hit}" from the page, which would leave part of an object behind; nothing was written. Send the group or ungroup in a batch of its own`,
        );
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- run

  run(): JsonOut {
    const root: JsonOut = {};
    if (this.parseEnvelope() && this.prepass()) {
      const ops = this.ops();
      for (let i = 0; i < ops.length; i++) {
        this.ctx.budgetCheck();
        if (!this.compileOp(ops[i] as JsonObject, i)) break;
      }
      if (!this.failed) {
        this.finishPageOrder();
        if (this.refuseWritesToRemoved()) this.settleConditions();
      }
    }

    if (this.failed) {
      root['ok'] = false;
      root['error'] = this.errorCode;
      root['message'] = this.errorMessage;
      if (this.hasErrorOp) root[K_OP] = this.errorOp;
      return root;
    }

    const batch = this.batch as JsonObject;
    root['ok'] = true;
    const docid = batch[KEY.docid];
    root[KEY.docid] = typeof docid === 'string' ? docid : '';
    root[KEY.version] = this.version;
    root[K_PAGE] = this.pageId;

    const frames: JsonValue[] = [];
    let frameIndex = 0;
    for (let i = 0; i < FRAME_COUNT; i++) {
      const f = this.frames[i] as Frame;
      if (f.changes.size === 0) continue;
      const changes: JsonOut = {};
      for (const k of [...f.changes.keys()].sort(byteOrder)) changes[k] = f.changes.get(k) ?? null;
      f.changes.clear();
      const conditions: JsonOut = {};
      if (this.policy === ConflictPolicy.Strict) {
        // A whole-document compare-and-swap, per frame: frame N conditions on version + N.
        conditions[KEY.version] = this.version + frameIndex;
      } else {
        for (const k of [...f.conditions.keys()].sort(byteOrder)) conditions[k] = f.conditions.get(k) ?? null;
        f.conditions.clear();
      }
      frames.push({
        [consts.type]: frameType(i as FrameKind),
        [consts.changes]: changes,
        [consts.conditions]: conditions,
      });
      frameIndex++;
    }
    root['frames'] = frames;
    root['frame_count'] = frameIndex;
    root['op_count'] = this.ops().length;

    const created: JsonOut = {};
    for (const k of [...this.refs.keys()].sort(byteOrder)) created[k] = this.refs.get(k) ?? '';
    root['created'] = created;
    root['added'] = [...this.addedIds, ...this.addedGroupIds];
    root['added_pages'] = [...this.addedPageIds];
    root['deleted_edges'] = [...this.reportedDeletedEdges].sort(byteOrder);
    root['auto_placed'] = this.autoPlaced.map((p) => {
      const entry: JsonOut = { id: p.id };
      if (p.ref !== '') entry[K_REF] = p.ref;
      entry[KEY.cx] = g6(p.cx);
      entry[KEY.cy] = g6(p.cy);
      return entry;
    });
    root['notes'] = [...this.notes];
    root['conflict_policy'] =
      this.policy === ConflictPolicy.Strict ? 'strict' : this.policy === ConflictPolicy.Force ? 'force' : 'per_object';
    return root;
  }

  compileOp(opNode: JsonObject, at: number): boolean {
    const name = typeof opNode[K_OP] === 'string' ? opNode[K_OP] : '';
    let row: OpRow | null = null;
    for (const candidate of opVocabulary()) {
      if (candidate.name === name) {
        row = candidate;
        break;
      }
    }
    if (row === null) return this.failAt(INVALID_OPERATION, `unknown op "${name}"`, at);
    if (!this.refuseUnknownMembers(opNode, rowVocabulary(row), name, at)) return false;

    switch (name) {
      case OP.addNode:
        return this.doAddNode(opNode, at);
      case OP.addEdge:
        return this.doAddEdge(opNode, at);
      case OP.deleteNode:
        return this.doDeleteObject(opNode, at, true);
      case OP.deleteEdge:
        return this.doDeleteObject(opNode, at, false);
      case OP.moveNode:
      case OP.resizeNode:
      case OP.rotateNode:
        return this.doMoveResizeRotate(opNode, at, name);
      case OP.reorder:
        return this.doReorder(opNode, at);
      case OP.group:
        return this.doGroup(opNode, at);
      case OP.ungroup:
        return this.doUngroup(opNode, at);
      case OP.setText:
        return this.doSetText(opNode, at);
      case OP.setTitle:
        return this.doSetTitle(opNode, at);
      case OP.setShape:
        return this.doSetShape(opNode, at);
      case OP.setTemplateParams:
        return this.doSetTemplateParams(opNode, at);
      case OP.setStyle:
        return this.doSetStyle(opNode, at);
      case OP.setArrow:
        return this.doSetArrow(opNode, at);
      case OP.setEdgeRoute:
        return this.doSetEdgeRoute(opNode, at);
      case OP.setEdgeTexts:
        return this.doSetEdgeTexts(opNode, at);
      case OP.addPage:
        return this.doAddPage(opNode, at);
      case OP.deletePage:
        return this.doDeletePage(opNode, at);
      case OP.movePage:
        return this.doMovePage(opNode, at);
      case OP.renamePage:
        return this.doRenamePage(opNode, at);
      case OP.resizePage:
        return this.doResizePage(opNode, at);
      case OP.clearPage:
        return this.doClearPage(opNode, at);
      case OP.setPageBackground:
        return this.doSetPageBackground(opNode, at);
      case OP.setPageMargin:
        return this.doSetPageMargin(opNode, at);
      case OP.setGrid:
        return this.doSetGrid(opNode, at);
      case OP.setScaling:
        return this.doSetScaling(opNode, at);
    }
    return this.failAt(INVALID_OPERATION, `unknown op "${name}"`, at);
  }

  // ================================================================ CORE: shared bits (C++ 7778-8312)

  /** `text` or `texts` onto `stl` (projected slot indices; an interpreting generator takes one string). */
  applyTexts(source: JsonObject, stl: ShapeTemplate, obj: TemplatedObject | null, at: number): boolean {
    const generator = stl.generator;
    const scalarValue = source[KEY.text];
    const hasScalar = typeof scalarValue === 'string';
    const scalar = hasScalar ? scalarValue : '';

    let texts = Object.prototype.hasOwnProperty.call(source, KEY.texts) ? source[KEY.texts] : undefined;
    if (texts === null) texts = undefined;
    if (texts !== undefined && !Array.isArray(texts)) {
      return this.failAt(
        INVALID_OPERATION,
        `texts is an array of { text } by slot index, not ${aJsonType(texts)}; use \`text\` for a single string`,
        at,
      );
    }
    const list = (texts ?? []) as readonly JsonValue[];
    const hasArray = texts !== undefined;
    for (let i = 0; hasArray && i < list.length; i++) {
      const entry = list[i];
      const where = `texts[${String(i)}]`;
      if (!isJsonObject(entry)) {
        return this.failAt(
          INVALID_OPERATION,
          `texts is an array of { text } by slot index — ${where} is ${aJsonType(entry)}; write { "text": "…" }, or use \`text\` for the first slot`,
          at,
        );
      }
      const text = Object.prototype.hasOwnProperty.call(entry, KEY.text) ? entry[KEY.text] : undefined;
      if (text !== undefined && typeof text !== 'string') {
        return this.failAt(INVALID_OPERATION, `${where}.text is a string`, at);
      }
      for (const m of sortedKeys(entry)) {
        if (m !== KEY.text && m !== KEY.row && m !== KEY.col) {
          return this.failAt(
            INVALID_OPERATION,
            `${where} has no member "${m}"; a text entry carries text, and row and col on a table-like shape`,
            at,
          );
        }
      }
    }

    if (!hasScalar && !hasArray) return true;
    if (hasScalar && hasArray) return this.failAt(INVALID_OPERATION, 'give `text` or `texts`, not both', at);

    if (generator !== null && generator.interpretText()) {
      let text = scalar;
      if (hasArray) {
        if (list.length > 1) {
          return this.failAt(
            INVALID_OPERATION,
            "this shape's generator parses its text, so it has exactly one slot",
            at,
          );
        }
        const first = list[0];
        const firstText = isJsonObject(first) ? first[KEY.text] : undefined;
        if (typeof firstText === 'string') text = firstText;
      }
      stl.setInterpretedText(text);
      return true;
    }

    const body = bodySlotsOf(stl);
    const slots = body.length;
    if (slots === 0) {
      if (stl.titleIndex() >= 0) {
        return this.failAt(
          INVALID_OPERATION,
          'this shape has no text slot; its only text is its title, given with `title`',
          at,
        );
      }
      return this.failAt(
        INVALID_OPERATION,
        'this shape has no text slot; if it is a generated shape, ask stencil_get what its inputs are',
        at,
      );
    }
    if (hasScalar) {
      stl.setText(body[0] as number, scalar);
      return true;
    }
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!isJsonObject(entry)) continue;
      const entryText = entry[KEY.text];
      const text = typeof entryText === 'string' ? entryText : '';
      const row = numberOf(entry[KEY.row]);
      const col = numberOf(entry[KEY.col]);
      if (row !== null && col !== null) {
        let placed = false;
        for (let s = 0; s < slots; s++) {
          const slot = stl.textData[body[s] as number];
          if (slot !== undefined && slot.row === Math.trunc(row) && slot.col === Math.trunc(col)) {
            stl.setText(body[s] as number, text);
            placed = true;
            break;
          }
        }
        if (!placed) {
          return this.failAt(
            INVALID_OPERATION,
            `no cell at row ${String(Math.trunc(row))}, col ${String(Math.trunc(col))} on this shape`,
            at,
          );
        }
        continue;
      }
      if (i >= slots) {
        return this.failAt(
          INVALID_OPERATION,
          `this shape has ${String(slots)} text slot(s); \`texts\` carries ${String(list.length)}`,
          at,
        );
      }
      stl.setText(body[i] as number, text);
    }
    return true;
  }

  /** add_node's `title`: a string, or `{ text?, side?, style? }`. */
  applyTitle(source: JsonObject, stl: ShapeTemplate, at: number): boolean {
    const title = Object.prototype.hasOwnProperty.call(source, KEY.title) ? source[KEY.title] : undefined;
    if (title === undefined || title === null) return true;
    const prefix = 'add_node.title';
    const index = stl.titleIndex();
    if (index < 0 || index >= stl.textData.length) {
      return this.failAt(INVALID_OPERATION, `${prefix}: ${stl.id()} has no title; its stencil declares none`, at);
    }
    let text: JsonValue | undefined;
    let side: JsonValue | undefined;
    let style: JsonValue | undefined;
    if (typeof title === 'string') {
      text = title;
    } else if (isJsonObject(title)) {
      for (const m of sortedKeys(title)) {
        if (m !== KEY.text && m !== KEY.side && m !== KEY.style) {
          return this.failAt(INVALID_OPERATION, `${prefix} has no member "${m}"; it takes text, side and style`, at);
        }
      }
      const get = (k: string): JsonValue | undefined =>
        Object.prototype.hasOwnProperty.call(title, k) ? title[k] : undefined;
      text = get(KEY.text);
      side = get(KEY.side);
      style = get(KEY.style);
      if (text === undefined && side === undefined && style === undefined) {
        return this.failAt(INVALID_OPERATION, `${prefix} needs text, side, style, or a combination`, at);
      }
    } else {
      return this.failAt(
        INVALID_OPERATION,
        `${prefix} is a string (the text) or { text, side, style }, not ${aJsonType(title)}`,
        at,
      );
    }
    if (text !== undefined && typeof text !== 'string') {
      return this.failAt(INVALID_OPERATION, `${prefix}.text is a string`, at);
    }
    let newSide: TextSide = TextSide.None;
    if (side !== undefined) {
      if (typeof side === 'string') newSide = textSideFromName(side);
      if (newSide === TextSide.None) return this.failAt(INVALID_OPERATION, titleSideMessage(prefix), at);
    }
    const titleStyle = stl.textData[index]?.style ?? null;
    if (style !== undefined && titleStyle !== null) {
      const pins = { ...serializeStyle(titleStyle) };
      const patched: string[] = [];
      if (!this.patchTitleStyle(style, pins, prefix, at, patched)) return false;
      parseStyle(titleStyle, pins, true);
    }
    if (typeof text === 'string') stl.setText(index, text);
    if (side !== undefined) stl.setTitleSide(newSide);
    return true;
  }

  /** `image: { res: "res://<resid>" }` → slot 0's `src`. */
  applyImage(opNode: JsonObject, stl: ShapeTemplate, at: number): boolean {
    const image = Object.prototype.hasOwnProperty.call(opNode, KEY.image) ? opNode[KEY.image] : undefined;
    if (image === undefined || image === null) return true;
    if (!isJsonObject(image)) return this.failAt(INVALID_OPERATION, '`image` is {res: "res://<id>"}', at);
    for (const m of sortedKeys(image)) {
      if (m !== KEY.res) {
        return this.failAt(INVALID_OPERATION, `image has no member "${m}"; it is {res: "res://<id>"}`, at);
      }
    }
    const resValue = image[KEY.res];
    const res = typeof resValue === 'string' ? resValue : '';
    if (res === '') {
      return this.failAt(
        INVALID_OPERATION,
        'image needs a res:// reference: `image` is {res: "res://<id>"}, and board_add_image answers with the reference for the picture it uploads',
        at,
      );
    }
    if (!res.startsWith(RES_PREFIX)) {
      return this.failAt(
        INVALID_OPERATION,
        `"${res}" is not an image reference: an image reference is "res://<id>", as board_add_image answers with it`,
        at,
      );
    }
    if (!declaresImageSlot(stl)) {
      return this.failAt(
        INVALID_OPERATION,
        `this shape cannot carry an image; ${IMAGE_TEMPLATE_ID} is the image primitive`,
        at,
      );
    }
    const width = numberOf(opNode[KEY.width]);
    const height = numberOf(opNode[KEY.height]);
    if (width === null || height === null) {
      return this.failAt(
        INVALID_OPERATION,
        "an image needs `width` and `height` — the size to draw it on the board, in points. It is independent of the picture's own pixel size",
        at,
      );
    }
    if (width <= 0 || height <= 0) {
      return this.failAt(
        INVALID_OPERATION,
        "an image's `width` and `height` are the size to draw it on the board, in points, and both have to be positive",
        at,
      );
    }
    stl.setImageSrc(0, res);
    return true;
  }

  applyTemplateParams(values: JsonValue | undefined, stl: ShapeTemplate, at: number): boolean {
    if (!isJsonObject(values)) return this.failAt(INVALID_OPERATION, '`template_params` is a name/value object', at);
    for (const name of sortedKeys(values)) {
      const declared = stl.params.find((tp) => tp.name === name) ?? null;
      if (declared === null) {
        return this.failAt(INVALID_OPERATION, `this shape's template declares no parameter "${name}"`, at);
      }
      if (declared.editor.type === ParamEditorType.Hidden) {
        return this.failAt(INVALID_OPERATION, `template parameter "${name}" is Hidden and cannot be set`, at);
      }
      const value = values[name];
      // C++: a JSON null is a NONE node, which passes this check and falls to checkParamValue.
      if (value === undefined || (value !== null && typeof value === 'object')) {
        return this.failAt(INVALID_OPERATION, `template parameter "${name}" takes a number, a string or a boolean`, at);
      }
      const checked = this.checkParamValue(name, declared, value, at);
      if (checked === undefined) return false;
      declared.value = checked;
    }
    stl.load();
    return true;
  }

  /** A template-parameter value against its declaration; the value to store, or undefined after a failAt. */
  checkParamValue(name: string, declared: TemplateParam, value: JsonValue, at: number): JsonValue | undefined {
    const label = `template parameter "${name}"`;
    const editor = declared.editor;
    const isNumber = typeof value === 'number';
    const ranged = editor.minVal < editor.maxVal;
    const range = (): string => (ranged ? ` from ${numberWord(editor.minVal)} to ${numberWord(editor.maxVal)}` : '');
    switch (editor.type) {
      case ParamEditorType.IntMinMax: {
        const n = isNumber ? value : NaN;
        const whole = isNumber && Number.isFinite(n) && Math.floor(n) === n;
        if (!whole || (ranged && (n < editor.minVal || n > editor.maxVal))) {
          this.failAt(INVALID_OPERATION, `${label} takes a whole number${range()}`, at);
          return undefined;
        }
        return Math.trunc(n);
      }
      case ParamEditorType.FloatMinMax:
      case ParamEditorType.FloatMinMaxStep: {
        const n = isNumber ? value : NaN;
        if (!(isNumber && Number.isFinite(n)) || (ranged && (n < editor.minVal || n > editor.maxVal))) {
          this.failAt(INVALID_OPERATION, `${label} takes a number${range()}`, at);
          return undefined;
        }
        return value;
      }
      case ParamEditorType.EnumString: {
        const options = editor.enumItems.join(', ');
        if (typeof value !== 'string') {
          this.failAt(INVALID_OPERATION, `${label} takes one of its options: ${options}`, at);
          return undefined;
        }
        if (!editor.enumItems.includes(value)) {
          this.failAt(INVALID_OPERATION, `"${value}" is not one of ${label}'s options: ${options}`, at);
          return undefined;
        }
        return value;
      }
      default: {
        const kind = declared.value;
        if (typeof kind === 'boolean' && typeof value !== 'boolean') {
          this.failAt(INVALID_OPERATION, `${label} takes a boolean, like its default`, at);
          return undefined;
        }
        if (typeof kind === 'number' && !isNumber) {
          this.failAt(INVALID_OPERATION, `${label} takes a number, like its default`, at);
          return undefined;
        }
        if (typeof kind === 'string' && typeof value !== 'string') {
          this.failAt(INVALID_OPERATION, `${label} takes a string, like its default`, at);
          return undefined;
        }
        return value;
      }
    }
  }

  /** `arrow` is {start, end} and nothing else. */
  checkArrowShape(arrow: JsonValue | undefined, at: number): boolean {
    if (!isJsonObject(arrow)) {
      return this.failAt(
        INVALID_OPERATION,
        '`arrow` is {start, end}, each a catalogue arrowhead name, an arrow template id, or null',
        at,
      );
    }
    for (const m of sortedKeys(arrow)) {
      if (m !== KEY.start && m !== KEY.end) {
        return this.failAt(INVALID_OPERATION, `arrow has no member "${m}"; it is {start, end}`, at);
      }
    }
    return true;
  }

  applyArrow(arrow: JsonValue | undefined, target: ArrowHeads | null, at: number): boolean {
    if (target === null) return this.failAt(INVALID_OPERATION, 'this object cannot carry an arrowhead', at);
    if (!this.checkArrowShape(arrow, at)) return false;
    const a = arrow as JsonObject;
    const ends = [KEY.start, KEY.end] as const;
    for (let e = 0; e < 2; e++) {
      const key = ends[e] as string;
      const member = Object.prototype.hasOwnProperty.call(a, key) ? a[key] : undefined;
      if (member === undefined || member === null) continue;
      if (typeof member !== 'string' || member === '') return this.failAt(INVALID_OPERATION, ARROWHEAD_IS, at);
      const stl = this.resolveArrow(member);
      if (stl === null) return this.failAt(UNKNOWN_STENCIL, arrowheadMessage(member), at);
      if (e === 0) target.setStart(stl);
      else target.setEnd(stl);
    }
    return true;
  }

  applyStyle(
    style: JsonValue | undefined,
    target: Style | null,
    at: number,
    kind: StyleTarget = StyleTarget.Other,
    named = '',
  ): boolean {
    if (!isJsonObject(style) || target === null)
      return this.failAt(INVALID_OPERATION, '`style` is an attribute object', at);
    const stored: JsonOut = {};
    for (const k of sortedKeys(style)) {
      const storedKey = storedStyleKey(k);
      if (storedKey === null) return this.failAt(INVALID_OPERATION, styleKeyMessage(k), at);
      const value = this.storedStyleNode(k, style[k], undefined, at);
      if (value === undefined) return false;
      const reason = inertStyleReason(kind, k);
      if (reason !== null) return this.failAt(INVALID_OPERATION, inertStyleMessage(named, k, reason), at);
      stored[storedKey] = value;
    }
    parseStyle(target, stored, false);
    return true;
  }

  noteLatentKeys(objId: string, named: string, keys: readonly string[]): void {
    if (keys.length === 0) return;
    let found = this.latentNotes.get(objId);
    if (found === undefined) {
      found = [this.notes.length, []];
      this.latentNotes.set(objId, found);
      this.notes.push('');
    }
    const namedKeys = found[1];
    for (const key of keys) if (!namedKeys.includes(key)) namedKeys.push(key);
    this.notes[found[0]] =
      `"${named}": ${namedKeys.join(', ')}${namedKeys.length === 1 ? ' is' : ' are'} stored, but this edge has no label yet — it applies to the label you add`;
  }

  // ================================================================ NODES (ops-nodes.ts)

  abstract doAddNode(opNode: JsonObject, at: number): boolean;
  abstract doAddEdge(opNode: JsonObject, at: number): boolean;
  abstract doDeleteObject(opNode: JsonObject, at: number, isNode: boolean): boolean;
  abstract doClearPage(opNode: JsonObject, at: number): boolean;
  abstract doGroup(opNode: JsonObject, at: number): boolean;
  abstract doUngroup(opNode: JsonObject, at: number): boolean;
  abstract checkConvertConsumes(opName: string, ids: readonly string[], at: number): boolean;
  abstract recordConvert(consumes: readonly string[], produces: readonly string[], at: number): void;
  abstract doMoveResizeRotate(opNode: JsonObject, at: number, opName: string): boolean;
  abstract refuseRederivedResize(
    id: string,
    tobj: TemplatedObject,
    w: Working,
    namedWidth: boolean,
    width: number,
    namedHeight: boolean,
    height: number,
    at: number,
  ): boolean;
  abstract refuseShiftOfRemoved(opName: string, spelled: string, neighbour: string, at: number): boolean;
  abstract doReorder(opNode: JsonObject, at: number): boolean;
  /** The template, size and angle an `add_node` asks for, or null (no refusal recorded: the caller decides). */
  abstract resolveAddSize(opNode: JsonObject): AddSize | null;
  abstract checkPathOp(opNode: JsonObject, at: number): boolean;
  abstract buildPathTemplate(plan: PathPlan): ShapeTemplate | null;
  abstract applyEntryStyles(opNode: JsonObject, stl: ShapeTemplate, at: number): boolean;
  /** The auto-placed centre (C++ in/out `cx`, `cy`). */
  abstract placeAddNode(
    hasCx: boolean,
    hasCy: boolean,
    width: number,
    height: number,
    angle: number,
    cx: number,
    cy: number,
  ): { cx: number; cy: number };
  abstract buildTaken(): void;
  abstract emitEmbeddedTemplates(obj: TemplatedObject): void;
  /** The self-loop's type and params, or null after a failAt. */
  abstract selfLoopParams(
    opNode: JsonObject,
    at: number,
    node: LekhObject,
    named: string,
    sides: LoopSides,
    defaultType: ConnectionType,
    routeNeedsType: boolean,
  ): LoopParams | null;
  /** `route` back to `params`, or null after a failAt. */
  abstract routeToParams(route: JsonObject, type: ConnectionType, autoType: AutoType, at: number): Params | null;
  /** An endpoint's `angle`, or null. */
  abstract endpointAngle(route: JsonObject, which: string): number | null;
  /** `reach`: `{ has, value }`, or null after a failAt. */
  abstract readReach(opNode: JsonObject, at: number): { has: boolean; value: number } | null;
  abstract emitEdgeRoute(id: string, params: Params, type: ConnectionType, currentType: ConnectionType): void;
  /** C++ `Compilation::refuseUnknownMembers`: true, or false after a failAt with the refusal. */
  abstract refuseUnknownMembers(
    node: JsonValue | undefined,
    vocabulary: MemberVocabulary,
    location: string,
    at: number,
  ): boolean;

  // ================================================================ EDITS (ops-edits.ts)

  abstract doSetText(opNode: JsonObject, at: number): boolean;
  abstract doSetTitle(opNode: JsonObject, at: number): boolean;
  /** Patches `pins` (stored text-style keys) from a title `style` patch; `changed` gets the stored keys named. */
  abstract patchTitleStyle(patch: JsonValue, pins: JsonOut, prefix: string, at: number, changed: string[]): boolean;
  abstract emitTemplateAndProbe(id: string, w: Working, tnode: JsonOut): void;
  abstract doSetShape(opNode: JsonObject, at: number): boolean;
  abstract doSetTemplateParams(opNode: JsonObject, at: number): boolean;
  abstract doSetStyle(opNode: JsonObject, at: number): boolean;
  abstract restyleGroupTree(
    obj: LekhObject,
    path: string,
    style: JsonObject,
    at: number,
    written: Map<string, string>,
  ): boolean;
  abstract styleWriteChanges(scratch: Style, tnode: JsonOut | null, storedKey: string, value: JsonValue): boolean;
  abstract unpinSlotTextStyle(tobj: TemplatedObject, path: string, keys: readonly string[], at: number): void;
  abstract sameStoredStyleValue(storedKey: string, a: JsonValue | undefined, b: JsonValue | undefined): boolean;
  /**
   * The stored form of one semantic style value (checked against `currentStored` where it
   * matters), or undefined after a failAt. `prefix` is put before `style.` in refusals.
   */
  abstract storedStyleNode(
    semanticKey: string,
    value: JsonValue | undefined,
    currentStored: JsonValue | undefined,
    at: number,
    prefix?: string,
  ): JsonValue | undefined;
  abstract doSetArrow(opNode: JsonObject, at: number): boolean;
  abstract doSetEdgeRoute(opNode: JsonObject, at: number): boolean;
  abstract doSetEdgeTexts(opNode: JsonObject, at: number): boolean;
  abstract doAddPage(opNode: JsonObject, at: number): boolean;
  abstract doDeletePage(opNode: JsonObject, at: number): boolean;
  abstract doMovePage(opNode: JsonObject, at: number): boolean;
  abstract doRenamePage(opNode: JsonObject, at: number): boolean;
  abstract doResizePage(opNode: JsonObject, at: number): boolean;
  abstract doSetPageBackground(opNode: JsonObject, at: number): boolean;
  abstract doSetPageMargin(opNode: JsonObject, at: number): boolean;
  abstract doSetGrid(opNode: JsonObject, at: number): boolean;
  abstract doSetScaling(opNode: JsonObject, at: number): boolean;
  abstract buildPageOrder(): void;
  abstract placePage(pageId: string, index: number, conditionNeighbours: boolean): number;
  abstract conditionPageOrder(pageId: string): void;
  abstract finishPageOrder(): void;
  /** `unit`: `{ has, unit }`, or null after a failAt. */
  abstract readUnit(opNode: JsonObject, at: number): { has: boolean; unit: Unit } | null;
  /** The size arguments, or null after a failAt. */
  abstract readPageSizeArgs(opNode: JsonObject, at: number): PageSizeArgs | null;
  abstract canvasNameCondition(page: Page): JsonValue;
  abstract defaultTolerantCondition(value: JsonValue, loaderDefault: JsonValue): JsonValue;
}

/** C++ `std::map` key order. */
export function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A deep copy of a JSON value (C++ `JsonNode::clone`). */
export function structuredJson(v: JsonValue): JsonValue {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return (v as readonly JsonValue[]).map(structuredJson);
  const out: JsonOut = {};
  for (const k of Object.keys(v)) out[k] = structuredJson((v as JsonObject)[k] as JsonValue);
  return out;
}
