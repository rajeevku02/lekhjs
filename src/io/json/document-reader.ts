// `.lekh` JSON → `LekhDocument` (port of C++ `JsonObjectSerializer::deserialize`,
// `parseSinglePageDocument`, `parseMultiplePagesDocument`, `parsePage`, `parseMetaInfo`,
// `parseDocAttributes`, `parseBackground` and `fixConnections`, `L/document/Serializer.cpp:255-596,
// 762-829, 3303-3345`; spec 02 `JsonDocumentReader`, spec 03 §10.1).
//
// Beyond a straight port:
//   - `info.version` is checked by `FormatVersion` ([2.0, 5.0], typed errors, spec 04 §9.1), and
//     may be a JSON number;
//   - `pages` present but empty (`{}`, `[]`) gives one default empty page, and no `pages` key the
//     single-page form; neither writes anything (AC-ENG-34);
//   - a phantom page (an entry holding only `objects`, from the old silent-empty-board bug) is kept
//     as "Recovered", "Recovered 2", … after the real pages, in memory only (DR-FMT-01);
//   - document templates are kept as frozen definitions (`TemplateDef`), and the help texts the
//     file carries are returned rather than written into a global store.
// Ported as is: a black page background is lost on load (OQ-13); connectors are fixed up against
// every object of the document, and one with a missing end is dropped.
import { Color, Length, Scaling, type Style } from '../../style';
import { CanvasSizeType, ConnectionObject, LekhDocument, Page, PageSize, type LekhObject } from '../../model';
import {
  buildTemplateDef,
  isJsonObject,
  isReferenceOnly,
  type CatalogIssue,
  type JsonObject,
  type JsonValue,
} from '../../template';
import { LoadError } from '../errors';
import { FormatVersion } from '../format/format-version';
import { completeHooks } from '../codec/generator-hooks';
import { parseStyleOrDrawingProfile } from '../codec/style-codec';
import { LoadContext, type IoEnv, type LoadWarning } from '../load-context';
import {
  boolField,
  colorField,
  hasMember,
  intField,
  member,
  membersInByteOrder,
  numField,
  objField,
  strField,
} from './json-fields';
import { ObjectReader } from './object-reader';

/** What a read produced besides the document. */
export interface ReadResult {
  readonly doc: LekhDocument;
  readonly format: 'json' | 'xml';
  /** `info.version` as read ('1.0' style for XML). */
  readonly version: string;
  /** A Lua generator was converted to JS while reading (spec 04 §7.3). */
  readonly convertedLua: boolean;
  /** XML only: the drawing profile the file carried (C++ wrote it into the current style). */
  readonly currentStyle: Style | null;
  /** The help texts the file carries, by template id (C++ `TemplateStore::setHelpIfRequired`). */
  readonly help: ReadonlyMap<string, string>;
  /** Ids of the phantom pages kept as "Recovered" (DR-FMT-01). */
  readonly recoveredPages: readonly string[];
  readonly warnings: readonly LoadWarning[];
  /**
   * The parsed JSON document as stored (never modified; `null` for XML). A writer session reads
   * which stored templates held Lua from it (the conversion frame, spec 04 §9.4).
   */
  readonly source: JsonValue | null;
}

/** What `readPage` produced. */
export interface PageRead {
  readonly page: Page;
  /** Connectors dropped because an end is not on the page. */
  readonly droppedConnectors: number;
  readonly convertedLua: boolean;
}

const RECOVERED = 'Recovered';

/** C++ `parseBackground`. */
export function parseBackground(back: JsonValue | undefined, page: Page): void {
  const data = strField(back, 'data');
  const color = colorField(back, 'color');
  if (data !== undefined && data !== '') {
    page.background.setImageData(data);
  } else if (color !== undefined) {
    const cl = Color.fromInt(color);
    // As C++: black reads as "no colour" (OQ-13).
    if (!(cl.red === 0 && cl.green === 0 && cl.blue === 0)) page.background.setColor(cl);
  }
  const grid = boolField(back, 'grid');
  if (grid !== undefined) page.background.setGrid(grid);
}

/** C++ `Page::Size` from `{width, height, unit}`. */
function parseSize(node: JsonObject): PageSize {
  const unitStr = strField(node, 'unit');
  return new PageSize(
    unitStr !== undefined ? Length.unitFromStr(unitStr) : undefined,
    numField(node, 'width') ?? 0,
    numField(node, 'height') ?? 0,
  );
}

export class JsonDocumentReader {
  private readonly env: IoEnv;

  constructor(env: IoEnv) {
    this.env = env;
  }

  /** Reads a parsed document (a file's JSON, or a cloud `load` frame's document). */
  read(root: JsonValue, nonFinite = 0): ReadResult {
    if (!isJsonObject(root)) throw new LoadError('json_parse', { reason: 'not_an_object' });
    const doc = new LekhDocument(this.env.document);
    const ctx = new LoadContext(this.env, doc);
    if (nonFinite > 0) ctx.note('nonfinite_read', nonFinite);
    const objects = new ObjectReader(ctx);

    if (!parseStyleOrDrawingProfile(root, doc.style)) throw new LoadError('object_parse', { reason: 'root_style' });
    this.parseTemplates(root, doc, ctx);
    const help = this.parseHelp(root);
    const onHelp = this.env.onHelp;
    if (onHelp !== undefined) for (const [id, text] of help) onHelp(id, text);

    const recovered: string[] = [];
    if (hasMember(root, 'pages')) {
      this.parseMetaInfo(root, doc);
      const attrs = objField(root, 'attributes');
      if (attrs !== undefined) this.parseDocAttributes(attrs, doc);
      const pages: Page[] = [];
      const phantoms: Page[] = [];
      for (const [id, node] of membersInByteOrder(member(root, 'pages'))) {
        const page = new Page(id, '', doc.storeOptions);
        this.parsePage(node, page, objects);
        if (isJsonObject(node) && Object.keys(node).length === 1 && hasMember(node, 'objects')) phantoms.push(page);
        else pages.push(page);
      }
      let order = pages.reduce((m, p) => Math.max(m, p.order), 0);
      phantoms.forEach((p, i) => {
        p.name = i === 0 ? RECOVERED : `${RECOVERED} ${String(i + 1)}`;
        p.order = ++order;
        recovered.push(p.id);
      });
      doc.setPages([...pages, ...phantoms]);
      this.fixConnections(doc, objects);
    } else {
      this.parseMetaInfo(root, doc);
      const page = doc.activePage();
      const back = member(root, 'background');
      if (back !== undefined) parseBackground(back, page);
      for (const obj of objects.parseObjects(root)) page.objectStore.add(obj);
      this.fixConnections(doc, objects);
      doc.grid.present = page.background.hasGrid;
    }

    for (const w of ctx.warnings()) this.env.logger?.debug(`io: ${w.code}`, { count: w.count });
    return {
      doc,
      format: 'json',
      version: doc.info.version,
      convertedLua: ctx.stats.converted > 0,
      currentStyle: null,
      help,
      recoveredPages: recovered,
      warnings: ctx.warnings(),
      source: root,
    };
  }

  /**
   * One page entry on its own (a realtime `addpages` frame, `PageAddDeleteAction`): the page is
   * parsed with id `id` against `doc`'s templates, and its connectors are fixed up within the page.
   * A connector whose end is not on the page is dropped and counted. Throws `LoadError`.
   */
  readPage(node: JsonValue, id: string, doc: LekhDocument): PageRead {
    const ctx = new LoadContext(this.env, doc);
    const objects = new ObjectReader(ctx);
    const page = new Page(id, '', doc.storeOptions);
    this.parsePage(node, page, objects);
    let droppedConnectors = 0;
    for (const obj of [...page.objectStore.objects]) {
      if (obj instanceof ConnectionObject && !objects.fixConnector(obj)) {
        page.objectStore.remove(obj);
        droppedConnectors++;
      }
    }
    return { page, droppedConnectors, convertedLua: ctx.stats.converted > 0 };
  }

  /** C++ `parseMetaInfo`: `info` is required, and so is a readable version. */
  private parseMetaInfo(root: JsonObject, doc: LekhDocument): void {
    const info = objField(root, 'info');
    if (info === undefined) throw new LoadError('format_invalid', { reason: 'no_info' });
    const i = doc.info;
    i.author = strField(info, 'author') ?? i.author;
    i.title = strField(info, 'title') ?? i.title;
    i.description = strField(info, 'description') ?? i.description;
    i.createdOnPlatform = strField(info, 'platform') ?? i.createdOnPlatform;
    const raw = member(info, 'version');
    FormatVersion.checkReadable(raw);
    i.version = typeof raw === 'string' ? raw : JSON.stringify(raw);
  }

  /** C++ `parseDocAttributes`. */
  private parseDocAttributes(node: JsonObject, doc: LekhDocument): void {
    const present = boolField(objField(node, 'grid'), 'present');
    if (present !== undefined) doc.grid.present = present;
    const scaling = objField(node, 'scaling');
    const unitStr = strField(scaling, 'unit');
    if (unitStr !== undefined) {
      const scale = numField(scaling, 'scale');
      if (scale !== undefined) doc.scaling = new Scaling(Length.unitFromStr(unitStr), scale);
    }
  }

  /** The document's `templates` (a map or a list) as definitions. */
  private parseTemplates(root: JsonObject, doc: LekhDocument, ctx: LoadContext): void {
    const templates = member(root, 'templates');
    let bodies: JsonValue[] = [];
    if (isJsonObject(templates)) bodies = membersInByteOrder(templates).map(([, v]) => v);
    else if (Array.isArray(templates)) bodies = (templates as readonly JsonValue[]).slice();
    const issues: CatalogIssue[] = [];
    const resolve = this.env.generators?.resolve ?? completeHooks(undefined).resolve;
    for (const body of bodies) {
      if (!isJsonObject(body) || typeof body['id'] !== 'string') {
        ctx.note('template_skipped');
        continue;
      }
      // A reference body names a catalog template; C++ kept it only when the catalog had it.
      if (isReferenceOnly(body) && ctx.getTemplate(body['id']) === null) {
        ctx.note('template_skipped');
        continue;
      }
      const def = buildTemplateDef(body, resolve, issues);
      if (def === null) {
        ctx.note('template_skipped');
        continue;
      }
      if (def.converted) ctx.stats.converted++;
      doc.addTemplate(def);
    }
  }

  /** The `help` member: `key: text`, or `key: {id, text}`. */
  private parseHelp(root: JsonObject): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, item] of membersInByteOrder(member(root, 'help'))) {
      if (typeof item === 'string') {
        if (!out.has(key)) out.set(key, item);
      } else if (isJsonObject(item)) {
        const id = strField(item, 'id');
        const text = strField(item, 'text');
        if (id !== undefined && text !== undefined && !out.has(id)) out.set(id, text);
      }
    }
    return out;
  }

  /** C++ `parsePage`. */
  private parsePage(node: JsonValue, page: Page, objects: ObjectReader): void {
    const back = member(node, 'background');
    if (back !== undefined) parseBackground(back, page);
    const name = strField(node, 'name');
    if (name !== undefined) page.name = name;
    page.order = intField(node, 'order') ?? 0;
    const sizeType = strField(node, 'canvassizetype');
    if (sizeType !== undefined) page.canvasSizeType = Page.sizeTypeFromStr(sizeType);
    const canvasName = strField(node, 'canvasname');
    if (canvasName !== undefined) page.canvasName = canvasName;
    const size = objField(node, 'size');
    if (size !== undefined) {
      const sz = parseSize(size);
      if (sz.width <= 0 || sz.height <= 0) {
        if (page.canvasSizeType !== CanvasSizeType.Infinite) page.canvasSizeType = CanvasSizeType.Auto;
      }
      page.size = sz;
    }
    const margin = objField(node, 'margin');
    if (margin !== undefined) {
      const sz = parseSize(margin);
      if (sz.width > 0 || sz.height > 0) page.margin = { show: true, size: sz };
    }
    for (const obj of objects.parseObjects(node)) page.objectStore.add(obj);
  }

  /** C++ `fixConnections(doc, ignoreError = true)`: unresolvable connectors are dropped. */
  private fixConnections(doc: LekhDocument, objects: ObjectReader): void {
    for (const page of doc.pages) {
      const drop: LekhObject[] = [];
      for (const obj of page.objectStore.objects) {
        if (obj instanceof ConnectionObject && !objects.fixConnector(obj)) drop.push(obj);
      }
      for (const obj of drop) page.objectStore.remove(obj);
    }
  }
}
