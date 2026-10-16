// The whole-board generator (port of C++ `semantic/SemanticGenerator.{h,cpp}`): a board from a
// semantic description, in four steps — the envelope, the page skeleton, sizing and placement,
// then assembly and the load-back that validates.
//
// Every object goes through the delta compiler (`compileToNode`) rather than being assembled
// here, so a create and an edit build shapes alike. GROUPS: a node that carries `children` is a
// group, and the whole of what this file does with one is emit a `group` operation into the batch
// the compiler already receives. What only a TREE can see is checked here: a cycle in `children`,
// a node claimed by two parents, the depth cap refused up front, and the exclusion of group nodes
// from placement.
import { isLekhError } from '../base';
import { parseLenientJson, writeJsonText } from '../io';
import { CanvasSizeType, GroupObject, LekhDocument, Page, PageSize, type PageMargin } from '../model';
import { Scaling, Unit } from '../style';
import { withDocument, type JsonInput, type SemanticContext, type SemanticHost } from './context';
import { compileToNode, refuseUnknownMembers, type MemberVocabulary } from './delta';
import {
  FIXED_CANVAS_NEEDS_SIZE,
  KEY,
  MAX_GROUP_DEPTH,
  canvasTypeFromName,
  canvasTypeMessage,
  hexToColor,
  noSizeMessage,
  unitFromName,
  unitMessage,
} from './format';
import {
  boolOf,
  cloneValue,
  isJsonObject,
  member,
  numberValue,
  sortedKeys,
  stringOf,
  type JsonObject,
  type JsonOut,
  type JsonValue,
} from './json';
import {
  PLACEMENT_GAP,
  PLACEMENT_MARGIN,
  placementBoxAt,
  placementHalfExtents,
  placementPushClear,
  type PlacementBox,
} from './placement';

// ---------------------------------------------------------------- vocabulary

// The same error words SemanticDelta answers with: the MCP layer maps one table.
const INVALID_OPERATION = 'invalid_operation';
const PAGE_NOT_FOUND = 'page_not_found';

const K_GRID = 'grid';
const K_TEMPLATES = 'templates';
const K_REF = 'ref';
const K_OP = 'op';
const K_OPS = 'ops';
const K_ADD_NODE = 'add_node';
const K_ADD_EDGE = 'add_edge';
const K_GROUP = 'group';
// The batch envelope's target page id on the way in, the index of the page at fault on the way out.
const K_PAGE = 'page';

const K_OK = 'ok';
const K_ERROR = 'error';
const K_MESSAGE = 'message';
const K_FRAMES = 'frames';
const K_ADDED = 'added';
const K_CREATED = 'created';
const K_NODE_COUNT = 'node_count';
const K_EDGE_COUNT = 'edge_count';
const K_OBJECT_COUNT = 'object_count';
const K_PLACED = 'placed';
const K_NODE = 'node';
const K_EDGE = 'edge';

// Stored keys (C++ `consts::`).
const C_DOC = 'doc';
const C_PAGES = 'pages';
const C_OBJECTS = 'objects';
const C_PARAMS = 'params';
const C_CHANGES = 'changes';
const C_TYPE = 'type';
const ADD_OBJECTS = 'addobjects';
const CONVERT_OBJECTS = 'convertobjects';

// ---------------------------------------------------------------- helpers

/**
 * A `unit` member, read with the §2.1 vocabulary: `point`, `inch` or `cm`, exactly, with
 * resize_page's message. `has` is false and `refusal` '' when there is no member.
 */
function readUnit(owner: JsonValue, unit: Unit): { has: boolean; unit: Unit; refusal: string } {
  const m = member(owner, KEY.unit);
  if (m === undefined) return { has: false, unit, refusal: '' };
  const name = typeof m === 'string' ? m : JSON.stringify(m);
  const u = typeof m === 'string' ? unitFromName(name) : null;
  if (u === null) return { has: false, unit, refusal: unitMessage(name) };
  return { has: true, unit: u, refusal: '' };
}

/** One change of a frame, written into the document's own JSON. A null value is a deletion. */
function setAtPath(root: JsonOut, path: string, value: JsonValue): boolean {
  const parts = path.split('.');
  if (parts.length < 2 || parts[0] !== C_DOC) return false;
  let cur = root;
  for (let i = 1; i + 1 < parts.length; i++) {
    const k = parts[i] as string;
    let next = cur[k];
    if (!isJsonObject(next)) {
      next = {};
      cur[k] = next;
    }
    cur = next;
  }
  const last = parts[parts.length - 1] as string;
  if (value === null) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- a frame's null is a removal
    delete cur[last];
    return true;
  }
  cur[last] = value;
  return true;
}

/** `ref`, else `id`: how every node is named. */
function effectiveRef(node: JsonValue): string {
  const ref = stringOf(node, K_REF);
  if (ref !== undefined && ref !== '') return ref;
  return stringOf(node, KEY.id) ?? '';
}

// ---------------------------------------------------------------- plans

/** What placement needs to know about one node (axis-aligned half extents). */
interface NodePlan {
  readonly source: JsonObject;
  readonly hasCx: boolean;
  readonly hasCy: boolean;
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
  placed: boolean;
}

/** A node that carries `children`: a group rather than a shape. */
interface GroupPlan {
  readonly nodeIndex: number;
  readonly ref: string;
  readonly childNames: string[];
  readonly childGroups: number[];
  height: number;
}

interface PagePlan {
  readonly definition: JsonObject;
  page: Page | null;
  id: string;
  readonly nodes: JsonObject[];
  readonly edges: JsonObject[];
  /** Indices into `nodes`: the `add_node` ops, in order. */
  readonly shapes: number[];
  readonly groups: GroupPlan[];
  /** Indices into `groups`, bucketed by height; one batch per bucket. */
  levels: number[][];
  /** Parallel to `shapes`. */
  readonly plans: NodePlan[];
  anyAutoPlaced: boolean;
}

/** A group node carries `id` and `children` and nothing else; '' when it carries nothing it may not. */
function groupNodeBan(node: JsonObject): string {
  if (member(node, KEY.shape) !== undefined) {
    return `a group node cannot carry \`${KEY.shape}\`: a group answers no template, and is declared by \`children\` alone`;
  }
  for (const k of [KEY.cx, KEY.cy, KEY.width, KEY.height, KEY.angle]) {
    if (member(node, k) !== undefined) {
      return `a group node cannot carry \`${k}\`: a group's geometry comes from its members, and is never declared`;
    }
  }
  for (const k of [KEY.text, KEY.texts, KEY.title, KEY.templateParams, KEY.arrow, KEY.image, KEY.style, KEY.draw]) {
    if (member(node, k) !== undefined) return `a group node cannot carry \`${k}\`: a group answers no template`;
  }
  if (member(node, KEY.zOrder) !== undefined) {
    return `a group node cannot carry \`${KEY.zOrder}\`: a group takes its first member's order`;
  }
  return '';
}

/** Everything inside a group, at every depth. */
function countInGroup(group: GroupObject): number {
  let count = 0;
  for (const contained of group.objects()) {
    count++;
    const inner = contained.object;
    if (inner instanceof GroupObject) count += countInGroup(inner);
  }
  return count;
}

function groupLabel(gp: GroupPlan): string {
  return gp.ref === '' ? `the group at node ${String(gp.nodeIndex)}` : `group "${gp.ref}"`;
}

/** A cycle in `children`; `cycle` receives the groups on it, in the order they close the loop. */
function findGroupCycle(
  groups: readonly GroupPlan[],
  at: number,
  mark: number[],
  path: number[],
  cycle: number[],
): boolean {
  mark[at] = 1;
  path.push(at);
  for (const child of (groups[at] as GroupPlan).childGroups) {
    if (mark[child] === 1) {
      cycle.splice(0, cycle.length, ...path.slice(path.indexOf(child)));
      return true;
    }
    if (mark[child] === 0 && findGroupCycle(groups, child, mark, path, cycle)) return true;
  }
  path.pop();
  mark[at] = 2;
  return false;
}

/** How many levels this group will span (memoised; only safe once there is no cycle). */
function groupPlanHeight(groups: GroupPlan[], at: number): number {
  const g = groups[at] as GroupPlan;
  if (g.height !== 0) return g.height;
  let deepest = 0;
  for (const child of g.childGroups) deepest = Math.max(deepest, groupPlanHeight(groups, child));
  g.height = deepest + 1;
  return g.height;
}

/** Which operations one compile carries. */
interface BatchSpec {
  readonly withAdds: boolean;
  readonly withPlacement: boolean;
  readonly withEdges: boolean;
  /** Indices into `PagePlan.groups`. */
  readonly groups: readonly number[] | null;
}

const addCount = (spec: BatchSpec, plan: PagePlan): number => (spec.withAdds ? plan.shapes.length : 0);
const edgeCount = (spec: BatchSpec, plan: PagePlan): number => (spec.withEdges ? plan.edges.length : 0);
const groupCount = (spec: BatchSpec): number => spec.groups?.length ?? 0;

/**
 * The read-only projection keys: a board read can be sent back as `content`, and these are the
 * node- and edge-level keys the projector emits and no operation takes. Removed from each cloned
 * op after `id` has become the `ref`.
 */
const PROJECTION_ONLY_NODE_KEYS: readonly string[] = Object.freeze([
  KEY.id,
  KEY.kind,
  KEY.shapeName,
  KEY.generated,
  KEY.interpretText,
  KEY.editable,
  KEY.parent,
]);
const PROJECTION_ONLY_EDGE_KEYS: readonly string[] = Object.freeze([KEY.id]);

function stripProjectionOnly(op: JsonOut, keys: readonly string[]): void {
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- C++ removeField
  for (const k of keys) if (k in op) delete op[k];
}

/** Loads a document's text back: the document, or the loader's refusal message. */
export type LoadBack = (text: string) => { readonly doc: LekhDocument } | { readonly message: string };

function codecLoad(ctx: SemanticContext): LoadBack {
  return (text) => {
    try {
      return { doc: ctx.codec.read(text).doc };
    } catch (err) {
      if (isLekhError(err) && err.code !== 'budget_exceeded') return { message: err.message };
      throw err;
    }
  };
}

// ---------------------------------------------------------------- one generation

class Generation {
  private readonly ctx: SemanticContext;
  private readonly contentInput: JsonInput;
  private readonly loadBack: LoadBack;

  private content: JsonObject | null = null;
  private templates: JsonObject | null = null;
  private tree: JsonOut | null = null;

  private name = '';
  private grid = true;
  private scaling = Scaling.default();

  private doc: LekhDocument | null = null;
  private readonly pages: PagePlan[] = [];

  private readonly created = new Map<string, string>();
  private nodeCount = 0;
  private edgeCount = 0;
  private placedCount = 0;
  private objectCount = 0;

  private failed = false;
  private errorCode = '';
  private errorMessage = '';
  private hasErrorPage = false;
  private errorPage = 0;
  private hasErrorIndex = false;
  private errorIsNode = true;
  private errorIndex = 0;

  /** The final document's text and what the load-back made of it, once validated. */
  finalText: string | null = null;
  validated: LekhDocument | null = null;

  constructor(ctx: SemanticContext, content: JsonInput, loadBack: LoadBack) {
    this.ctx = ctx;
    this.contentInput = content;
    this.loadBack = loadBack;
  }

  // ---------------------------------------------------------------- errors

  private fail(code: string, message: string): false {
    if (!this.failed) {
      this.failed = true;
      this.errorCode = code;
      this.errorMessage = message;
    }
    return false;
  }

  private failAtPage(message: string, pageIndex: number): false {
    if (!this.failed) {
      this.fail(INVALID_OPERATION, message);
      this.hasErrorPage = true;
      this.errorPage = pageIndex;
    }
    return false;
  }

  private failIn(code: string, message: string, pageIndex: number, isNode: boolean, index: number): false {
    if (!this.failed) {
      this.fail(code, message);
      this.hasErrorPage = true;
      this.errorPage = pageIndex;
      this.hasErrorIndex = true;
      this.errorIsNode = isNode;
      this.errorIndex = index;
    }
    return false;
  }

  // ---------------------------------------------------------------- envelope

  private parsedContent(): JsonValue | undefined {
    const input = this.contentInput;
    if (typeof input !== 'string') return input;
    try {
      return parseLenientJson(input).value;
    } catch (err) {
      if (isLekhError(err)) return undefined;
      throw err;
    }
  }

  private parseContent(): boolean {
    const parsed = this.parsedContent();
    if (!isJsonObject(parsed)) return this.fail(INVALID_OPERATION, 'the content is not a JSON object');
    const content = parsed;
    this.content = content;

    this.name = stringOf(content, KEY.name) ?? '';
    if (!this.readDocumentAttributes(content)) return false;

    const templates = member(content, K_TEMPLATES);
    if (isJsonObject(templates)) this.templates = templates;

    // A description with no `pages` may carry `nodes` and `edges` at the top level: one page.
    const definitions: JsonObject[] = [];
    const pages = member(content, KEY.pages);
    if (pages !== undefined) {
      if (!Array.isArray(pages)) return this.fail(INVALID_OPERATION, '`pages` must be an array');
      for (const entry of pages as readonly JsonValue[]) {
        if (!isJsonObject(entry)) return this.fail(INVALID_OPERATION, 'a page definition must be an object');
        definitions.push(entry);
      }
      if (definitions.length === 0) {
        return this.fail(
          INVALID_OPERATION,
          '`pages` is empty: give at least one page, or put `nodes` and `edges` at the top level for a single-page board',
        );
      }
    } else {
      definitions.push(content);
    }

    for (let i = 0; i < definitions.length; i++) {
      const definition = definitions[i] as JsonObject;
      const plan: PagePlan = {
        definition,
        page: null,
        id: '',
        nodes: [],
        edges: [],
        shapes: [],
        groups: [],
        levels: [],
        plans: [],
        anyAutoPlaced: false,
      };

      const nodes = member(definition, KEY.nodes);
      if (nodes !== undefined) {
        if (!Array.isArray(nodes)) return this.fail(INVALID_OPERATION, '`nodes` must be an array');
        for (const entry of nodes as readonly JsonValue[]) {
          if (!isJsonObject(entry)) return this.fail(INVALID_OPERATION, 'a node must be an object');
          plan.nodes.push(entry);
        }
      }

      const edges = member(definition, KEY.edges);
      if (edges !== undefined) {
        if (!Array.isArray(edges)) return this.fail(INVALID_OPERATION, '`edges` must be an array');
        for (const entry of edges as readonly JsonValue[]) {
          if (!isJsonObject(entry)) return this.fail(INVALID_OPERATION, 'an edge must be an object');
          plan.edges.push(entry);
        }
      }

      // A node with `children` is a group plan rather than a shape; the key alone declares it.
      for (let n = 0; n < plan.nodes.length; n++) {
        const node = plan.nodes[n] as JsonObject;
        const children = member(node, KEY.children);
        if (children === undefined) {
          const cx = numberValue(member(node, KEY.cx));
          const cy = numberValue(member(node, KEY.cy));
          const np: NodePlan = {
            source: node,
            hasCx: cx !== undefined,
            hasCy: cy !== undefined,
            cx: cx ?? 0,
            cy: cy ?? 0,
            halfW: 0,
            halfH: 0,
            placed: false,
          };
          if (!np.hasCx || !np.hasCy) plan.anyAutoPlaced = true;
          plan.shapes.push(n);
          plan.plans.push(np);
          continue;
        }

        const ban = groupNodeBan(node);
        if (ban !== '') return this.failIn(INVALID_OPERATION, ban, i, true, n);

        if (!Array.isArray(children)) {
          return this.failIn(
            INVALID_OPERATION,
            `\`${KEY.children}\` must be an array of the ids of the nodes this group contains`,
            i,
            true,
            n,
          );
        }

        const gp: GroupPlan = { nodeIndex: n, ref: effectiveRef(node), childNames: [], childGroups: [], height: 0 };
        for (const entry of children as readonly JsonValue[]) {
          if (typeof entry !== 'string' || entry === '') {
            return this.failIn(
              INVALID_OPERATION,
              `every entry of \`${KEY.children}\` is the id of a node on this page`,
              i,
              true,
              n,
            );
          }
          gp.childNames.push(entry);
        }
        plan.groups.push(gp);
      }

      this.nodeCount += plan.nodes.length;
      this.edgeCount += plan.edges.length;
      this.pages.push(plan);
    }

    // A ref names one node across the whole board (`ref`, else `id`).
    const firstUse = new Map<string, readonly [number, number]>();
    for (let p = 0; p < this.pages.length; p++) {
      const nodes = (this.pages[p] as PagePlan).nodes;
      for (let n = 0; n < nodes.length; n++) {
        const ref = effectiveRef(nodes[n] as JsonObject);
        if (ref === '') continue;
        const found = firstUse.get(ref);
        if (found !== undefined) {
          return this.failIn(
            INVALID_OPERATION,
            `ref "${ref}" is already used by page ${String(found[0])} node ${String(found[1])}; refs name one node across the whole board`,
            p,
            true,
            n,
          );
        }
        firstUse.set(ref, [p, n]);
      }
    }

    // An edge's `ref` may not repeat a node's ref anywhere on the board, nor another edge's.
    const firstEdgeUse = new Map<string, readonly [number, number]>();
    for (let p = 0; p < this.pages.length; p++) {
      const edges = (this.pages[p] as PagePlan).edges;
      for (let e = 0; e < edges.length; e++) {
        const ref = stringOf(edges[e], K_REF);
        if (ref === undefined || ref === '') continue;
        const node = firstUse.get(ref);
        const edge = firstEdgeUse.get(ref);
        if (node !== undefined || edge !== undefined) {
          const byNode = node !== undefined;
          const at = (node ?? edge) as readonly [number, number];
          return this.failIn(
            INVALID_OPERATION,
            `ref "${ref}" is already used by page ${String(at[0])}${byNode ? ' node ' : ' edge '}${String(at[1])}; refs name one object across the whole board`,
            p,
            false,
            e,
          );
        }
        firstEdgeUse.set(ref, [p, e]);
      }
    }

    return this.planGroups(firstUse);
  }

  /** The checks the compiler cannot do (cycles, two parents, the depth cap), and the order the `group` ops go in. */
  private planGroups(firstUse: ReadonlyMap<string, readonly [number, number]>): boolean {
    for (let p = 0; p < this.pages.length; p++) {
      const plan = this.pages[p] as PagePlan;
      if (plan.groups.length === 0) continue;

      const groupByNode = new Map<number, number>();
      for (let g = 0; g < plan.groups.length; g++) groupByNode.set((plan.groups[g] as GroupPlan).nodeIndex, g);

      const claimedBy = new Map<string, number>();
      for (let g = 0; g < plan.groups.length; g++) {
        const gp = plan.groups[g] as GroupPlan;
        for (const spelled of gp.childNames) {
          const use = firstUse.get(spelled);
          if (use !== undefined && use[0] !== p) {
            return this.failIn(
              INVALID_OPERATION,
              `"${spelled}" is on page ${String(use[0])}, and a group's members must be on the same page as the group that names them`,
              p,
              true,
              gp.nodeIndex,
            );
          }
          const prior = claimedBy.get(spelled);
          if (prior !== undefined) {
            return this.failIn(
              INVALID_OPERATION,
              `"${spelled}" is named as a child by ${groupLabel(plan.groups[prior] as GroupPlan)} and by ${groupLabel(gp)}; a node belongs to one group, so one of the two \`children\` lists must give it up`,
              p,
              true,
              gp.nodeIndex,
            );
          }
          claimedBy.set(spelled, g);
          if (use === undefined) continue;
          const inner = groupByNode.get(use[1]);
          if (inner !== undefined) gp.childGroups.push(inner);
        }
      }

      const mark: number[] = plan.groups.map(() => 0);
      for (let g = 0; g < plan.groups.length; g++) {
        if (mark[g] !== 0) continue;
        const path: number[] = [];
        const cycle: number[] = [];
        if (findGroupCycle(plan.groups, g, mark, path, cycle)) {
          let names = cycle.map((at) => groupLabel(plan.groups[at] as GroupPlan)).join(' -> ');
          if (cycle.length > 1) names += ' -> ' + groupLabel(plan.groups[cycle[0] as number] as GroupPlan);
          return this.failIn(
            INVALID_OPERATION,
            `\`${KEY.children}\` closes a cycle: ${names}; a group cannot contain itself, directly or through its members`,
            p,
            true,
            (plan.groups[cycle[0] as number] as GroupPlan).nodeIndex,
          );
        }
      }

      let deepest = 0;
      for (let g = 0; g < plan.groups.length; g++) {
        const height = groupPlanHeight(plan.groups, g);
        if (height > MAX_GROUP_DEPTH) {
          return this.failIn(
            INVALID_OPERATION,
            `this content nests groups ${String(height)} deep; this surface carries ${String(MAX_GROUP_DEPTH)}`,
            p,
            true,
            (plan.groups[g] as GroupPlan).nodeIndex,
          );
        }
        if (height > deepest) deepest = height;
      }

      // Bucketed by height, innermost first: groups of one height touch disjoint objects.
      plan.levels = Array.from({ length: deepest }, () => []);
      for (let g = 0; g < plan.groups.length; g++) {
        (plan.levels[(plan.groups[g] as GroupPlan).height - 1] as number[]).push(g);
      }
    }
    return true;
  }

  /** The document's `grid` and `scaling`, in the shape the read reports them. */
  private readDocumentAttributes(content: JsonObject): boolean {
    const grid = member(content, K_GRID);
    if (grid !== undefined) {
      const present = isJsonObject(grid) ? member(grid, KEY.present) : grid;
      if (typeof present !== 'boolean') {
        return this.fail(INVALID_OPERATION, 'grid is {"present": true} or {"present": false}');
      }
      this.grid = present;
    }

    const scaling = member(content, KEY.scaling);
    if (scaling !== undefined) {
      const scale = isJsonObject(scaling) ? numberValue(member(scaling, KEY.scale)) : undefined;
      if (scale === undefined || !(scale > 0)) return this.fail(INVALID_OPERATION, 'scaling needs a positive `scale`');
      const u = readUnit(scaling, Unit.Point);
      if (u.refusal !== '') return this.fail(INVALID_OPERATION, u.refusal);
      this.scaling = new Scaling(u.unit, scale);
    }
    return true;
  }

  // ---------------------------------------------------------------- skeleton

  /** The pages, and nothing on them, built with the `Page` API directly. */
  private buildSkeleton(): boolean {
    const doc = new LekhDocument(this.ctx.codec.env.document);
    doc.name = this.name;
    doc.grid.present = this.grid;
    doc.scaling = this.scaling;
    this.doc = doc;

    const pages: Page[] = [];
    for (let i = 0; i < this.pages.length; i++) {
      const plan = this.pages[i] as PagePlan;
      const definition = plan.definition;
      const pageId = this.ctx.newId();
      // The page's name comes from its own definition, never from the envelope.
      const pageName = definition !== this.content ? (stringOf(definition, KEY.name) ?? '') : '';
      const page = new Page(pageId, pageName !== '' ? pageName : `Page ${String(i + 1)}`, doc.storeOptions);
      page.order = i + 1;

      if (!this.readCanvas(definition, i, page)) return false;
      if (!this.readMargin(definition, i, page)) return false;

      const background = member(definition, KEY.background);
      if (isJsonObject(background)) {
        const hex = stringOf(background, KEY.color);
        if (hex !== undefined && hex !== '') {
          const color = hexToColor(hex);
          if (color === null) {
            return this.fail(INVALID_OPERATION, `"${hex}" is not a colour; use #rgb, #rrggbb or #rrggbbaa`);
          }
          page.background.setColor(color);
        }
      }

      plan.page = page;
      plan.id = pageId;
      pages.push(page);
    }

    doc.setPages(pages);
    for (const plan of this.pages) {
      if (doc.getPage(plan.id) === null) return this.fail(PAGE_NOT_FOUND, `page "${plan.id}" did not take`);
    }
    return true;
  }

  /** A page's `canvas`, by resize_page's and add_page's rules. */
  private readCanvas(definition: JsonObject, pageIndex: number, page: Page): boolean {
    let sizeType: CanvasSizeType = CanvasSizeType.Infinite;
    let width = 0;
    let height = 0;
    let unit: Unit = Unit.Point;
    let canvasName = '';

    const canvasNode = member(definition, KEY.canvas);
    if (isJsonObject(canvasNode)) {
      const typeName = stringOf(canvasNode, KEY.type);
      if (typeName !== undefined && typeName !== '') {
        const t = canvasTypeFromName(typeName);
        if (t === null) return this.fail(INVALID_OPERATION, canvasTypeMessage(typeName));
        sizeType = t;
      }
      const w = numberValue(member(canvasNode, KEY.width));
      if (w !== undefined) width = w;
      const h = numberValue(member(canvasNode, KEY.height));
      if (h !== undefined) height = h;

      const u = readUnit(canvasNode, unit);
      if (u.refusal !== '') return this.failAtPage(u.refusal, pageIndex);
      unit = u.unit;

      const name = member(canvasNode, KEY.name);
      if (name !== undefined) {
        if (typeof name !== 'string') return this.failAtPage('canvas name is a string', pageIndex);
        canvasName = name;
      }

      if (
        sizeType !== CanvasSizeType.Fixed &&
        ((w !== undefined && width !== 0) || (h !== undefined && height !== 0))
      ) {
        return this.failAtPage(noSizeMessage(sizeType), pageIndex);
      }
    }
    // A fixed page without a positive size would load back as `auto`.
    if (sizeType === CanvasSizeType.Fixed && !(width > 0 && height > 0)) {
      return this.failAtPage(FIXED_CANVAS_NEEDS_SIZE, pageIndex);
    }
    page.canvasSizeType = sizeType;
    page.size = new PageSize(unit, width, height);
    page.canvasName = canvasName;
    return true;
  }

  /** A page's `margin`, in the read's shape (per-side insets `left_right`, `top_bottom`). */
  private readMargin(definition: JsonObject, pageIndex: number, page: Page): boolean {
    const margin = member(definition, KEY.margin);
    if (margin === undefined) return true;
    const needs = 'a page margin needs left_right and top_bottom greater than 0; for no margin, leave `margin` out';
    if (!isJsonObject(margin)) return this.failAtPage(needs, pageIndex);

    const vocabulary: MemberVocabulary = {
      allowed: [KEY.leftRight, KEY.topBottom, KEY.unit],
      refusal: (m: string) => {
        if (m === 'width' || m === 'height') {
          return 'a page margin takes left_right and top_bottom (the inset on each side), not width and height';
        }
        return `a page margin has no member "${m}"; it takes left_right, top_bottom and unit`;
      },
    };
    const unknown = refuseUnknownMembers(margin, vocabulary, KEY.margin);
    if (unknown !== '') return this.failAtPage(unknown, pageIndex);

    const leftRight = numberValue(member(margin, KEY.leftRight));
    const topBottom = numberValue(member(margin, KEY.topBottom));
    if (leftRight === undefined || topBottom === undefined || !(leftRight > 0) || !(topBottom > 0)) {
      return this.failAtPage(needs, pageIndex);
    }
    const u = readUnit(margin, page.size.unit);
    if (u.refusal !== '') return this.failAtPage(u.refusal, pageIndex);

    const stored: PageMargin = { show: true, size: new PageSize(u.unit, leftRight, topBottom) };
    page.margin = stored;
    return true;
  }

  // ---------------------------------------------------------------- sizing

  /**
   * Round one: what size is each node going to be? The nodes are compiled once with no
   * placement, purely to read the geometry back. Skipped when every node names both coordinates.
   */
  private sizePage(plan: PagePlan, pageIndex: number): boolean {
    if (!plan.anyAutoPlaced || plan.shapes.length === 0) return true;

    const spec: BatchSpec = { withAdds: true, withPlacement: false, withEdges: false, groups: null };
    const compiled = compileToNode(withDocument(this.ctx, this.doc as LekhDocument), this.buildBatch(plan, spec));
    const taken = this.takeCompiled(compiled, plan, pageIndex, spec);
    if (taken === null) return false;
    const changes = member(taken.frames[0], C_CHANGES);

    for (let i = 0; i < plan.plans.length; i++) {
      const np = plan.plans[i] as NodePlan;
      const added = taken.added[i];
      const path = `${C_DOC}.${C_PAGES}.${plan.id}.${C_OBJECTS}.${typeof added === 'string' ? added : ''}`;
      const object = member(changes, path);
      const params = member(object, C_PARAMS);
      if (params === undefined) {
        return this.failIn(
          INVALID_OPERATION,
          'internal: the compiler built no geometry for this node',
          pageIndex,
          true,
          plan.shapes[i] as number,
        );
      }
      const width = numberValue(member(params, 'width')) ?? 0;
      const height = numberValue(member(params, 'height')) ?? 0;
      const angle = numberValue(member(params, 'angle')) ?? 0;
      // RADIANS, as stored.
      const half = placementHalfExtents(width, height, angle);
      np.halfW = half.halfW;
      np.halfH = half.halfH;
    }
    return true;
  }

  // ---------------------------------------------------------------- placement

  /**
   * Placement for a node with no coordinates: below the previous node in the batch, then pushed
   * until its box overlaps nothing on the page. Deterministic. Group nodes never reach here.
   */
  private placePage(plan: PagePlan): void {
    const taken: PlacementBox[] = [];
    for (const np of plan.plans) {
      if (np.hasCx && np.hasCy) taken.push(placementBoxAt(np.cx, np.cy, np.halfW, np.halfH));
    }

    for (let i = 0; i < plan.plans.length; i++) {
      const np = plan.plans[i] as NodePlan;
      if (np.hasCx && np.hasCy) continue;
      const prev = i > 0 ? (plan.plans[i - 1] as NodePlan) : null;
      if (!np.hasCx) np.cx = prev !== null ? prev.cx : PLACEMENT_MARGIN + np.halfW;
      if (!np.hasCy) {
        np.cy = prev !== null ? prev.cy + prev.halfH + PLACEMENT_GAP + np.halfH : PLACEMENT_MARGIN + np.halfH;
      }
      np.placed = true;
      this.placedCount++;
      // Down when the agent chose no `cy`; across when it chose one and left `cx` to us.
      const at = placementPushClear({ cx: np.cx, cy: np.cy }, np.halfW, np.halfH, !np.hasCy, taken);
      np.cx = at.cx;
      np.cy = at.cy;
      taken.push(placementBoxAt(np.cx, np.cy, np.halfW, np.halfH));
    }
  }

  // ---------------------------------------------------------------- the batch

  /** The adds for the real shapes, then the edges, then the `group` operations innermost first. */
  private buildBatch(plan: PagePlan, spec: BatchSpec): JsonOut {
    const batch: JsonOut = { [KEY.version]: 0, [K_PAGE]: plan.id };
    if (this.templates !== null) batch[K_TEMPLATES] = cloneValue(this.templates);

    const ops: JsonValue[] = [];
    const adds = addCount(spec, plan);
    for (let i = 0; i < adds; i++) {
      const op: JsonOut = { ...cloneValue(plan.nodes[plan.shapes[i] as number] as JsonObject) };
      op[K_OP] = K_ADD_NODE;
      // A node's `id` doubles as its `ref`.
      const ref = stringOf(op, K_REF);
      if (ref === undefined || ref === '') {
        const id = stringOf(op, KEY.id);
        if (id !== undefined && id !== '') op[K_REF] = id;
      }
      stripProjectionOnly(op, PROJECTION_ONLY_NODE_KEYS);
      if (spec.withPlacement) {
        const np = plan.plans[i] as NodePlan;
        op[KEY.cx] = np.cx;
        op[KEY.cy] = np.cy;
      }
      ops.push(op);
    }
    if (spec.withEdges) {
      for (const edge of plan.edges) {
        const op: JsonOut = { ...cloneValue(edge) };
        op[K_OP] = K_ADD_EDGE;
        stripProjectionOnly(op, PROJECTION_ONLY_EDGE_KEYS);
        ops.push(op);
      }
    }
    if (spec.groups !== null) {
      for (const at of spec.groups) {
        const gp = plan.groups[at] as GroupPlan;
        const groupOp: JsonOut = { [K_OP]: K_GROUP };
        if (gp.ref !== '') groupOp[K_REF] = gp.ref;
        // A member of the first batch is named by its ref; of a later batch, by the minted id.
        groupOp[KEY.nodes] = gp.childNames.map((name) => (spec.withAdds ? name : (this.created.get(name) ?? name)));
        ops.push(groupOp);
      }
    }
    batch[K_OPS] = ops;
    return batch;
  }

  /**
   * The compiler's answer, checked: a refusal is passed through with the op index translated
   * into the page and the node or edge it belongs to. null on a refusal (recorded).
   */
  private takeCompiled(
    compiled: JsonObject,
    plan: PagePlan,
    pageIndex: number,
    spec: BatchSpec,
  ): { frames: readonly JsonValue[]; added: readonly JsonValue[] } | null {
    const adds = addCount(spec, plan);
    const edges = edgeCount(spec, plan);
    const groups = groupCount(spec);

    if (boolOf(compiled, K_OK) !== true) {
      let code = stringOf(compiled, K_ERROR) ?? '';
      const message = stringOf(compiled, K_MESSAGE) ?? '';
      if (code === '') code = INVALID_OPERATION;
      const at = numberValue(member(compiled, K_OP));
      if (at !== undefined && at >= 0) {
        const index = Math.trunc(at);
        if (index < adds) {
          this.failIn(code, message, pageIndex, true, plan.shapes[index] as number);
          return null;
        }
        if (index < adds + edges) {
          this.failIn(code, message, pageIndex, false, index - adds);
          return null;
        }
        if (index < adds + edges + groups && spec.groups !== null) {
          const g = plan.groups[spec.groups[index - adds - edges] as number] as GroupPlan;
          this.failIn(code, message, pageIndex, true, g.nodeIndex);
          return null;
        }
      }
      this.fail(code, message);
      this.hasErrorPage = true;
      this.errorPage = pageIndex;
      return null;
    }

    // Exactly one `addobjects` frame, and one `convertobjects` frame when the page has groups.
    const wanted: string[] = [];
    if (adds + edges > 0) wanted.push(ADD_OBJECTS);
    if (groups > 0) wanted.push(CONVERT_OBJECTS);

    const frames = member(compiled, K_FRAMES);
    if (!Array.isArray(frames) || frames.length !== wanted.length) {
      this.failIn(
        INVALID_OPERATION,
        `internal: a generated page compiled to ${String(Array.isArray(frames) ? frames.length : 0)} frames rather than ${String(wanted.length)}`,
        pageIndex,
        true,
        0,
      );
      return null;
    }
    const list = frames as readonly JsonValue[];
    for (let i = 0; i < list.length; i++) {
      const expected = wanted[i] as string;
      const frame = list[i];
      const type = stringOf(frame, C_TYPE);
      if (type !== expected) {
        this.failIn(
          INVALID_OPERATION,
          `internal: a generated page compiled to a "${type ?? ''}" frame rather than an "${expected}" one`,
          pageIndex,
          true,
          0,
        );
        return null;
      }
      if (member(frame, C_CHANGES) === undefined) {
        this.failIn(
          INVALID_OPERATION,
          'internal: a generated page compiled to a frame with no changes',
          pageIndex,
          true,
          0,
        );
        return null;
      }
    }

    const added = member(compiled, K_ADDED);
    if (!Array.isArray(added) || added.length < adds + groups) {
      this.failIn(
        INVALID_OPERATION,
        'internal: the compiler reported fewer objects than the batch asked for',
        pageIndex,
        true,
        0,
      );
      return null;
    }

    const created = member(compiled, K_CREATED);
    if (isJsonObject(created)) {
      for (const k of sortedKeys(created)) {
        const v = created[k];
        if (typeof v === 'string') this.created.set(k, v);
      }
    }
    return { frames: list, added: added as readonly JsonValue[] };
  }

  // ---------------------------------------------------------------- assembly

  /** Compiles one batch against `base` and merges its frames, frame by frame, into the tree. */
  private compileInto(plan: PagePlan, pageIndex: number, base: LekhDocument, spec: BatchSpec): boolean {
    const compiled = compileToNode(withDocument(this.ctx, base), this.buildBatch(plan, spec));
    const taken = this.takeCompiled(compiled, plan, pageIndex, spec);
    if (taken === null) return false;
    const tree = this.tree as JsonOut;
    for (const frame of taken.frames) {
      const changes = member(frame, C_CHANGES);
      if (!isJsonObject(changes)) continue;
      for (const path of sortedKeys(changes)) {
        if (!setAtPath(tree, path, cloneValue(changes[path] as JsonValue))) {
          return this.failIn(
            INVALID_OPERATION,
            `internal: a frame named the path "${path}", which is not inside the document`,
            pageIndex,
            true,
            0,
          );
        }
      }
    }
    return true;
  }

  /**
   * One batch per level of nesting: the groups go in height buckets, innermost first, each later
   * bucket compiled against the document assembled so far, loaded back.
   */
  private assemblePage(plan: PagePlan, pageIndex: number): boolean {
    if (plan.nodes.length === 0 && plan.edges.length === 0) return true;

    const first: BatchSpec = {
      withAdds: true,
      withPlacement: true,
      withEdges: true,
      groups: plan.levels.length > 0 ? (plan.levels[0] as number[]) : null,
    };
    if (!this.compileInto(plan, pageIndex, this.doc as LekhDocument, first)) return false;

    for (let level = 1; level < plan.levels.length; level++) {
      const loaded = codecLoad(this.ctx)(writeJsonText(this.tree));
      if (!('doc' in loaded)) {
        const firstGroup = plan.groups[(plan.levels[level] as number[])[0] as number] as GroupPlan;
        return this.failIn(
          INVALID_OPERATION,
          `the document did not load back between the levels of a nested group: ${loaded.message === '' ? 'no document' : loaded.message}`,
          pageIndex,
          true,
          firstGroup.nodeIndex,
        );
      }
      const next: BatchSpec = {
        withAdds: false,
        withPlacement: false,
        withEdges: false,
        groups: plan.levels[level] as number[],
      };
      if (!this.compileInto(plan, pageIndex, loaded.doc, next)) return false;
    }
    return true;
  }

  /**
   * Load it back: "is this a valid board?" is a `load` call. The object count is checked, because
   * the loader drops a connector whose endpoints it cannot resolve rather than refusing it.
   */
  private validate(): boolean {
    const finalText = writeJsonText(this.tree);
    const loaded = this.loadBack(finalText);
    if (!('doc' in loaded)) {
      return this.fail(
        INVALID_OPERATION,
        `the generated document did not load back: ${loaded.message === '' ? 'no document' : loaded.message}`,
      );
    }
    const doc = loaded.doc;
    if (doc.pages.length !== this.pages.length) {
      return this.fail(
        INVALID_OPERATION,
        `the generated document loaded with ${String(doc.pages.length)} page(s) rather than ${String(this.pages.length)}`,
      );
    }

    // Counted into the groups: a group's members are not top-level objects.
    this.objectCount = 0;
    for (const page of doc.pages) {
      for (const obj of page.objectStore.objects) {
        this.objectCount++;
        if (obj instanceof GroupObject) this.objectCount += countInGroup(obj);
      }
    }
    if (this.objectCount !== this.nodeCount + this.edgeCount) {
      return this.fail(
        INVALID_OPERATION,
        `the generated document loaded with ${String(this.objectCount)} object(s) rather than the ${String(this.nodeCount + this.edgeCount)} it was built from: an edge whose endpoints do not resolve is dropped by the loader rather than refused`,
      );
    }

    // A document's name is not part of its serialization; the loaded one carries the content's.
    doc.name = this.name;
    this.validated = doc;
    this.finalText = finalText;
    return true;
  }

  // ---------------------------------------------------------------- run

  private build(): boolean {
    for (let i = 0; i < this.pages.length; i++) {
      this.ctx.budgetCheck();
      if (!this.sizePage(this.pages[i] as PagePlan, i)) return false;
      this.placePage(this.pages[i] as PagePlan);
    }

    const skeleton = this.ctx.codec.serialize(this.doc as LekhDocument, {
      stamp: 'cloud',
      help: (id) => this.ctx.catalog.help(id),
    });
    const tree: unknown = JSON.parse(skeleton);
    if (!isJsonObject(tree)) return this.fail(INVALID_OPERATION, 'internal: the page skeleton did not serialize');
    this.tree = tree;

    for (let i = 0; i < this.pages.length; i++) {
      this.ctx.budgetCheck();
      if (!this.assemblePage(this.pages[i] as PagePlan, i)) return false;
    }
    return this.validate();
  }

  run(): JsonOut {
    if (this.parseContent() && this.buildSkeleton()) this.build();

    if (this.failed) {
      // Nothing is handed back when a description is refused, and in particular no document.
      this.finalText = null;
      this.validated = null;
      const root: JsonOut = { [K_OK]: false, [K_ERROR]: this.errorCode, [K_MESSAGE]: this.errorMessage };
      if (this.hasErrorPage) root[K_PAGE] = this.errorPage;
      if (this.hasErrorIndex) root[this.errorIsNode ? K_NODE : K_EDGE] = this.errorIndex;
      return root;
    }

    const created: JsonOut = {};
    for (const k of [...this.created.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      created[k] = this.created.get(k) as string;
    }
    return {
      [K_OK]: true,
      [KEY.name]: this.name,
      [KEY.pages]: this.pages.map((plan) => ({
        [KEY.id]: plan.id,
        [KEY.name]: (plan.page as Page).name,
        [KEY.order]: (plan.page as Page).order,
        [K_NODE_COUNT]: plan.nodes.length,
        [K_EDGE_COUNT]: plan.edges.length,
      })),
      [K_CREATED]: created,
      [K_NODE_COUNT]: this.nodeCount,
      [K_EDGE_COUNT]: this.edgeCount,
      [K_PLACED]: this.placedCount,
      [K_OBJECT_COUNT]: this.objectCount,
    };
  }
}

// ---------------------------------------------------------------- entry points

/** What one generation produced: the answer, and on success the stored text and its loaded document. */
export interface GenerateResult {
  readonly answer: JsonOut;
  /** The document's JSON text as assembled and validated (`null` on a refusal). */
  readonly finalText: string | null;
  /** What the load-back made of `finalText` (`null` on a refusal). */
  readonly validated: LekhDocument | null;
}

/**
 * C++ `SemanticGenerator::generateToNode`. The load-back that validates goes through `loadBack`
 * (default: the session's codec, which leaves the session untouched).
 */
export function generateToNode(ctx: SemanticContext, content: JsonInput, loadBack?: LoadBack): GenerateResult {
  const g = new Generation(ctx, content, loadBack ?? codecLoad(ctx));
  const answer = g.run();
  return { answer, finalText: g.finalText, validated: g.validated };
}

/**
 * A whole board from a semantic description. On success the session holds the document that came
 * back out of the loader (the validating load is the session's own `load`), so `serialize` answers
 * the bytes to write and a draw shows what a create would store; the answer carries `ok`.
 *
 * Unlike the C++ handle, a refused generation cannot leave the session "holding nothing": a refusal
 * before the load-back leaves the session as it was, and one at the object-count check leaves it
 * holding the loaded (rejected) document. A caller serializes only after `ok: true`.
 */
export function generate(s: SemanticHost, content: JsonInput): JsonObject {
  const ctx = s.semanticContext();
  const { answer } = generateToNode(ctx, content, (text) => {
    const r = s.load(text);
    if (!r.ok) return { message: r.message };
    return { doc: s.semanticContext().doc };
  });
  return answer;
}
