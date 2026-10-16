// The layout lint (port of C++ `semantic/SemanticLint.{h,cpp}`): possible layout problems on one
// page of a loaded document, warn-only (/backend/subsystems/mcp/format-engine.md §10). The pass
// runs in the order the issues are reported: shape_overlap, text_overflow, text_overlap,
// title_overlap, edge_label_overflow, edge_label_overlap, edge_through_shape.
//
// The vocabulary:
// - A NODE is every leaf object on the page that is not a connector, at any group depth. Its BOX
//   is its selection rectangle (the axis-aligned bounds of a rotated one), never its title.
// - A CONTAINER or SEE-THROUGH node is one whose template id is in the options' `containers` /
//   `see_through`. A FLOATING TEXT node is an `avabodh.basic.text`.
// - An OBSTACLE is a node that is none of the three. Only obstacles stop connectors, labels,
//   floating text and titles.
// - Floating text takes part in text_overlap only.
//
// Every pairwise check goes through a uniform grid (`Grid`), so a large page costs its neighbours.
// No template id is hard-coded except `avabodh.basic.text`; every exemption arrives in the options.
import type { BezierCurve, Point } from '../geometry';
import { Rect, Size, getDistance, rotate, type LineSegment } from '../geometry';
import {
  isConnector,
  isGroup,
  type ConnectionObject,
  type GroupObject,
  type LekhObject,
  type TemplatedObject,
} from '../model';
import { Style, TextAlignHorizontal } from '../style';
import { DEFAULT_ROW_COL, TextSide, textEditRect, type ShapeTextElement, type TextBoxParam } from '../template';
import type { JsonInput, SemanticContext, SemanticHost } from './context';
import { g6, isJsonObject, type JsonObject, type JsonOut, type JsonValue } from './json';

/** The floating-text node: it names a kind of node, not an exemption, so it is not an option. */
const TEXT_TEMPLATE_ID = 'avabodh.basic.text';
/** Slack for comparing measured lengths: a text exactly as wide as its slot fits. */
const EPS = 0.01;
/** A connector passes through a box only when it enters the box shrunk by this much. */
const GRAZE = 0.5;
/** Segments a Bézier is cut into for its length and its crossings. */
const CURVE_STEPS = 32;
/** The objects between two budget checks. */
const BUDGET_EVERY = 256;

const Kind = Object.freeze({
  ShapeOverlap: 0,
  TextOverflow: 1,
  TextOverlap: 2,
  TitleOverlap: 3,
  EdgeLabelOverflow: 4,
  EdgeLabelOverlap: 5,
  EdgeThroughShape: 6,
} as const);
type Kind = (typeof Kind)[keyof typeof Kind];

const KIND_NAMES: readonly string[] = Object.freeze([
  'shape_overlap',
  'text_overflow',
  'text_overlap',
  'title_overlap',
  'edge_label_overflow',
  'edge_label_overlap',
  'edge_through_shape',
]);

// ------------------------------------------------------------------ boxes

interface Box {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
}

const boxWidth = (b: Box): number => b.maxx - b.minx;
const boxHeight = (b: Box): number => b.maxy - b.miny;
const boxArea = (b: Box): number => boxWidth(b) * boxHeight(b);
const emptyBox = (): Box => ({ minx: 0, miny: 0, maxx: 0, maxy: 0 });

function boxOf(r: Rect): Box {
  return { minx: r.x, miny: r.y, maxx: r.x + r.width, maxy: r.y + r.height };
}

function boxOfPoints(pts: readonly Point[]): Box {
  let b = emptyBox();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Point;
    if (i === 0) {
      b = { minx: p.x, miny: p.y, maxx: p.x, maxy: p.y };
      continue;
    }
    b.minx = Math.min(b.minx, p.x);
    b.miny = Math.min(b.miny, p.y);
    b.maxx = Math.max(b.maxx, p.x);
    b.maxy = Math.max(b.maxy, p.y);
  }
  return b;
}

function include(b: Box, other: Box): void {
  b.minx = Math.min(b.minx, other.minx);
  b.miny = Math.min(b.miny, other.miny);
  b.maxx = Math.max(b.maxx, other.maxx);
  b.maxy = Math.max(b.maxy, other.maxy);
}

/** The overlap of two boxes, or null unless it has an area (touching edges do not overlap). */
function overlap(a: Box, b: Box): Box | null {
  const r: Box = {
    minx: Math.max(a.minx, b.minx),
    miny: Math.max(a.miny, b.miny),
    maxx: Math.min(a.maxx, b.maxx),
    maxy: Math.min(a.maxy, b.maxy),
  };
  return boxWidth(r) <= 0 || boxHeight(r) <= 0 ? null : r;
}

/** Closed intersection, for the `within` filter: touching counts. */
function touches(a: Box, b: Box): boolean {
  return a.minx <= b.maxx && b.minx <= a.maxx && a.miny <= b.maxy && b.miny <= a.maxy;
}

function containsBox(outer: Box, inner: Box): boolean {
  return (
    inner.minx >= outer.minx - EPS &&
    inner.miny >= outer.miny - EPS &&
    inner.maxx <= outer.maxx + EPS &&
    inner.maxy <= outer.maxy + EPS
  );
}

/** Whether the segment enters the open interior of `b` (Liang–Barsky on the box shrunk by GRAZE). */
function segmentCrosses(p: Point, q: Point, b: Box): boolean {
  const minx = b.minx + GRAZE;
  const miny = b.miny + GRAZE;
  const maxx = b.maxx - GRAZE;
  const maxy = b.maxy - GRAZE;
  if (minx >= maxx || miny >= maxy) return false;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const pp = [-dx, dx, -dy, dy];
  const qq = [p.x - minx, maxx - p.x, p.y - miny, maxy - p.y];
  for (let i = 0; i < 4; i++) {
    const pi = pp[i] as number;
    const qi = qq[i] as number;
    if (pi === 0) {
      if (qi <= 0) return false;
      continue;
    }
    const t = qi / pi;
    if (pi < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return true;
}

/**
 * A uniform grid over a fixed list of boxes, for the pairwise checks. The cell is the mean of the
 * boxes' larger sides; a box spanning more than MAX_SPAN cells on a side is kept aside and offered
 * to every query. Candidates are offered in the C++ order (big boxes, then cell by cell).
 */
const MAX_SPAN = 64;

class Grid {
  private readonly boxes_: readonly Box[];
  private readonly stamp_: number[];
  private tick_ = 0;
  private readonly cell_: number;
  private readonly cells_ = new Map<string, number[]>();
  private readonly big_: number[] = [];

  constructor(boxes: readonly Box[]) {
    this.boxes_ = boxes;
    this.stamp_ = new Array<number>(boxes.length).fill(0);
    let sum = 0;
    for (const b of boxes) sum += Math.max(boxWidth(b), boxHeight(b));
    this.cell_ = boxes.length === 0 ? 1 : Math.max(8, sum / boxes.length);
    for (let i = 0; i < boxes.length; i++) {
      const s = this.span(boxes[i] as Box);
      if (s.x1 - s.x0 >= MAX_SPAN || s.y1 - s.y0 >= MAX_SPAN) {
        this.big_.push(i);
        continue;
      }
      for (let x = s.x0; x <= s.x1; x++) {
        for (let y = s.y0; y <= s.y1; y++) {
          const k = Grid.key(x, y);
          let cell = this.cells_.get(k);
          if (cell === undefined) {
            cell = [];
            this.cells_.set(k, cell);
          }
          cell.push(i);
        }
      }
    }
  }

  /** Calls `fn(index)` once for every box that may touch `b`; the caller tests the geometry. */
  query(b: Box, fn: (i: number) => void): void {
    this.tick_++;
    const tick = this.tick_;
    const offer = (i: number): void => {
      if (this.stamp_[i] === tick) return;
      this.stamp_[i] = tick;
      fn(i);
    };
    for (const i of this.big_) offer(i);
    const s = this.span(b);
    if (s.x1 - s.x0 >= MAX_SPAN || s.y1 - s.y0 >= MAX_SPAN) {
      for (let i = 0; i < this.boxes_.length; i++) offer(i);
      return;
    }
    for (let x = s.x0; x <= s.x1; x++) {
      for (let y = s.y0; y <= s.y1; y++) {
        const cell = this.cells_.get(Grid.key(x, y));
        if (cell === undefined) continue;
        for (const i of cell) offer(i);
      }
    }
  }

  private span(b: Box): { x0: number; y0: number; x1: number; y1: number } {
    return {
      x0: Math.floor(b.minx / this.cell_),
      y0: Math.floor(b.miny / this.cell_),
      x1: Math.floor(b.maxx / this.cell_),
      y1: Math.floor(b.maxy / this.cell_),
    };
  }

  private static key(x: number, y: number): string {
    return `${String(x)},${String(y)}`;
  }
}

// ------------------------------------------------------------------ options

interface LintOptions {
  pageId: string;
  only: Set<string>;
  within: Box | null;
  containers: Set<string>;
  seeThrough: Set<string>;
  /** Both orders stored, as `a\u0000b`. */
  overlays: Set<string>;
  tolerance: number;
  max: number;
  overlapHighRatio: number;
  overlapHighArea: number;
  labelHighRatio: number;
}

/** A number as the C++ read it: a `float`. */
function numberIn(v: JsonValue | undefined): number | undefined {
  return typeof v === 'number' ? Math.fround(v) : undefined;
}

function stringsOf(v: JsonValue | undefined, out: Set<string>): void {
  if (!Array.isArray(v)) return;
  for (const item of v as readonly JsonValue[]) if (typeof item === 'string') out.add(item);
}

const pairKey = (a: string, b: string): string => `${a}\u0000${b}`;

/** The options, or null when they are not a JSON object. Keys of the wrong type keep their default. */
function parseOptions(input: JsonInput): LintOptions | null {
  const opts: LintOptions = {
    pageId: '',
    only: new Set(),
    within: null,
    containers: new Set(),
    seeThrough: new Set(),
    overlays: new Set(),
    tolerance: Math.fround(0.9),
    max: 20,
    overlapHighRatio: Math.fround(0.1),
    overlapHighArea: 100,
    labelHighRatio: Math.fround(1.2),
  };
  let root: JsonValue;
  if (typeof input === 'string') {
    if (input === '') return opts;
    try {
      root = JSON.parse(input) as JsonValue;
    } catch {
      return null;
    }
  } else {
    root = input;
  }
  if (!isJsonObject(root)) return null;
  const o: JsonObject = root;
  if (typeof o['page'] === 'string') opts.pageId = o['page'];
  stringsOf(o['only'], opts.only);
  stringsOf(o['containers'], opts.containers);
  stringsOf(o['see_through'], opts.seeThrough);

  const within = o['within'];
  if (Array.isArray(within) && within.length === 4) {
    const v = (within as readonly JsonValue[]).map(numberIn);
    if (v.every((x) => x !== undefined)) {
      const [x, y, w, h] = v as [number, number, number, number];
      opts.within = {
        minx: Math.min(x, x + w),
        miny: Math.min(y, y + h),
        maxx: Math.max(x, x + w),
        maxy: Math.max(y, y + h),
      };
    }
  }

  const pairs = o['overlay_pairs'];
  if (Array.isArray(pairs)) {
    for (const p of pairs as readonly JsonValue[]) {
      if (!Array.isArray(p) || p.length !== 2) continue;
      const [a, b] = p as readonly JsonValue[];
      if (typeof a !== 'string' || typeof b !== 'string') continue;
      opts.overlays.add(pairKey(a, b));
      opts.overlays.add(pairKey(b, a));
    }
  }

  let v = numberIn(o['tolerance']);
  if (v !== undefined && v > 0 && v <= 1) opts.tolerance = v;
  v = numberIn(o['max']);
  if (v !== undefined && v >= 0) opts.max = Math.trunc(v);
  v = numberIn(o['overlap_high_ratio']);
  if (v !== undefined && v >= 0) opts.overlapHighRatio = v;
  v = numberIn(o['overlap_high_area']);
  if (v !== undefined && v >= 0) opts.overlapHighArea = v;
  v = numberIn(o['label_high_ratio']);
  if (v !== undefined && v > 0) opts.labelHighRatio = v;
  return opts;
}

// ------------------------------------------------------------------ the page, flattened

interface Node {
  object: LekhObject;
  id: string;
  templateId: string;
  box: Box;
  /** The outermost group it is in, or null. */
  group: LekhObject | null;
  container: boolean;
  seeThrough: boolean;
  text: boolean;
  title: Box | null;
}

const isObstacle = (n: Node): boolean => !n.container && !n.seeThrough && !n.text;

const RouteShape = Object.freeze({ Straight: 0, Curved: 1, Polyline: 2 } as const);
type RouteShape = (typeof RouteShape)[keyof typeof RouteShape];

interface Label {
  edge: number;
  /** Into the connector's `textInfos()`, i.e. the edge's `texts`. */
  index: number;
  rect: Box;
  width: number;
  height: number;
  param: number;
}

interface Edge {
  connection: ConnectionObject;
  id: string;
  /** Node indices of its endpoints: a group end stands for every node in it. */
  ends: Set<number>;
  shape: RouteShape;
  /** A Bézier or path already cut into segments. */
  route: Point[];
  /** The route and its labels. */
  bounds: Box;
}

interface Issue {
  kind: Kind;
  high: boolean;
  ids: string[];
  detail: JsonOut;
}

function round1(v: number): number {
  const r = Math.floor(v * 10 + 0.5) / 10;
  return r === 0 ? 0 : r;
}

/** A detail number: rounded to 0.1, then written as the C++ wrote a `float`. */
const numberNode = (v: number): number => g6(round1(v));
const rectNode = (b: Box): JsonValue => [
  numberNode(b.minx),
  numberNode(b.miny),
  numberNode(boxWidth(b)),
  numberNode(boxHeight(b)),
];
const sizeNode = (w: number, h: number): JsonValue => [numberNode(w), numberNode(h)];

function isAlignHorizontalSet(style: Style | null): boolean {
  for (let s = style; s !== null; s = s.parent()) if (s.isTextAlignHorizontalDefined()) return true;
  return false;
}

/**
 * A title's text rectangle, as the text element lays it out: the slot rectangle centred on the
 * element's centre, the stroke pad, the wrap mode, and, for a title with no horizontal alignment
 * set anywhere, alignment toward the shape. Then the axis-aligned bounds of that rectangle rotated
 * about the title's centre, as `getVisualBounds` rotates the title box. Null without a title.
 */
function titleBoxOf(ctx: SemanticContext, tobj: TemplatedObject): Box | null {
  const tmpl = tobj.shapeTemplate();
  const title: ShapeTextElement | null = tmpl === null ? null : tmpl.titleElement();
  if (title === null || title.text() === '') return null;
  const ds = tobj.ds;
  const ct = title.center(ds);
  const slot = title.getSize(ds);
  const angle = ds.angle();
  let rect = Rect.fromCenter(ct, slot.width, slot.height);
  if (title.floating() || slot.width <= 0 || slot.height <= 0) rect = Rect.fromCenter(ct, 40000, 40000);

  const own = title.style() ?? new Style();
  let style = own;
  if (!isAlignHorizontalSet(own)) {
    const side = title.external();
    const titleStyle = new Style();
    titleStyle.setParent(own);
    titleStyle.setTextAlignHorizontal(
      side === TextSide.Left
        ? TextAlignHorizontal.Right
        : side === TextSide.Right
          ? TextAlignHorizontal.Left
          : TextAlignHorizontal.Center,
    );
    style = titleStyle;
  }
  let param: TextBoxParam;
  if (title.floating()) {
    param = { text: title.text(), angle, inRect: rect, textSizeAdjustment: 1, wrapMode: 'float' };
  } else {
    let pad = own.effectiveStrokeWidth() / 2;
    if (title.isDefaultText()) pad += ctx.config.alignmentPad;
    param = { text: title.text(), angle, inRect: rect, pad, wrapMode: 'wrap' };
  }
  const ww = param.wrapMode === 'wrap' ? rect.width - (param.pad ?? 0) * 2 : -1;
  const probe = ctx.text.layout(param.text, style, rect, ww, angle, param.wrapMode ?? 'wrap');
  const edit = textEditRect(param, style, new Size(probe.width, probe.height), ctx.config.minTextEditWidth);
  let pts = edit.getPoints();
  if (angle !== 0) pts = rotate(pts, ct, angle);
  return boxOfPoints(pts);
}

/** Appends a curve's samples to `route`, skipping a repeat of the last point. */
function appendCurve(curve: BezierCurve, route: Point[]): void {
  for (let i = 0; i <= CURVE_STEPS; i++) {
    if (i === 0 && route.length > 0) continue;
    route.push(curve.getPoint(Math.fround(i / CURVE_STEPS)));
  }
}

function lengthOf(route: readonly Point[]): number {
  let len = 0;
  for (let i = 0; i + 1 < route.length; i++) len += getDistance(route[i] as Point, route[i + 1] as Point);
  return len;
}

/**
 * What a body text needs when it is wrapped at `width` with every run's width scaled by `scale`.
 * Scaling each run by s and wrapping at w breaks exactly where wrapping the unscaled runs at w / s
 * does, so the engine's own wrap is reused.
 */
interface TextNeed {
  width: number;
  height: number;
  /** A line is wider than the slot: one word the wrap cannot break. */
  singleWord: boolean;
}

function textNeed(ctx: SemanticContext, text: string, style: Style, width: number, scale: number): TextNeed {
  const laid = ctx.text.layout(text, style, new Rect(0, 0, 0, 0), width / scale, 0, 'wrap');
  const need: TextNeed = { width: 0, height: 0, singleWord: false };
  for (const line of laid.lines) {
    need.width = Math.max(need.width, line.width * scale);
    need.height += laid.lineHeight;
    need.singleWord = need.singleWord || line.width * scale > width + EPS;
  }
  return need;
}

// ------------------------------------------------------------------ the pass

class Lint {
  private readonly ctx_: SemanticContext;
  private readonly opts_: LintOptions;
  private readonly pageId_: string;
  private readonly nodes_: Node[] = [];
  private readonly edges_: Edge[] = [];
  private readonly nodeIndex_ = new Map<LekhObject, number>();
  /** A group (at any depth) → the half-open range of `nodes_` its leaves occupy. */
  private readonly groupNodes_ = new Map<LekhObject, readonly [number, number]>();
  private readonly issues_: Issue[] = [];
  private seen_ = 0;

  constructor(ctx: SemanticContext, opts: LintOptions, pageId: string) {
    this.ctx_ = ctx;
    this.opts_ = opts;
    this.pageId_ = pageId;
  }

  private tick(): void {
    if (++this.seen_ % BUDGET_EVERY === 0) this.ctx_.budgetCheck();
  }

  collect(objects: readonly LekhObject[], group: LekhObject | null): void {
    for (const obj of objects) {
      this.tick();
      if (isGroup(obj)) {
        const g = obj as GroupObject;
        const members = g.objects().map((c) => c.object);
        const begin = this.nodes_.length;
        this.collect(members, group ?? g);
        this.groupNodes_.set(g, [begin, this.nodes_.length]);
        continue;
      }
      if (isConnector(obj)) {
        const con = obj as ConnectionObject;
        this.edges_.push({
          connection: con,
          id: con.id,
          ends: new Set(),
          shape: RouteShape.Straight,
          route: [],
          bounds: emptyBox(),
        });
        continue;
      }
      const tobj = obj as TemplatedObject;
      const tmpl = typeof tobj.shapeTemplate === 'function' ? tobj.shapeTemplate() : null;
      const templateId = tmpl === null ? '' : tmpl.id();
      const container = this.opts_.containers.has(templateId);
      this.nodeIndex_.set(obj, this.nodes_.length);
      this.nodes_.push({
        object: obj,
        id: obj.id,
        templateId,
        box: boxOf(obj.selectionRect()),
        group,
        container,
        seeThrough: !container && this.opts_.seeThrough.has(templateId),
        text: templateId === TEXT_TEMPLATE_ID,
        title: tmpl === null ? null : titleBoxOf(this.ctx_, tobj),
      });
    }
  }

  /** A connector end: the node, or every node of a group end. */
  private addEnd(end: LekhObject | null, ends: Set<number>): void {
    if (end === null) return;
    const node = this.nodeIndex_.get(end);
    if (node !== undefined) {
      ends.add(node);
      return;
    }
    const range = this.groupNodes_.get(end);
    if (range !== undefined) for (let i = range[0]; i < range[1]; i++) ends.add(i);
  }

  private sameGroup(a: Node, b: Node): boolean {
    return a.group !== null && a.group === b.group;
  }

  private isOverlay(a: Node, b: Node): boolean {
    return this.opts_.overlays.has(pairKey(a.templateId, b.templateId));
  }

  private static sortedPair(a: string, b: string): string[] {
    return a < b ? [a, b] : [b, a];
  }

  /** Adds an issue if it passes `only` and `within`; `boxes` are those of the objects it names. */
  private add(kind: Kind, high: boolean, ids: string[], detail: JsonOut, boxes: readonly Box[]): void {
    let keep = this.opts_.only.size === 0;
    for (const id of ids) keep = keep || this.opts_.only.has(id);
    const within = this.opts_.within;
    if (keep && within !== null) {
      keep = false;
      for (const b of boxes) keep = keep || touches(b, within);
    }
    if (!keep) return;
    this.issues_.push({ kind, high, ids, detail });
  }

  run(): void {
    this.shapeOverlaps();
    this.textOverflows();
    this.textOverlaps();
    this.titleOverlaps();
    this.edges();
  }

  private nodeGrid(): Grid {
    return new Grid(this.nodes_.map((n) => n.box));
  }

  /** shape_overlap. Floating text is left to text_overlap. */
  private shapeOverlaps(): void {
    const grid = this.nodeGrid();
    for (let i = 0; i < this.nodes_.length; i++) {
      this.tick();
      const a = this.nodes_[i] as Node;
      if (a.text) continue;
      grid.query(a.box, (j) => {
        if (j <= i) return;
        const b = this.nodes_[j] as Node;
        if (b.text) return;
        const inter = overlap(a.box, b.box);
        if (inter === null) return;
        if (this.sameGroup(a, b) || this.isOverlay(a, b)) return;
        // A shape wholly inside a container, and nested containers, are containment.
        if ((a.container && containsBox(a.box, b.box)) || (b.container && containsBox(b.box, a.box))) return;
        const area = boxArea(inter);
        const smaller = Math.min(boxArea(a.box), boxArea(b.box));
        const high = area >= this.opts_.overlapHighRatio * smaller || area >= this.opts_.overlapHighArea;
        this.add(
          Kind.ShapeOverlap,
          high,
          Lint.sortedPair(a.id, b.id),
          { area: numberNode(area), rect: rectNode(inter) },
          [a.box, b.box],
        );
      });
    }
  }

  /**
   * text_overflow: each body slot of each shape, except floating text, shapes whose generator
   * interprets its text, and tables (a template whose text slots are addressed by row and column).
   */
  private textOverflows(): void {
    for (let i = 0; i < this.nodes_.length; i++) {
      this.tick();
      const n = this.nodes_[i] as Node;
      if (n.text) continue;
      const tobj = n.object as TemplatedObject;
      const tmpl = typeof tobj.shapeTemplate === 'function' ? tobj.shapeTemplate() : null;
      if (tmpl === null) continue;
      if (tmpl.interpretText()) continue;
      let table = false;
      for (const slot of tmpl.textData) table = table || slot.row !== DEFAULT_ROW_COL || slot.col !== DEFAULT_ROW_COL;
      if (table) continue;
      this.textOverflowOf(i, tobj);
    }
  }

  private textOverflowOf(n: number, tobj: TemplatedObject): void {
    const node = this.nodes_[n] as Node;
    const tmpl = tobj.shapeTemplate();
    if (tmpl === null) return;
    let slot = -1; // the ordinal among body slots: the node's `texts` index
    for (const element of tmpl.texts()) {
      if (element.external() !== TextSide.None) continue;
      slot++;
      if (element.text() === '' || element.floating()) continue;
      // The slot's own size: rotation turns the slot, it does not resize it.
      const rect = element.getSize(tobj.ds);
      if (rect.width <= 0 || rect.height <= 0) continue;
      const style = element.style() ?? new Style();
      let pad = style.effectiveStrokeWidth() / 2;
      if (element.isDefaultText()) pad += this.ctx_.config.alignmentPad;
      const availW = rect.width - pad * 2;
      const availH = rect.height - pad * 2;

      const exact = textNeed(this.ctx_, element.text(), style, availW, 1.0);
      if (exact.width <= availW + EPS && exact.height <= availH + EPS) continue;
      const scaled = textNeed(this.ctx_, element.text(), style, availW, this.opts_.tolerance);
      const high = scaled.width > availW + EPS || scaled.height > availH + EPS;
      this.add(
        Kind.TextOverflow,
        high,
        [node.id],
        {
          slot,
          needed: sizeNode(exact.width, exact.height),
          available: sizeNode(availW, availH),
          single_word: exact.singleWord,
        },
        [node.box],
      );
    }
  }

  /**
   * text_overlap: a floating text crossing an obstacle, unless wholly inside it (a label placed
   * on a shape), or crossing another floating text.
   */
  private textOverlaps(): void {
    const grid = this.nodeGrid();
    for (let i = 0; i < this.nodes_.length; i++) {
      this.tick();
      const t = this.nodes_[i] as Node;
      if (!t.text) continue;
      grid.query(t.box, (j) => {
        if (j === i) return;
        const o = this.nodes_[j] as Node;
        const inter = overlap(t.box, o.box);
        if (inter === null || this.sameGroup(t, o)) return;
        if (o.text) {
          if (j < i) return; // the pair once
        } else if (!isObstacle(o) || containsBox(o.box, t.box)) {
          return;
        }
        this.add(Kind.TextOverlap, true, Lint.sortedPair(t.id, o.id), { rect: rectNode(inter) }, [t.box, o.box]);
      });
    }
  }

  /** title_overlap: a title box crossing an obstacle other than its own shape, or another title box. */
  private titleOverlaps(): void {
    const grid = this.nodeGrid();
    const titled: number[] = [];
    const titleBoxes: Box[] = [];
    for (let i = 0; i < this.nodes_.length; i++) {
      const t = (this.nodes_[i] as Node).title;
      if (t !== null) {
        titled.push(i);
        titleBoxes.push(t);
      }
    }
    for (const i of titled) {
      this.tick();
      const a = this.nodes_[i] as Node;
      const at = a.title as Box;
      grid.query(at, (j) => {
        const o = this.nodes_[j] as Node;
        if (j === i || !isObstacle(o) || this.sameGroup(a, o)) return;
        const inter = overlap(at, o.box);
        if (inter === null) return;
        const high = boxArea(inter) >= this.opts_.overlapHighRatio * boxArea(at);
        this.add(Kind.TitleOverlap, high, Lint.sortedPair(a.id, o.id), { rect: rectNode(inter) }, [at, o.box]);
      });
    }
    const titleGrid = new Grid(titleBoxes);
    for (let k = 0; k < titled.length; k++) {
      const a = this.nodes_[titled[k] as number] as Node;
      const at = a.title as Box;
      titleGrid.query(at, (m) => {
        if (m <= k) return;
        const b = this.nodes_[titled[m] as number] as Node;
        const bt = b.title as Box;
        if (this.sameGroup(a, b)) return;
        const inter = overlap(at, bt);
        if (inter === null) return;
        const high = boxArea(inter) >= this.opts_.overlapHighRatio * Math.min(boxArea(at), boxArea(bt));
        this.add(Kind.TitleOverlap, high, Lint.sortedPair(a.id, b.id), { rect: rectNode(inter) }, [at, bt]);
      });
    }
  }

  /** The three edge kinds. Routes and label centres are the settled layout's. */
  private edges(): void {
    const labels: Label[] = [];
    for (let e = 0; e < this.edges_.length; e++) {
      this.tick();
      const edge = this.edges_[e] as Edge;
      const con = edge.connection;
      this.addEnd(con.first, edge.ends);
      this.addEnd(con.second, edge.ends);

      if (con.routePoints().length > 0) {
        edge.route = [...con.routePoints()];
        edge.shape = edge.route.length > 2 ? RouteShape.Polyline : RouteShape.Straight;
      } else if (con.routeCurves().length > 0) {
        for (const curve of con.routeCurves()) appendCurve(curve, edge.route);
        edge.shape = RouteShape.Curved;
      } else {
        // A path connector: its whole length counts, as for a curve.
        for (const path of con.routePaths()) {
          for (const pc of path.components) {
            if (pc.isCurve) {
              appendCurve(pc.curve, edge.route);
            } else {
              const seg: LineSegment = pc.segment;
              if (edge.route.length === 0) edge.route.push(seg.p1);
              edge.route.push(seg.p2);
            }
          }
        }
        edge.shape = RouteShape.Curved;
      }
      edge.bounds = boxOfPoints(edge.route);

      const profile = con.getDrawingProfile();
      const infos = con.textInfos();
      for (let i = 0; i < infos.length; i++) {
        const info = infos[i];
        if (info === undefined || info.text === '') continue;
        const size = this.ctx_.text.measure(info.text, profile, new Size(0, 0));
        const label: Label = {
          edge: e,
          index: i,
          rect: boxOf(con.textRect(info)),
          width: size.width,
          height: size.height,
          param: info.param,
        };
        if (edge.route.length === 0) edge.bounds = { ...label.rect };
        else include(edge.bounds, label.rect);
        labels.push(label);
      }
    }

    const grid = this.nodeGrid();

    // edge_label_overflow: the label against the visible length — the whole route for a straight
    // or curved edge, the segment holding the label's anchor for a polyline — measured along that
    // segment's axis.
    for (const label of labels) {
      const edge = this.edges_[label.edge] as Edge;
      if (edge.route.length < 2) continue;
      let from = edge.route[0] as Point;
      let to = edge.route[edge.route.length - 1] as Point;
      let length = lengthOf(edge.route);
      if (edge.shape === RouteShape.Polyline && length > 0) {
        let sum = 0;
        for (let k = 0; k + 1 < edge.route.length; k++) {
          const seg = getDistance(edge.route[k] as Point, edge.route[k + 1] as Point);
          const t = (sum + seg) / length;
          from = edge.route[k] as Point;
          to = edge.route[k + 1] as Point;
          sum += seg;
          if (label.param < t) break;
        }
        length = getDistance(from, to);
      }
      const vertical = Math.abs(to.y - from.y) > Math.abs(to.x - from.x);
      const measure = vertical ? label.height : label.width;
      if (measure <= length + EPS) continue;
      const scaled = vertical ? label.height : label.width * this.opts_.tolerance;
      const high = scaled >= this.opts_.labelHighRatio * length;
      this.add(
        Kind.EdgeLabelOverflow,
        high,
        [edge.id],
        {
          label: label.index,
          label_size: sizeNode(label.width, label.height),
          visible_length: numberNode(length),
          // Which of label_size was measured against visible_length.
          axis: vertical ? 'height' : 'width',
        },
        [edge.bounds],
      );
    }

    // edge_label_overlap: a label on an obstacle (its endpoints included) or on another label.
    for (const label of labels) {
      const edge = this.edges_[label.edge] as Edge;
      grid.query(label.rect, (j) => {
        const o = this.nodes_[j] as Node;
        if (!isObstacle(o)) return;
        const inter = overlap(label.rect, o.box);
        if (inter === null) return;
        this.add(Kind.EdgeLabelOverlap, true, [edge.id, o.id], { label: label.index, rect: rectNode(inter) }, [
          edge.bounds,
          o.box,
        ]);
      });
    }
    const labelGrid = new Grid(labels.map((l) => l.rect));
    for (let a = 0; a < labels.length; a++) {
      labelGrid.query((labels[a] as Label).rect, (b) => {
        if (b <= a) return;
        const inter = overlap((labels[a] as Label).rect, (labels[b] as Label).rect);
        if (inter === null) return;
        // Both are edges: the lower id first, and `label` is its label.
        let la = labels[a] as Label;
        let lb = labels[b] as Label;
        if ((this.edges_[lb.edge] as Edge).id < (this.edges_[la.edge] as Edge).id) [la, lb] = [lb, la];
        const ea = this.edges_[la.edge] as Edge;
        const eb = this.edges_[lb.edge] as Edge;
        const ids = [ea.id];
        if (eb.id !== ea.id) ids.push(eb.id);
        this.add(Kind.EdgeLabelOverlap, true, ids, { label: la.index, rect: rectNode(inter) }, [ea.bounds, eb.bounds]);
      });
    }

    // edge_through_shape: the route entering an obstacle that is neither end.
    for (const edge of this.edges_) {
      const crossed = new Set<number>();
      for (let k = 0; k + 1 < edge.route.length; k++) {
        const p = edge.route[k] as Point;
        const q = edge.route[k + 1] as Point;
        grid.query(boxOfPoints([p, q]), (j) => {
          if (edge.ends.has(j) || crossed.has(j)) return;
          const n = this.nodes_[j] as Node;
          if (!isObstacle(n) || !segmentCrosses(p, q, n.box)) return;
          crossed.add(j);
        });
      }
      for (const j of [...crossed].sort((x, y) => x - y)) {
        const n = this.nodes_[j] as Node;
        this.add(Kind.EdgeThroughShape, true, [edge.id, n.id], { node: n.id }, [edge.bounds, n.box]);
      }
    }
  }

  answer(): JsonOut {
    const sorted = this.issues_
      .map((issue, i) => ({ issue, i }))
      .sort((x, y) => {
        const a = x.issue;
        const b = y.issue;
        if (a.high !== b.high) return a.high ? -1 : 1;
        if (a.kind !== b.kind) return a.kind - b.kind;
        const fa = a.ids[0] ?? '';
        const fb = b.ids[0] ?? '';
        if (fa !== fb) return fa < fb ? -1 : 1;
        return x.i - y.i;
      })
      .map((x) => x.issue);
    const listed = Math.min(sorted.length, this.opts_.max);
    const list: JsonValue[] = [];
    for (let i = 0; i < listed; i++) {
      const issue = sorted[i] as Issue;
      list.push({
        kind: KIND_NAMES[issue.kind] ?? '',
        confidence: issue.high ? 'high' : 'low',
        page: this.pageId_,
        ids: issue.ids,
        detail: issue.detail,
      });
    }
    return { ok: true, page: this.pageId_, issues: list, truncated: sorted.length - listed };
  }
}

function refusal(message: string): JsonOut {
  return { ok: false, message };
}

/**
 * C++ `semanticLint`: `{ok: true, page, issues, truncated}` for the named page (or the first), or
 * `{ok: false, message}` when the options are not a JSON object or the page is not there. Each
 * issue is `{kind, confidence, page, ids, detail}`, without the `hint` the MCP layer writes.
 */
export function semanticLint(ctx: SemanticContext, options: JsonInput): JsonOut {
  const opts = parseOptions(options);
  if (opts === null) return refusal('The lint options are not a JSON object.');
  const page = ctx.doc.pages.find((p) => opts.pageId === '' || p.id === opts.pageId);
  if (page === undefined) {
    if (opts.pageId === '') return refusal('The document has no pages, so there is nothing to check.');
    return refusal(`There is no page with id "${opts.pageId}" on this board.`);
  }

  // Label centres and laid-out routes exist only after a layout (the C++ settle draw).
  ctx.layoutAll();

  const lint = new Lint(ctx, opts, page.id);
  lint.collect(page.objectStore.objects, null);
  lint.run();
  return lint.answer();
}

/**
 * Possible layout problems on one page of the session's loaded document (C++ `CoreDoc.lint`).
 * Warn-only: it moves nothing. A `budget_exceeded` error propagates.
 */
export function lint(s: SemanticHost, options: JsonInput): JsonObject {
  if (!s.isLoaded) return refusal('No document is loaded on this handle, so there is nothing to lint.');
  return semanticLint(s.semanticContext(), options);
}
