// The projector (port of C++ `semantic/SemanticProjector.{h,cpp}`): a loaded document as the
// `lekh.semantic/1` read schema, in the order /backend/subsystems/mcp/semantic-format.md §2
// presents it: envelope, page, node (with a path's `draw`), edge, route, arrow, style.
//
// Differences from the C++ that are deliberate:
//   - the settle pass (a NoOp draw with its state snapshot and restore) is `ctx.layoutAll()`:
//     layout computes label centres and anchors without drawing and never changes serialized
//     state (spec 10 §3, AC-BE-08), so there is nothing to snapshot and no "last settled" mark;
//   - a connector's rectangle is its laid-out selection rectangle (layout is not a write here,
//     so no throw-away copy is laid out instead);
//   - the legacy `TextObject` / `ImageObject` kinds do not exist (legacy types are converted on
//     load, spec 03 §10.4), so their geometry branch is not ported;
//   - every float the answer carries is `g6()`-rounded (OQ-67); the byte budget measures the
//     answer as the C++ `JsonParser::store` would write it (sorted keys, no spaces, UTF-8).
import { Rect } from '../geometry';
import { serializeStyle } from '../io';
import {
  CanvasSizeType,
  ConnectionObject,
  ConnectionParam,
  ConnectionType,
  GroupObject,
  TemplatedObject,
  UnrecognizedObject,
  BackgroundType,
  AutoType,
  type ArrowHeads,
  type LekhDocument,
  type LekhObject,
  type Page,
  type ParamMap,
} from '../model';
import { Color, Length, PaintType, type Style } from '../style';
import {
  PolygonTemplate,
  textSideName,
  DEFAULT_ROW_COL,
  isJsonObject,
  type ShapeTemplate,
  type JsonObject,
  type JsonValue,
} from '../template';
import { formatG6 } from '../base';
import type { JsonInput, SemanticContext, SemanticHost } from './context';
import {
  CANVAS,
  CAP_STYLES,
  FONT_STYLES,
  FONT_WEIGHTS,
  FORMAT_NAME,
  JOIN_STYLES,
  KEY,
  KIND,
  MAX_GROUP_DEPTH,
  PAINT_TYPES,
  PATH_SHAPE_ID,
  TEXT_ALIGN_HORIZONTALS,
  TEXT_ALIGN_VERTICALS,
  TEXT_DECORATIONS,
  arrowNameFor,
  autoTypeName,
  colorToHex,
  edgeTypeName,
  enumName,
  isTextStyleKey,
  isUBend,
  marginToSemantic,
  pathCommandArity,
  semanticStyleKey,
  type ArrowRegistry,
} from './format';
import { g6, type JsonOut } from './json';

// ---------------------------------------------------------------- options

/** C++ `ProjectionOptions`. */
export interface ProjectionOptions {
  docid: string;
  /** The board's name in the store; wins over the document's. */
  name: string;
  version: number;
  hasVersion: boolean;
  pageId: string;
  hasRegion: boolean;
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
  includeStyle: boolean;
  maxBytes: number;
}

export function defaultProjectionOptions(): ProjectionOptions {
  return {
    docid: '',
    name: '',
    version: 0,
    hasVersion: false,
    pageId: '',
    hasRegion: false,
    minx: 0,
    miny: 0,
    maxx: 0,
    maxy: 0,
    includeStyle: true,
    maxBytes: 0,
  };
}

/** A JSON input as a value; null when text does not parse (C++ `JsonParser::load` answered null). */
function inputValue(json: JsonInput): JsonValue | null | undefined {
  if (typeof json !== 'string') return json;
  if (json === '') return undefined;
  try {
    return JSON.parse(json) as JsonValue;
  } catch {
    return null;
  }
}

function num(v: JsonValue | undefined): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/**
 * C++ `SemanticProjector::parseOptions`: null when the options do not parse as a JSON object.
 * Empty text (or `undefined`) is the defaults.
 */
export function parseProjectOptions(json: JsonInput | undefined): ProjectionOptions | null {
  const opts = defaultProjectionOptions();
  if (json === undefined) return opts;
  const node = inputValue(json);
  if (node === undefined) return opts;
  if (!isJsonObject(node)) return null;
  if (typeof node['docid'] === 'string') opts.docid = node['docid'];
  if (typeof node['name'] === 'string') opts.name = node['name'];
  // `getField(long*)` insists on an INT; a host that hands over `version: 42.0` is not refused.
  const version = num(node['version']);
  if (version !== undefined) {
    opts.version = Math.trunc(Math.fround(version));
    opts.hasVersion = true;
  }
  if (typeof node['page'] === 'string') opts.pageId = node['page'];
  const region = node['region'];
  if (isJsonObject(region)) {
    const minx = num(region['minx']);
    const miny = num(region['miny']);
    const maxx = num(region['maxx']);
    const maxy = num(region['maxy']);
    if (minx !== undefined && miny !== undefined && maxx !== undefined && maxy !== undefined) {
      opts.hasRegion = true;
      opts.minx = Math.min(minx, maxx);
      opts.maxx = Math.max(minx, maxx);
      opts.miny = Math.min(miny, maxy);
      opts.maxy = Math.max(miny, maxy);
    }
  }
  if (typeof node['include_style'] === 'boolean') opts.includeStyle = node['include_style'];
  const maxBytes = num(node['max_bytes']);
  if (maxBytes !== undefined && maxBytes > 0) opts.maxBytes = Math.trunc(maxBytes);
  return opts;
}

// ---------------------------------------------------------------- entry points

/**
 * The settle pass: lays out every dirty object, so connector label centres and edge anchors
 * exist before anything is measured (C++ `SemanticProjector::settle`, a NoOp draw).
 */
export function settle(ctx: SemanticContext): void {
  ctx.layoutAll();
}

/** C++ `SemanticProjector::projectToNode`. */
export function projectToNode(ctx: SemanticContext, opts: ProjectionOptions): JsonOut {
  settle(ctx);
  return new Projection(ctx, opts).run();
}

/**
 * The loaded document as the read schema, or null when nothing is loaded or the options do not
 * parse (the C++ answered "" for both). `options` are the C++ `ProjectionOptions` members,
 * snake_case (`page`, `region`, `include_style`, `max_bytes`, `docid`, `name`, `version`), as JSON
 * or its text.
 */
export function project(s: SemanticHost, options: JsonInput = {}): JsonObject | null {
  const opts = parseProjectOptions(options);
  if (opts === null || !s.isLoaded) return null;
  return projectToNode(s.semanticContext(), opts);
}

// ---------------------------------------------------------------- measuring

/** The UTF-8 length of `s`. */
function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

/** C++ `JsonParser::escapeString`'s growth: one byte for each escaped character. */
function escapedLength(s: string): number {
  let n = utf8Length(s);
  for (let i = 0; i < s.length; i++) {
    switch (s.charAt(i)) {
      case '\\':
      case '\n':
      case '\r':
      case '\t':
      case '\b':
      case '\f':
      case '"':
        n++;
    }
  }
  return n;
}

function numberText(v: number): string {
  return Number.isInteger(v) ? String(v) : formatG6(v);
}

/** The length of the JSON text C++ `JsonParser::store` writes for `v` (keys unescaped). */
export function storedLength(v: JsonValue | undefined): number {
  if (v === null || v === undefined) return 4;
  switch (typeof v) {
    case 'number':
      return numberText(v).length;
    case 'string':
      return escapedLength(v) + 2;
    case 'boolean':
      return v ? 4 : 5;
  }
  if (Array.isArray(v)) {
    const a = v as readonly JsonValue[];
    let n = 2 + Math.max(0, a.length - 1);
    for (const item of a) n += storedLength(item);
    return n;
  }
  const o = v as JsonObject;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined);
  let n = 2 + Math.max(0, keys.length - 1);
  for (const k of keys) n += utf8Length(k) + 3 + storedLength(o[k]);
  return n;
}

// ---------------------------------------------------------------- helpers

const IMAGE_TEMPLATE_ID = 'avabodh.basic.image';
const TEXT_TEMPLATE_ID = 'avabodh.basic.text';
const NON_OVERRIDABLES = 'nonoverridables';
const NATIVE_PATH_IDS: readonly string[] = Object.freeze([
  'avabodh.basic.polygon',
  'avabodh.basic.curve',
  'avabodh.basic.path',
]);
const ROUNDED_RECTANGLE_ID = 'avabodh.basic.rounded_rectangle';

function rectOut(r: Rect): JsonOut {
  return { [KEY.minx]: g6(r.x), [KEY.miny]: g6(r.y), [KEY.maxx]: g6(r.right()), [KEY.maxy]: g6(r.bottom()) };
}

/** An object's visual bounds (title included); a connector's laid-out selection rectangle. */
function visualBoundsOf(obj: LekhObject): Rect {
  if (obj instanceof ConnectionObject) return obj.selectionRect();
  if (obj instanceof TemplatedObject) return obj.getVisualBounds();
  return obj.visualBounds();
}

/**
 * A page's `bounds`: the union of its objects' visual bounds, each inflated by half its stroke
 * width (`ObjectStore::getBoundsOfAll` is not used: it takes the first object without its stroke).
 */
function pageBoundsOf(objects: readonly LekhObject[]): Rect {
  if (objects.length === 0) return new Rect();
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  objects.forEach((obj, i) => {
    const rect = visualBoundsOf(obj).inflate(obj.getDrawingProfile().effectiveStrokeWidth() / 2);
    if (i === 0) {
      minX = rect.x;
      minY = rect.y;
      maxX = rect.x + rect.width;
      maxY = rect.y + rect.height;
      return;
    }
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  });
  return new Rect(minX, minY, maxX - minX, maxY - minY);
}

function textDecorationNode(val: number): JsonValue[] {
  const arr: JsonValue[] = [];
  for (const [v, n] of TEXT_DECORATIONS) if ((val & v) !== 0) arr.push(n);
  return arr;
}

function canvasTypeName(type: CanvasSizeType): string {
  if (type === CanvasSizeType.Fixed) return CANVAS.fixed;
  if (type === CanvasSizeType.Infinite) return CANVAS.infinite;
  return CANVAS.autoSize;
}

function paramOf(pm: ParamMap, name: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(pm, name) ? pm[name] : undefined;
}

function arrowWordFor(arrows: ArrowRegistry, tmpl: ShapeTemplate): string {
  const name = arrowNameFor(arrows, tmpl.id());
  return name === '' ? tmpl.id() : name;
}

/** A stored draw string as tokens: a letter, a run of digits, or any other single character. */
function drawTokens(cmds: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < cmds.length) {
    const c = cmds.charAt(i);
    if (isSpace(c) || c === ',') i++;
    else if (isDigit(c)) {
      let j = i;
      while (j < cmds.length && isDigit(cmds.charAt(j))) j++;
      out.push(cmds.slice(i, j));
      i = j;
    } else {
      out.push(c);
      i++;
    }
  }
  return out;
}

function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\v' || c === '\f';
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isAlpha(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

function trimmed(s: string): string {
  return s.replace(/^[ \t\r\n]+/, '').replace(/[ \t\r\n]+$/, '');
}

function sameTokens(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/** Whether two bodies draw the same thing: equal trimmed `data`, and the same draw tokens. */
function sameDrawing(a: ShapeTemplate, b: ShapeTemplate): boolean {
  const da = a.dataExprs();
  const db = b.dataExprs();
  if (da.length !== db.length) return false;
  for (let i = 0; i < da.length; i++) if (trimmed(da[i] ?? '') !== trimmed(db[i] ?? '')) return false;
  const pa = a.pathData;
  const pb = b.pathData;
  if (pa.length !== pb.length) return false;
  for (let i = 0; i < pa.length; i++) {
    if (!sameTokens(drawTokens(pa[i]?.drawCmds ?? ''), drawTokens(pb[i]?.drawCmds ?? ''))) return false;
  }
  return true;
}

interface DrawCommand {
  letter: string;
  args: number[];
}

/**
 * A stored draw entry as commands, or null when the write side would not accept it back: a
 * letter outside `M L C Z`, a wrong argument count, an index past `data`, an `M` not first, a `Z`
 * not last, or no `L`/`C` at all.
 */
function readDrawEntry(cmds: string, dataCount: number): DrawCommand[] | null {
  const tokens = drawTokens(cmds);
  const out: DrawCommand[] = [];
  let i = 0;
  let drawsSomething = false;
  while (i < tokens.length) {
    const tok = tokens[i] ?? '';
    if (tok.length !== 1 || !isAlpha(tok)) return null;
    const letter = tok;
    const arity = pathCommandArity(letter);
    if (arity < 0) return null;
    if ((letter === 'M') !== (out.length === 0)) return null;
    if (out.length > 0 && out[out.length - 1]?.letter === 'Z') return null;
    i++;
    const command: DrawCommand = { letter, args: [] };
    for (let k = 0; k < arity; k++, i++) {
      const t = tokens[i];
      if (t === undefined || !isDigit(t.charAt(0))) return null;
      const index = Number.parseInt(t, 10);
      if (index >= dataCount) return null;
      command.args.push(index);
    }
    if (letter === 'L' || letter === 'C') drawsSomething = true;
    out.push(command);
  }
  return drawsSomething ? out : null;
}

/** Every free-hand stroke under `obj`, itself included, at any depth. */
function strokesIn(obj: LekhObject): number {
  if (obj instanceof UnrecognizedObject) return 1;
  if (!(obj instanceof GroupObject)) return 0;
  let n = 0;
  for (const c of obj.objects()) n += strokesIn(c.object);
  return n;
}

function collectBelowDepthCap(obj: LekhObject, depth: number, ids: Set<string>): void {
  if (depth > MAX_GROUP_DEPTH) ids.add(obj.id);
  if (!(obj instanceof GroupObject)) return;
  for (const c of obj.objects()) collectBelowDepthCap(c.object, depth + 1, ids);
}

function objectsBelowDepthCap(objs: readonly LekhObject[]): number {
  const ids = new Set<string>();
  for (const obj of objs) {
    if (obj instanceof ConnectionObject) continue;
    collectBelowDepthCap(obj, 0, ids);
  }
  return ids.size;
}

/** Why a node was not emitted (/spec/read-path.md §5.1). */
const SkipCause = Object.freeze({ Region: 0, Budget: 1, Depth: 2 } as const);
type SkipCause = (typeof SkipCause)[keyof typeof SkipCause];

/** How much the agent can do about a cause, most actionable first: depth, budget, region. */
function actionabilityRank(cause: SkipCause): number {
  switch (cause) {
    case SkipCause.Depth:
      return 0;
    case SkipCause.Budget:
      return 1;
    case SkipCause.Region:
      return 2;
  }
  return 2;
}

function arrowsOf(obj: LekhObject): ArrowHeads | null {
  if (obj instanceof TemplatedObject || obj instanceof ConnectionObject) return obj.arrows;
  return null;
}

const ShapeForm = Object.freeze({ Stored: 0, Rounded: 1, Path: 2 } as const);
type ShapeForm = (typeof ShapeForm)[keyof typeof ShapeForm];

// ---------------------------------------------------------------- the projection

/** One projection in progress: the byte budget, the notes and the option set threaded through every step. */
class Projection {
  private readonly ctx_: SemanticContext;
  private readonly doc_: LekhDocument;
  private readonly opts_: ProjectionOptions;

  private readonly notes_: string[] = [];
  private used_ = 0;
  private truncated_ = false;
  private omittedByBudget_ = 0;
  private otherKinds_ = 0;
  private danglingEdges_ = 0;
  private strokes_ = 0;
  private strokesListed_ = 0;
  private unexpressiblePaths_ = 0;
  /** Catalogue bodies by id for the R3 comparison; null for an id the store does not have. */
  private readonly catalogue_ = new Map<string, ShapeTemplate | null>();
  /** Indexed by actionability (0 depth, 1 budget, 2 region). */
  private readonly danglingByCause_: [number, number, number] = [0, 0, 0];
  private danglingUnknown_ = 0;
  private omittedByDepth_ = 0;
  private emittedNodeIds_ = new Set<string>();
  private skipped_ = new Map<string, SkipCause>();
  private visited_ = 0;

  constructor(ctx: SemanticContext, opts: ProjectionOptions) {
    this.ctx_ = ctx;
    this.doc_ = ctx.doc;
    this.opts_ = opts;
  }

  private measure(node: JsonValue): number {
    return storedLength(node);
  }

  private note(text: string): void {
    this.notes_.push(text);
  }

  /** The budget gate, at an object boundary: charges the object when it fits. */
  private fits(obj: JsonOut): boolean {
    if (this.opts_.maxBytes === 0) return true;
    if (this.truncated_) {
      this.omittedByBudget_++;
      return false;
    }
    const size = this.measure(obj) + 1;
    if (this.used_ + size > this.opts_.maxBytes) {
      this.truncated_ = true;
      this.omittedByBudget_++;
      return false;
    }
    this.used_ += size;
    return true;
  }

  /** Bytes going out whatever the counter says (a group's `children`). */
  private charge(bytes: number): void {
    if (this.opts_.maxBytes === 0) return;
    this.used_ += bytes;
    if (this.used_ > this.opts_.maxBytes) this.truncated_ = true;
  }

  private markSkipped(obj: LekhObject, cause: SkipCause): void {
    this.skipped_.set(obj.id, cause);
    if (!(obj instanceof GroupObject)) return;
    for (const c of obj.objects()) this.markSkipped(c.object, cause);
  }

  private skippedBy(id: string, cause: SkipCause): boolean {
    return this.skipped_.get(id) === cause;
  }

  private countDanglingEdge(fromId: string, toId: string): void {
    this.danglingEdges_++;
    let best = -1;
    for (const end of [fromId, toId]) {
      if (end === '') continue;
      const cause = this.skipped_.get(end);
      if (cause === undefined) continue;
      const rank = actionabilityRank(cause);
      if (best < 0 || rank < best) best = rank;
    }
    if (best < 0) this.danglingUnknown_++;
    else this.danglingByCause_[best as 0 | 1 | 2]++;
  }

  private inRegion(obj: LekhObject): boolean {
    const o = this.opts_;
    if (!o.hasRegion) return true;
    const c = obj.getCenter();
    return c.x >= o.minx && c.x <= o.maxx && c.y >= o.miny && c.y <= o.maxy;
  }

  private visit(): void {
    if (++this.visited_ % 256 === 0) this.ctx_.budgetCheck();
  }

  // ---------------------------------------------------------------- envelope

  run(): JsonOut {
    const o = this.opts_;
    const doc = this.doc_;
    const root: JsonOut = {};
    if (o.docid !== '') root[KEY.docid] = o.docid;
    let name = o.name;
    if (name === '') name = doc.name;
    if (name === '') name = doc.info.title;
    root[KEY.name] = name;
    if (o.hasVersion) root[KEY.version] = o.version;
    root[KEY.format] = FORMAT_NAME;
    root[KEY.grid] = { [KEY.present]: doc.grid.present };
    root[KEY.scaling] = { [KEY.scale]: g6(doc.scaling.value), [KEY.unit]: Length.unitStr(doc.scaling.unit) };

    // Seeded with the envelope and room for the notes, so a tiny cap truncates.
    this.used_ = this.measure(root) + 64;
    if (o.maxBytes > 0) this.used_ += 384;

    const pages: JsonValue[] = [];
    root[KEY.pages] = pages;
    const otherPages: string[] = [];
    doc.pages.forEach((page, i) => {
      if (o.pageId !== '' && o.pageId !== page.id) {
        otherPages.push(`${page.id} (${page.name})`);
        return;
      }
      pages.push(this.projectPage(page, i));
    });

    if (otherPages.length > 0) {
      this.note(`this response carries one page; the other pages are ${otherPages.join(', ')}`);
    }
    if (this.otherKinds_ > 0) {
      this.note(
        `${String(this.otherKinds_)} object(s) of a kind this schema does not model are reported as kind "other": geometry and style only`,
      );
    }
    if (this.strokes_ > 0) {
      let msg = `${String(this.strokes_)} free-hand drawing(s) are not included in nodes; board_render shows them`;
      if (this.strokesListed_ > 0) {
        msg += `, ${String(this.strokesListed_)} of them inside groups, listed as kind "freehand" with their box only`;
      }
      this.note(msg);
    }
    if (this.unexpressiblePaths_ > 0) {
      this.note(
        `${String(this.unexpressiblePaths_)} shape(s) have a drawing outside the path vocabulary and are reported by their stored id without draw; board_render shows them`,
      );
    }
    if (this.omittedByDepth_ > 0) {
      this.note(
        `${String(this.omittedByDepth_)} object(s) omitted: nested more than ${String(MAX_GROUP_DEPTH)} groups deep`,
      );
    }
    if (this.danglingEdges_ > 0) {
      const why: string[] = [];
      const [depth, budget, region] = this.danglingByCause_;
      if (depth > 0) why.push(`${String(depth)} nested more than ${String(MAX_GROUP_DEPTH)} groups deep`);
      if (budget > 0) why.push(`${String(budget)} dropped when the projection reached its size limit`);
      if (region > 0) why.push(`${String(region)} outside the region`);
      if (this.danglingUnknown_ > 0) why.push(`${String(this.danglingUnknown_)} not on the projected page`);
      this.note(`${String(this.danglingEdges_)} edge(s) omitted: an endpoint was not projected (${why.join(', ')})`);
    }
    if (this.truncated_ && this.omittedByBudget_ > 0) {
      this.note(
        `${String(this.omittedByBudget_)} object(s) omitted: the projection reached its output budget and was truncated at an object boundary. ` +
          'Narrow it with `page`, with `region`, or with `include_style: false`, or read the board as an image instead.',
      );
    } else if (this.truncated_) {
      this.note(
        "the projection reached its output budget on a group's `children`, which are carried whatever the budget says; " +
          'no object was dropped for it, but anything considered after that point would have been. ' +
          'Narrow it with `page`, with `region`, or with `include_style: false`, or read the board as an image instead.',
      );
    }
    root[KEY.truncated] = this.truncated_;
    root[KEY.notes] = this.notes_.slice();
    return root;
  }

  // ---------------------------------------------------------------- page

  private projectPage(page: Page, position: number): JsonOut {
    const node: JsonOut = {};
    node[KEY.id] = page.id;
    node[KEY.name] = page.name;
    node[KEY.order] = position;

    const sizeType = page.canvasSizeType;
    const size = page.size;
    const canvas: JsonOut = { [KEY.type]: canvasTypeName(sizeType) };
    if (sizeType === CanvasSizeType.Fixed) {
      canvas[KEY.width] = g6(size.width);
      canvas[KEY.height] = g6(size.height);
    } else {
      canvas[KEY.width] = 0;
      canvas[KEY.height] = 0;
    }
    canvas[KEY.unit] = Length.unitStr(size.unit);
    canvas[KEY.name] = page.canvasName;
    node[KEY.canvas] = canvas;

    if (page.margin.show) {
      const m = marginToSemantic(page.margin.size);
      m[KEY.leftRight] = g6(m[KEY.leftRight] as number);
      m[KEY.topBottom] = g6(m[KEY.topBottom] as number);
      node[KEY.margin] = m;
    }

    const background: JsonOut = { [KEY.color]: colorToHex(page.background.color) };
    if (page.background.type === BackgroundType.Image) background[KEY.image] = true;
    node[KEY.background] = background;

    const objects = page.objectStore.objects;
    this.emittedNodeIds_ = new Set();
    this.skipped_ = new Map();

    if (objects.length > 0) node[KEY.bounds] = rectOut(pageBoundsOf(objects));

    let pageStrokes = 0;
    for (const obj of objects) {
      if (obj instanceof ConnectionObject) continue;
      pageStrokes += strokesIn(obj);
    }
    this.strokes_ += pageStrokes;
    node[KEY.strokes] = pageStrokes;

    const depthBound = objectsBelowDepthCap(objects);
    if (depthBound > 0) node[KEY.depthOmitted] = depthBound;

    this.used_ += this.measure(node) + 2;

    const nodes: JsonValue[] = [];
    const edges: JsonValue[] = [];
    node[KEY.nodes] = nodes;
    node[KEY.edges] = edges;

    const connections: ConnectionObject[] = [];
    for (const obj of objects) {
      this.visit();
      if (obj instanceof ConnectionObject) {
        connections.push(obj);
        continue;
      }
      if (obj instanceof UnrecognizedObject) continue;
      if (!this.inRegion(obj)) {
        this.markSkipped(obj, SkipCause.Region);
        continue;
      }
      this.projectNode(obj, '', 0, nodes);
    }

    for (const con of connections) {
      this.visit();
      const first = con.first;
      const second = con.second;
      if (first === null || second === null) {
        this.countDanglingEdge('', '');
        continue;
      }
      const fromIn = this.emittedNodeIds_.has(first.id);
      const toIn = this.emittedNodeIds_.has(second.id);
      if (
        this.opts_.hasRegion &&
        !fromIn &&
        !toIn &&
        this.skippedBy(first.id, SkipCause.Region) &&
        this.skippedBy(second.id, SkipCause.Region)
      ) {
        continue;
      }
      if (!fromIn || !toIn) {
        this.countDanglingEdge(fromIn ? '' : first.id, toIn ? '' : second.id);
        continue;
      }
      const edge = this.projectEdge(con, first, second);
      if (!this.fits(edge)) continue;
      edges.push(edge);
    }

    let pageDepthOmitted = 0;
    for (const cause of this.skipped_.values()) if (cause === SkipCause.Depth) pageDepthOmitted++;
    this.omittedByDepth_ += pageDepthOmitted;
    if (depthBound > 0) Reflect.deleteProperty(node, KEY.depthOmitted);
    if (pageDepthOmitted > 0) node[KEY.depthOmitted] = pageDepthOmitted;
    return node;
  }

  // ---------------------------------------------------------------- node

  /** One object and its whole subtree; answers whether the object itself was emitted. */
  private projectNode(obj: LekhObject, parentId: string, depth: number, nodes: JsonValue[]): boolean {
    const stroke = obj instanceof UnrecognizedObject;
    const flags = { unexpressible: false };
    const node =
      obj instanceof UnrecognizedObject
        ? this.projectFreehandMember(obj, parentId)
        : this.projectNodeFields(obj, parentId, flags);
    if (!this.fits(node)) {
      this.markSkipped(obj, SkipCause.Budget);
      return false;
    }
    this.emittedNodeIds_.add(obj.id);
    nodes.push(node);
    if (stroke) this.strokesListed_++;
    if (flags.unexpressible) this.unexpressiblePaths_++;

    if (!(obj instanceof GroupObject)) return true;

    const children: JsonValue[] = [];
    if (depth < MAX_GROUP_DEPTH) {
      for (const c of obj.objects()) {
        this.visit();
        if (this.projectNode(c.object, obj.id, depth + 1, nodes)) children.push(c.object.id);
      }
    } else {
      for (const c of obj.objects()) this.markSkipped(c.object, SkipCause.Depth);
    }
    const before = this.opts_.maxBytes > 0 ? this.measure(node) : 0;
    node[KEY.children] = children;
    if (this.opts_.maxBytes > 0) this.charge(this.measure(node) - before);
    return true;
  }

  /** A free-hand stroke inside a group: its id, its box and the two keys that place it. */
  private projectFreehandMember(obj: UnrecognizedObject, parentId: string): JsonOut {
    const ds = obj.ds;
    const node: JsonOut = {
      [KEY.id]: obj.id,
      [KEY.kind]: KIND.freehand,
      [KEY.cx]: g6(ds.cx()),
      [KEY.cy]: g6(ds.cy()),
      [KEY.width]: g6(ds.width()),
      [KEY.height]: g6(ds.height()),
    };
    if (ds.angle() !== 0) node[KEY.angle] = g6(ds.angle());
    node[KEY.parent] = parentId;
    node[KEY.editable] = false;
    return node;
  }

  private projectNodeFields(obj: LekhObject, parentId: string, flags: { unexpressible: boolean }): JsonOut {
    const node: JsonOut = { [KEY.id]: obj.id };
    const group = obj instanceof GroupObject ? obj : null;
    const templated = obj instanceof TemplatedObject ? obj : null;
    const stl = templated !== null && group === null ? templated.shapeTemplate() : null;

    let kindName: string = KIND.other;
    if (group !== null) kindName = KIND.group;
    else if (stl !== null) {
      const tid = stl.id();
      if (tid === IMAGE_TEMPLATE_ID) kindName = KIND.image;
      else if (tid === TEXT_TEMPLATE_ID) kindName = KIND.text;
      else kindName = KIND.shape;
    }
    if (kindName === KIND.other) this.otherKinds_++;
    node[KEY.kind] = kindName;

    let draw: JsonValue[] | null = null;
    let shapeId = stl !== null ? stl.id() : '';
    if (group === null && stl !== null) {
      const form = this.formOf(stl);
      if (form === ShapeForm.Rounded) shapeId = ROUNDED_RECTANGLE_ID;
      else if (form === ShapeForm.Path) {
        draw = this.projectDraw(stl);
        if (draw !== null) shapeId = PATH_SHAPE_ID;
        else flags.unexpressible = true;
      }
    }

    if (stl !== null && templated !== null) {
      node[KEY.shape] = shapeId;
      const label = templated.nameInLibraryView;
      if (label !== '') node[KEY.shapeName] = label;
    }

    let angle = 0;
    if (templated !== null) {
      const ds = templated.ds;
      node[KEY.cx] = g6(ds.cx());
      node[KEY.cy] = g6(ds.cy());
      node[KEY.width] = g6(ds.width());
      node[KEY.height] = g6(ds.height());
      angle = ds.angle();
    } else {
      const rect = obj.selectionRect();
      const center = rect.center();
      node[KEY.cx] = g6(center.x);
      node[KEY.cy] = g6(center.y);
      node[KEY.width] = g6(rect.width);
      node[KEY.height] = g6(rect.height);
    }
    if (angle !== 0) node[KEY.angle] = g6(angle);
    if (draw !== null) node[KEY.draw] = draw;

    if (parentId === '') node[KEY.zOrder] = obj.order;

    if (stl !== null) {
      this.projectTexts(node, stl);
      this.projectTitle(node, stl);
      node[KEY.generated] = stl.generator !== null;
      node[KEY.interpretText] = stl.interpretText();
      this.projectTemplateParams(node, stl);
      if (kindName === KIND.image) this.projectImage(node, stl);
    }

    const arrows = arrowsOf(obj);
    if (arrows !== null) this.projectArrow(node, arrows);

    if (parentId !== '') {
      node[KEY.parent] = parentId;
      if (group === null) node[KEY.editable] = false;
    }

    if (this.opts_.includeStyle) this.projectStyle(node, obj.getDrawingProfile());
    return node;
  }

  /** `texts` — always an array; an interpreting generator's input, or one entry per body slot. */
  private projectTexts(node: JsonOut, stl: ShapeTemplate): void {
    const generator = stl.generator;
    if (generator !== null && generator.interpretText()) {
      node[KEY.texts] = [{ [KEY.text]: generator.interpretedText() }];
      return;
    }
    if (generator !== null && generator.behavior !== 'onParamChange') return;

    const slots = stl.textData;
    const title = stl.titleIndex();
    if (slots.length === 0 || (slots.length === 1 && title === 0)) return;
    const texts: JsonValue[] = [];
    slots.forEach((slot, i) => {
      if (i === title) return;
      const entry: JsonOut = { [KEY.text]: slot.text };
      if (slot.row !== DEFAULT_ROW_COL) entry[KEY.row] = slot.row;
      if (slot.col !== DEFAULT_ROW_COL) entry[KEY.col] = slot.col;
      texts.push(entry);
    });
    node[KEY.texts] = texts;
  }

  /** `title` — `{ text, side, style? }` on a node whose template has one. */
  private projectTitle(node: JsonOut, stl: ShapeTemplate): void {
    const index = stl.titleIndex();
    const info = index >= 0 ? stl.textData[index] : undefined;
    if (info === undefined) return;
    const title: JsonOut = { [KEY.text]: info.text, [KEY.side]: textSideName(info.external) };
    if (this.opts_.includeStyle) this.projectStyle(title, info.style, true);
    node[KEY.title] = title;
  }

  /** `template_params` — values only; omitted when the template declares none. */
  private projectTemplateParams(node: JsonOut, stl: ShapeTemplate): void {
    if (stl.params.length === 0) return;
    const out: JsonOut = {};
    let count = 0;
    for (const p of stl.params) {
      if (p.name === '') continue;
      if (!Object.prototype.hasOwnProperty.call(out, p.name)) count++;
      out[p.name] = roundNumbers(p.value);
    }
    if (count === 0) return;
    node[KEY.templateParams] = out;
  }

  /** An image node names its `res://` reference and nothing else. */
  private projectImage(node: JsonOut, stl: ShapeTemplate): void {
    for (const element of stl.images()) {
      const url = element.resourceUrl();
      if (url === '') continue;
      node[KEY.image] = { [KEY.res]: url };
      return;
    }
  }

  // ---------------------------------------------------------------- paths

  /**
   * Which id an object reads under, first match wins: R1 a rounded polygon reads as the
   * rounded-rectangle stencil; R2 the three native ids are paths; R3 a catalogue polygon whose
   * drawing is no longer the catalogue's is a path; R4 everything else reads under its stored id.
   */
  private formOf(stl: ShapeTemplate): ShapeForm {
    const poly = stl instanceof PolygonTemplate ? stl : null;
    if (poly !== null && poly.rounded) return ShapeForm.Rounded;
    if (NATIVE_PATH_IDS.includes(stl.id())) return ShapeForm.Path;
    if (poly !== null && this.differsFromCatalogue(stl)) return ShapeForm.Path;
    return ShapeForm.Stored;
  }

  private differsFromCatalogue(stl: ShapeTemplate): boolean {
    const id = stl.id();
    let body = this.catalogue_.get(id);
    if (body === undefined) {
      const def = this.ctx_.catalog.get(id);
      body = def === undefined ? null : this.ctx_.catalog.instantiate(def);
      this.catalogue_.set(id, body);
    }
    if (body === null) return false;
    return !sameDrawing(stl, body);
  }

  /** `draw`: one entry per stored draw entry; null when any entry is outside the path vocabulary. */
  private projectDraw(stl: ShapeTemplate): JsonValue[] | null {
    const data = stl.dataExprs();
    const entries = stl.pathData;
    if (entries.length === 0) return null;
    const closedPolygon = stl instanceof PolygonTemplate && stl.closed;
    const draw: JsonValue[] = [];
    for (const info of entries) {
      const commands = readDrawEntry(info.drawCmds, data.length);
      if (commands === null) return null;
      const last = commands[commands.length - 1];
      if (closedPolygon && last !== undefined && last.letter !== 'Z') {
        const front = commands[0];
        if (
          commands.length > 2 &&
          last.letter === 'L' &&
          front !== undefined &&
          sameTokens(last.args.map(String), front.args.map(String))
        ) {
          commands.pop();
        }
        commands.push({ letter: 'Z', args: [] });
      }
      const path: JsonValue[] = [];
      for (const c of commands) {
        path.push(c.letter);
        for (const index of c.args) path.push(data[index] ?? '');
      }
      const entry: JsonOut = { [KEY.path]: path };
      if (this.opts_.includeStyle) this.projectStyle(entry, info.style);
      draw.push(entry);
    }
    return draw;
  }

  // ---------------------------------------------------------------- edge

  private projectEdge(con: ConnectionObject, first: LekhObject, second: LekhObject): JsonOut {
    const node: JsonOut = { [KEY.id]: con.id, [KEY.from]: first.id, [KEY.to]: second.id };
    node[KEY.edgeType] = edgeTypeName(con.getType());

    const autoType = con.getAutoType();
    if (autoType !== AutoType.NoAuto) {
      node[KEY.autoType] = autoTypeName(autoType);
      if (isUBend(autoType)) {
        const params = con.getParams();
        const step = params[0] !== undefined ? paramOf(params[0], ConnectionParam.step) : undefined;
        if (step !== undefined) node[KEY.reach] = g6(step);
      }
    } else {
      const route = this.projectRoute(con);
      if (route !== null) node[KEY.route] = route;
    }

    const texts = con.textInfos();
    if (texts.length > 0) {
      const out: JsonValue[] = [];
      for (const info of texts) {
        if (info.text === '') continue;
        out.push({ [KEY.text]: info.text, [KEY.position]: g6(info.param) });
      }
      if (out.length > 0) node[KEY.texts] = out;
    }

    this.projectArrow(node, con.arrows);
    node[KEY.zOrder] = con.order;
    if (this.opts_.includeStyle) this.projectStyle(node, con.getDrawingProfile());
    return node;
  }

  /** `route` — the one structural translation (see the C++ header comment for its exact inverse). */
  private projectRoute(con: ConnectionObject): JsonOut | null {
    const params = con.getParams();
    if (params.length < 2) return null;
    const type = con.getType();
    const route: JsonOut = {};
    const first = params[0] as ParamMap;
    const last = params[params.length - 1] as ParamMap;
    const put = (o: JsonOut, k: string, v: number | undefined): void => {
      if (v !== undefined) o[k] = g6(v);
    };

    if (type === ConnectionType.Curve) {
      const names = [KEY.from, KEY.to];
      for (let i = 0; i < 2; i++) {
        const pm = params[i] as ParamMap;
        const endpoint: JsonOut = {};
        put(endpoint, KEY.angle, paramOf(pm, ConnectionParam.angle1));
        put(endpoint, KEY.angle2, paramOf(pm, ConnectionParam.angle2));
        put(endpoint, KEY.controlDistance, paramOf(pm, ConnectionParam.cdist1));
        const aa = paramOf(pm, ConnectionParam.angleauto);
        if (aa !== undefined) endpoint[KEY.angleAuto] = Math.trunc(aa) !== 0;
        const ca = paramOf(pm, ConnectionParam.cdistauto);
        if (ca !== undefined) endpoint[KEY.controlDistanceAuto] = Math.trunc(ca) !== 0;
        route[names[i] as string] = endpoint;
      }
      return route;
    }

    if (type === ConnectionType.GenericLine) {
      const from: JsonOut = {};
      put(from, KEY.angle, paramOf(first, ConnectionParam.angle));
      route[KEY.from] = from;
      const to: JsonOut = {};
      put(to, KEY.angle, paramOf(params[1] as ParamMap, ConnectionParam.angle));
      route[KEY.to] = to;
      return route;
    }

    const from: JsonOut = {};
    put(from, KEY.angle, paramOf(first, ConnectionParam.angle));
    route[KEY.from] = from;
    const to: JsonOut = {};
    put(to, KEY.angle, paramOf(last, ConnectionParam.angle));
    route[KEY.to] = to;

    if (type === ConnectionType.MultiLine) {
      const segments: JsonValue[] = [];
      for (const pm of params) {
        const segment: JsonOut = {};
        put(segment, KEY.length, paramOf(pm, ConnectionParam.step));
        put(segment, KEY.dx, paramOf(pm, ConnectionParam.dx));
        put(segment, KEY.dy, paramOf(pm, ConnectionParam.dy));
        segments.push(segment);
      }
      route[KEY.segments] = segments;
      return route;
    }

    // Path.
    const points: JsonValue[] = [];
    params.forEach((pm, i) => {
      const point: JsonOut = {};
      put(point, KEY.dx, paramOf(pm, ConnectionParam.dx));
      put(point, KEY.dy, paramOf(pm, ConnectionParam.dy));
      const c1x = paramOf(pm, ConnectionParam.dc1x);
      const c1y = paramOf(pm, ConnectionParam.dc1y);
      if (c1x !== undefined && c1y !== undefined) point[KEY.controlIn] = { [KEY.dx]: g6(c1x), [KEY.dy]: g6(c1y) };
      const c2x = paramOf(pm, ConnectionParam.dc2x);
      const c2y = paramOf(pm, ConnectionParam.dc2y);
      if (c2x !== undefined && c2y !== undefined) point[KEY.controlOut] = { [KEY.dx]: g6(c2x), [KEY.dy]: g6(c2y) };
      if (i > 0 && i + 1 < params.length) put(point, KEY.angle, paramOf(pm, ConnectionParam.angle));
      points.push(point);
    });
    route[KEY.points] = points;
    return route;
  }

  // ---------------------------------------------------------------- arrow

  /** An arrowhead reads as its catalogue name, or its raw id when the registry does not name it. */
  private projectArrow(node: JsonOut, arrows: ArrowHeads): void {
    const start = arrows.start();
    const end = arrows.end();
    if (start === null && end === null) return;
    node[KEY.arrow] = {
      [KEY.start]: start !== null ? arrowWordFor(this.ctx_.arrows, start) : null,
      [KEY.end]: end !== null ? arrowWordFor(this.ctx_.arrows, end) : null,
    };
  }

  // ---------------------------------------------------------------- style

  /** Style as deviations only: what `serializeStyle` writes, renamed; `textOnly` for a title's pins. */
  private projectStyle(node: JsonOut, style: Style, textOnly = false): void {
    const stored = serializeStyle(style);
    const out: JsonOut = {};
    let count = 0;
    for (const key of Object.keys(stored).sort()) {
      if (key === NON_OVERRIDABLES) continue;
      const name = semanticStyleKey(key);
      if (name === null || (textOnly && !isTextStyleKey(key))) continue;
      const value = stored[key];
      let projected: JsonValue | undefined;
      const intVal = typeof value === 'number' ? Math.trunc(value) : 0;
      switch (key) {
        case 'strokepaint':
        case 'fillpaint':
        case 'textfill':
          projected = isJsonObject(value) ? projectPaint(value) : undefined;
          break;
        case 'joinstyle':
          projected = enumName(JOIN_STYLES, intVal, 'default');
          break;
        case 'capstyle':
          projected = enumName(CAP_STYLES, intVal, 'default');
          break;
        case 'textalignhorizontal':
          projected = enumName(TEXT_ALIGN_HORIZONTALS, intVal, 'default');
          break;
        case 'textalignvertical':
          projected = enumName(TEXT_ALIGN_VERTICALS, intVal, 'default');
          break;
        case 'textdecoration':
          projected = textDecorationNode(intVal);
          break;
        case 'fontweight':
          projected = enumName(FONT_WEIGHTS, intVal, 'default');
          break;
        case 'fontstyle':
          projected = enumName(FONT_STYLES, intVal, 'default');
          break;
        default:
          if (value === null || value === undefined) projected = undefined;
          else if (typeof value === 'object') projected = roundNumbers(value);
          else if (typeof value === 'number') projected = g6(value);
          else projected = value;
      }
      if (projected === undefined) continue;
      out[name] = projected;
      count++;
    }
    if (count === 0) return;
    node[KEY.style] = out;
  }
}

/** A paint as an agent reads it: a colour, "none", or `{type, color?}` for a gradient or pattern. */
function projectPaint(stored: JsonObject): JsonValue {
  const t = stored['type'];
  const type = typeof t === 'number' && Number.isInteger(t) ? t : PaintType.NoPaint;
  if (type === PaintType.Default || type === PaintType.NoPaint) return 'none';
  const c = stored['color'];
  const packed = typeof c === 'number' && Number.isInteger(c) ? c : undefined;
  if (type === PaintType.Solid) return packed === undefined ? 'none' : colorToHex(Color.fromInt(packed));
  const paint: JsonOut = { [KEY.type]: enumName(PAINT_TYPES, type, '') };
  if (packed !== undefined) paint[KEY.color] = colorToHex(Color.fromInt(packed));
  return paint;
}

/** A cloned value with every non-integral number `g6()`-rounded (C++ FLOAT nodes print at 6 digits). */
function roundNumbers(v: JsonValue): JsonValue {
  if (typeof v === 'number') return Number.isInteger(v) ? v : g6(v);
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return (v as readonly JsonValue[]).map(roundNumbers);
  const out: JsonOut = {};
  for (const k of Object.keys(v)) out[k] = roundNumbers((v as JsonObject)[k] as JsonValue);
  return out;
}
