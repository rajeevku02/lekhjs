// The io entry point (port of C++ `DocManager::load` / `serializeDoc`, `L/document/DocManager.cpp`;
// spec 02 `DocumentCodec`, spec 03 §10). It sniffs XML vs JSON, reads with the lenient fallback,
// writes with a stamp policy, and is the one place the other carriers come through: a cloud
// `load` (an already-parsed document), a paste (a `multi` object) and a library item. Every one
// converts legacy objects and Lua generators on the way in (spec 03 §10.4, spec 04 §7.1).
//
// No state outlives a call: each read has its own `LoadContext`, each write its own writer, so
// concurrent sessions — and two writes with different policies — never interact (AC-ENG-20).
import { Point, Rect } from '../geometry';
import { ConnectionObject, type LekhDocument, type LekhObject } from '../model';
import {
  defaultEmbedFrame,
  type EmbedFactory,
  type JsonObject,
  type JsonValue,
  type ShapeTemplate,
  type TemplateDef,
  type TemplateFactory,
} from '../template';
import { completeHooks } from './codec/generator-hooks';
import { TemplateDataCodec } from './codec/template-data-codec';
import { JsonDocumentReader, type ReadResult } from './json/document-reader';
import { JsonDocumentWriter, type WriteOptions, type WriteResult } from './json/document-writer';
import { numField, objField } from './json/json-fields';
import { parseJsonText } from './json/lenient-json';
import { ObjectReader } from './json/object-reader';
import { LoadContext, type IoEnv } from './load-context';
import { XmlDocumentReader } from './xml/xml-document-reader';

export class DocumentCodec {
  readonly env: IoEnv;
  /** The template codec for catalog templates (the session's own environment). */
  readonly templates: TemplateDataCodec;

  constructor(env: IoEnv) {
    // Every reader and writer of this codec shares one set of complete generator hooks.
    this.env = { ...env, generators: completeHooks(env.generators) };
    this.templates = new TemplateDataCodec(env.templates, this.env.generators);
  }

  /** A file's or a stored board's text → document. Throws `LoadError`. */
  read(text: string): ReadResult {
    if (XmlDocumentReader.isXml(text)) return new XmlDocumentReader(this.env).read(text);
    const parsed = parseJsonText(text);
    if (parsed.nonFinite > 0) this.env.logger?.warn('nonfinite_read', { count: parsed.nonFinite });
    return new JsonDocumentReader(this.env).read(parsed.value, parsed.nonFinite);
  }

  /** An already-parsed document (a cloud `load` frame's document). Throws `LoadError`. */
  readValue(json: JsonValue): ReadResult {
    return new JsonDocumentReader(this.env).read(json);
  }

  /** The document as `.lekh` JSON under `opts.stamp` (spec 04 §9.2). */
  write(doc: LekhDocument, opts: WriteOptions): WriteResult {
    const writer = new JsonDocumentWriter(this.templates, {
      help: this.env.help,
      resolveTemplate: (id) => this.resolveForWrite(doc, id),
      ...opts,
    });
    const out = writer.write(doc);
    if (out.nonFinite > 0) this.env.logger?.warn('nonfinite_write', { count: out.nonFinite });
    return out;
  }

  /** `write(doc, opts).text`. */
  serialize(doc: LekhDocument, opts: WriteOptions): string {
    return this.write(doc, opts).text;
  }

  /** C++ `TemplateStore::getTemplate`, then the document's own definition. */
  private resolveForWrite(doc: LekhDocument, id: string): ShapeTemplate | null {
    const fromCatalog = this.env.templates.resolver.getTemplate(id);
    if (fromCatalog !== null) return fromCatalog;
    const def = doc.get(id);
    if (def === undefined) return null;
    return new LoadContext(this.env, doc).codec.instantiate(def);
  }

  /**
   * One object from its JSON (a paste's `multi` object, a library item, a realtime
   * `addobjects` entry): legacy types and Lua converted, connectors inside a `multi` fixed up.
   * `doc` supplies the templates embeds fall back to. Throws `LoadError` (`object_parse`).
   */
  readObject(json: JsonValue, id: string = this.env.objects.newId(), doc: LekhDocument | null = null): ReadObject {
    const ctx = new LoadContext(this.env, doc);
    const obj = new ObjectReader(ctx).parseObject(id, json);
    return { object: obj, convertedLua: ctx.stats.converted > 0, warnings: ctx.warnings().map((w) => w.code) };
  }

  /**
   * Several objects keyed by id (an `addobjects` frame's map): parsed, then connectors fixed up
   * against the objects of the frame and of `existing` (an id lookup on the page).
   */
  readObjects(
    objects: JsonObject,
    doc: LekhDocument | null = null,
    existing: (id: string) => LekhObject | undefined = () => undefined,
  ): { objects: LekhObject[]; convertedLua: boolean } {
    const ctx = new LoadContext(this.env, doc);
    const reader = new ObjectReader(ctx);
    const objs = reader.parseObjects({ objects });
    const out: LekhObject[] = [];
    for (const o of objs) {
      if (o instanceof ConnectionObject) {
        for (const id of [o.srcObjId, o.targetObjId]) {
          const e = existing(id);
          if (e !== undefined && !ctx.objMap.has(id)) ctx.objMap.set(id, e);
        }
        if (!reader.fixConnector(o)) continue;
      }
      out.push(o);
    }
    return { objects: out, convertedLua: ctx.stats.converted > 0 };
  }

  /** One object's JSON (C++ `serializeObject`), e.g. a library item saved by TS. */
  writeObject(obj: LekhObject): JsonObject {
    return new JsonDocumentWriter(this.templates, { stamp: 'cloud' }).object(obj);
  }

  /** The factory a `CatalogOverlay` instantiates definitions with. */
  templateFactory(): TemplateFactory {
    return (def: TemplateDef) => this.templates.instantiate(def);
  }

  /**
   * The embed factory a `CatalogTemplateResolver` is given: a library object's template in its
   * stored box (C++ `TemplatedObject::clone`), or a bare template at its default size.
   */
  embedFactory(): EmbedFactory {
    return (def: TemplateDef) => {
      const template = this.templates.instantiate(def);
      if (def.object === null) return { template, ...defaultEmbedFrame(template) };
      const params = objField(def.object, 'params');
      const rect = Rect.fromCenter(
        new Point(numField(params, 'cx') ?? 0, numField(params, 'cy') ?? 0),
        numField(params, 'width') ?? 1,
        numField(params, 'height') ?? 1,
      );
      return { template, rect, angle: numField(params, 'angle') ?? 0 };
    };
  }
}

/** What `readObject` produced. */
export interface ReadObject {
  readonly object: LekhObject;
  readonly convertedLua: boolean;
  readonly warnings: readonly string[];
}
