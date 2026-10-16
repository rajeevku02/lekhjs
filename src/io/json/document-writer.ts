// `LekhDocument` → `.lekh` JSON (port of C++ `JsonObjectSerializer::serialize`, `serializeInfo`,
// `serializeDocAttributes`, `serializePage`, `serializeBackground`, `serializeObjects`,
// `serializeObject` and the per-kind `serialize*` functions, `serializeArrowInfo`,
// `serializeEmbedTemplates` and `serializeObjectHelp`, `L/document/Serializer.cpp:226-252,
// 359-456, 612-699, 744-808, 831-846, 1535-1593, 1789-1829, 2069-2105, 2250-2354, 2629-2645,
// 3117-3133, 3188-3255`; spec 02 `JsonDocumentWriter`, spec 03 §10.2).
//
// Field-by-field content is today's: `order` on every object, `text` and `style` only on
// non-templated, non-group objects, no group style, the generated parts of a regenerating template
// left out, `embedrefs` sorted. Then:
//   - `info.version` comes from the write's stamp policy (`FormatStamp`), never from process state;
//   - the root `style` is the session's current drawing style (a headless write: none);
//   - embed templates and help whose ids collide after `.` → `_` are written deterministically:
//     ids sorted by UTF-8 bytes, the first wins (B14, DR-ENG-19; C++ kept whichever a hash map
//     visited first);
//   - the text has its keys sorted and escaped and no non-finite number (`writeJsonText`).
// There is no legacy branch: legacy types never reach the writer (AC-ENG-35).
import {
  BackgroundType,
  ConnectionObject,
  GroupObject,
  MultiObjects,
  Page,
  TemplatedObject,
  UnrecognizedObject,
  type ArrowHeads,
  type LekhDocument,
  type LekhObject,
} from '../../model';
import { Length, Style } from '../../style';
import type { JsonObject, JsonValue, ShapeTemplate } from '../../template';
import { serializeStyleIfNeeded } from '../codec/style-codec';
import type { TemplateDataCodec, TemplateWriteOptions } from '../codec/template-data-codec';
import { FormatStamp, documentUsesTitle, type StampPolicy } from '../format/format-stamp';
import { compareUtf8 } from './json-fields';
import { writeJsonText } from './json-writer';

type Out = Record<string, JsonValue>;

export interface WriteOptions {
  /** The version policy (spec 04 §9.2). */
  readonly stamp: StampPolicy;
  /** The root `style`: the session's current drawing style. Default: none written. */
  readonly style?: Style;
  /** A template's help text (C++ `TemplateStore::getHelp`). Default: none. */
  readonly help?: (templateId: string) => string | undefined;
  /** A generator's embed reference that no object embeds (C++ `TemplateStore`, then the document). */
  readonly resolveTemplate?: (id: string) => ShapeTemplate | null;
  /** Inline a referenced image's data into its slot (C++ `serializeImageFromSrc`). */
  readonly inlineImage?: TemplateWriteOptions['inlineImage'];
}

export interface WriteResult {
  readonly json: JsonObject;
  /** The JSON text (keys sorted, non-finite numbers as 0). */
  readonly text: string;
  /** The `info.version` written. */
  readonly version: string;
  /** Non-finite numbers written as 0 (logged once per write as `nonfinite_write`). */
  readonly nonFinite: number;
}

/** C++ `replace(str, '.', '_')`: the key an embed or help entry is written under. */
function dotsToUnderscores(id: string): string {
  return id.split('.').join('_');
}

export class JsonDocumentWriter {
  private readonly codec: TemplateDataCodec;
  private readonly opts: WriteOptions;
  private hasJs = false;
  private readonly tOpts: TemplateWriteOptions;

  constructor(codec: TemplateDataCodec, opts: WriteOptions) {
    this.codec = codec;
    this.opts = opts;
    this.tOpts = {
      onJsGenerator: () => {
        this.hasJs = true;
      },
      ...(opts.inlineImage !== undefined ? { inlineImage: opts.inlineImage } : {}),
    };
  }

  /** The whole document. */
  write(doc: LekhDocument): WriteResult {
    this.hasJs = false;
    const root: Out = {};
    root['attributes'] = {
      grid: { present: doc.grid.present },
      scaling: { unit: Length.unitStr(doc.scaling.unit), scale: doc.scaling.value },
    };
    const pages: Out = {};
    for (const page of doc.pages) {
      if (!Object.prototype.hasOwnProperty.call(pages, page.id)) pages[page.id] = this.page(page);
    }
    root['pages'] = pages;
    this.embedTemplates(root, doc);
    this.objectHelp(root, doc);
    serializeStyleIfNeeded(root, this.opts.style ?? new Style());
    const version = FormatStamp.versionFor(this.opts.stamp, {
      hasJsGenerators: this.hasJs,
      usesTitle: documentUsesTitle(doc),
    });
    root['info'] = {
      author: doc.info.author,
      version,
      title: doc.info.title,
      description: doc.info.description,
      platform: doc.info.createdOnPlatform,
    };
    const stats = { nonFinite: 0 };
    const text = writeJsonText(root, stats);
    return { json: root, text, version, nonFinite: stats.nonFinite };
  }

  /** True when a template written since the last `write` (or construction) had a JS generator. */
  wroteJsGenerator(): boolean {
    return this.hasJs;
  }

  /** C++ `serializePage`. */
  page(page: Page): JsonObject {
    const node: Out = { objects: this.objects(page.objectStore.objects) };
    node['background'] = this.background(page);
    node['name'] = page.name;
    node['order'] = page.order;
    const size = page.size;
    node['size'] = { width: size.width, height: size.height, unit: Length.unitStr(size.unit) };
    if (page.margin.show) {
      const m = page.margin.size;
      node['margin'] = { width: m.width, height: m.height, unit: Length.unitStr(m.unit) };
    }
    node['canvassizetype'] = Page.sizeTypeToStr(page.canvasSizeType);
    node['canvasname'] = page.canvasName;
    return node;
  }

  /** C++ `serializeBackground`. */
  background(page: Page): JsonObject {
    const b = page.background;
    if (b.imageData !== '' && b.type === BackgroundType.Image) return { data: b.imageData };
    return { color: b.color.toInt() };
  }

  /** C++ `serializeObjects`: by id; a repeated id keeps the first (`addField` inserts). */
  objects(objs: readonly LekhObject[]): JsonObject {
    const node: Out = {};
    for (const o of objs) {
      if (!Object.prototype.hasOwnProperty.call(node, o.id)) node[o.id] = this.object(o);
    }
    return node;
  }

  /** C++ `serializeObject`. */
  object(obj: LekhObject): JsonObject {
    const node: Out = { order: obj.order };
    let templated = false;
    if (obj instanceof GroupObject) {
      this.group(obj, node);
      templated = true;
    } else if (obj instanceof UnrecognizedObject) {
      this.unrecognized(obj, node);
    } else if (obj instanceof MultiObjects) {
      this.multi(obj, node);
      templated = true;
    } else if (obj instanceof TemplatedObject) {
      this.templated(obj, node);
      templated = true;
    } else if (obj instanceof ConnectionObject) {
      this.connection(obj, node);
    }
    if (!templated) {
      node['text'] = obj.text;
      serializeStyleIfNeeded(node, obj.drawingProfile);
    }
    return node;
  }

  private box(obj: TemplatedObject): Out {
    const ds = obj.ds;
    return { cx: ds.cx(), cy: ds.cy(), width: ds.width(), height: ds.height(), angle: ds.angle() };
  }

  private templated(obj: TemplatedObject, node: Out): void {
    node['type'] = 'templated';
    node['name'] = obj.nameInLibraryView;
    const t = obj.shapeTemplate();
    if (t !== null) node['template'] = this.codec.serialize(t, this.tOpts);
    node['params'] = this.box(obj);
    this.arrows(obj.arrows, node);
  }

  private group(obj: GroupObject, node: Out): void {
    node['type'] = 'avabodh.basic.group';
    node['name'] = obj.nameInLibraryView;
    node['params'] = { ...this.box(obj), orig_width: obj.origWidth(), orig_height: obj.origHeight() };
    const objects: Out = {};
    for (const co of obj.objects()) {
      if (Object.prototype.hasOwnProperty.call(objects, co.object.id)) continue;
      const c = co.origRect.center();
      objects[co.object.id] = {
        orig_cx: c.x,
        orig_cy: c.y,
        orig_width: co.origRect.width,
        orig_height: co.origRect.height,
        orig_angle: co.origAngle,
        xfactor: co.xfactor,
        yfactor: co.yfactor,
        index: Math.trunc(co.index),
        object: this.object(co.object),
      };
    }
    node['objects'] = objects;
  }

  private multi(obj: MultiObjects, node: Out): void {
    node['type'] = 'multi';
    node['name'] = obj.nameInLibraryView;
    node['params'] = this.box(obj);
    node['objects'] = this.objects(obj.objects().map((i) => i.object));
  }

  private unrecognized(obj: UnrecognizedObject, node: Out): void {
    node['type'] = 'avabodh.basic.unrecognized';
    node['params'] = this.box(obj);
    node['points'] = obj.normalizedPoints().map((p) => ({ x: p.x, y: p.y }));
  }

  private connection(obj: ConnectionObject, node: Out): void {
    node['type'] = 'avabodh.basic.connection';
    node['source'] = obj.first?.id ?? obj.srcObjId;
    node['target'] = obj.second?.id ?? obj.targetObjId;
    node['ctype'] = obj.getType();
    node['params'] = obj.getParams().map((pm) => ({ ...pm }));
    node['texts'] = obj
      .textInfos()
      .filter((t) => t.text !== '')
      .map((t) => ({ text: t.text, param: t.param }));
    this.arrows(obj.arrows, node);
  }

  /** C++ `serializeArrowInfo`. */
  private arrows(arr: ArrowHeads, node: Out): void {
    const start = arr.start();
    const end = arr.end();
    if (start === null && end === null) return;
    const arrows: Out = {};
    if (start !== null) arrows['start'] = this.codec.serialize(start, this.tOpts);
    if (end !== null) arrows['end'] = this.codec.serialize(end, this.tOpts);
    node['arrows'] = arrows;
  }

  /** C++ `serializeEmbedTemplates`. */
  private embedTemplates(root: Out, doc: LekhDocument): void {
    const all = new Map<string, ShapeTemplate>();
    const refs = new Set<string>();
    const visit = (obj: LekhObject) => {
      if (obj instanceof GroupObject) {
        for (const m of obj.objects()) visit(m.object);
        return;
      }
      if (!(obj instanceof TemplatedObject)) return;
      const t = obj.shapeTemplate();
      if (t === null) return;
      for (const e of t.embeds()) if (!all.has(e.template.id())) all.set(e.template.id(), e.template);
      if (t.generator !== null) for (const r of t.generator.embedReferences()) refs.add(r);
    };
    for (const page of doc.pages) for (const obj of page.objectStore.objects) visit(obj);
    if (all.size === 0 && refs.size === 0) return;

    const templates: Out = {};
    for (const id of [...all.keys()].sort(compareUtf8)) {
      const key = dotsToUnderscores(id);
      const t = all.get(id);
      if (t !== undefined && !Object.prototype.hasOwnProperty.call(templates, key)) {
        templates[key] = this.codec.serialize(t, this.tOpts);
      }
    }
    for (const id of [...refs].sort(compareUtf8)) {
      if (all.has(id)) continue;
      const t = this.opts.resolveTemplate?.(id) ?? null;
      if (t === null) continue;
      const key = dotsToUnderscores(t.id());
      if (!Object.prototype.hasOwnProperty.call(templates, key)) templates[key] = this.codec.serialize(t, this.tOpts);
    }
    root['templates'] = templates;
  }

  /** C++ `serializeObjectHelp`: the top-level templated objects' help texts. */
  private objectHelp(root: Out, doc: LekhDocument): void {
    const lookup = this.opts.help;
    if (lookup === undefined) return;
    const helps = new Map<string, string>();
    for (const page of doc.pages) {
      for (const obj of page.objectStore.objects) {
        if (!(obj instanceof TemplatedObject)) continue;
        const t = obj.shapeTemplate();
        if (t === null) continue;
        const text = lookup(t.id());
        if (text !== undefined) helps.set(t.id(), text);
      }
    }
    if (helps.size === 0) return;
    const node: Out = {};
    for (const id of [...helps.keys()].sort(compareUtf8)) {
      const key = dotsToUnderscores(id);
      if (!Object.prototype.hasOwnProperty.call(node, key)) node[key] = { id, text: helps.get(id) ?? '' };
    }
    root['help'] = node;
  }
}
