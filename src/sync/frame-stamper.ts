// The realtime format stamp (spec 04 §9.3-§9.4; spec 02 `FrameStamper`).
//
// The session tracks `docFormat`: the `info.version` its `load` carried, raised by its own and its
// peers' stamp keys. Rules:
//   - an outgoing `addobjects`, `convertobjects` or `changeattr` frame that writes a template with
//     a JS-form generator while `docFormat < 5.0` gets `"doc.info.version": "5.0"` in the same
//     `changes`, and `docFormat` becomes 5.0 at once; later frames carry no stamp;
//   - the conversion frame (Lua templates converted on a writer's open) is a `changeattr` split
//     into chunks: a chunk closes when the next template key would take it past 200 template keys
//     or 512 KB of serialized frame (UTF-8 bytes of the whole frame); `doc.templates.*` keys go in
//     the first chunk; a template alone over 512 KB goes in a chunk of its own; every chunk
//     carries the stamp; there are no `conditions`;
//   - an incoming frame's stamp key, in any update type, updates `docFormat` (AC-FMT-08); a valid
//     stamp above this engine's latest version asks the host to reload (the reload then fails with
//     `format_too_new`, spec 04 §10.2).
// Placeholders never stamp: whether a generator is JS-form is the injected `isJsForm` (the
// session's registry knows which ids are known), defaulting to the marker test.
import { FormatVersion, writeJsonText } from '../io';
import { classifyGenerator, isJsonObject, type JsonObject, type JsonValue } from '../template';
import { FORMAT_STAMP_KEY, updatetypes } from './consts';
import { splitKey, utf8Length } from './paths';

/** Chunk caps of the conversion frame (spec 04 §9.4). */
export const CONVERSION_MAX_TEMPLATES = 200;
export const CONVERSION_MAX_BYTES = 512 * 1024;

/** Whether a template's `generator` block is JS-form for a known module (spec 04 §7.4). */
export type JsFormTest = (generator: JsonObject, templateId: string) => boolean;

const defaultJsForm: JsFormTest = (g) => classifyGenerator(g).kind === 'js';

/** One template key of a conversion frame. */
export interface ConversionEntry {
  /** `doc.templates.<id_with_dots_as_underscores>` or `doc.pages.<p>.objects.<o>.template`. */
  readonly key: string;
  readonly template: JsonValue;
}

/** What an incoming stamp did. */
export interface StampObservation {
  /** The stamp's value, when the frame carried a valid one. */
  readonly stamp: string | null;
  /** `docFormat` was raised by it. */
  readonly raised: boolean;
  /** The stamp is above this engine's latest version. */
  readonly aboveLatest: boolean;
}

function parseVersion(v: string): FormatVersion | null {
  return FormatVersion.parse(v);
}

export class FrameStamper {
  private docFormat_: string;
  private readonly isJsForm_: JsFormTest;

  constructor(docFormat: string, isJsForm: JsFormTest = defaultJsForm) {
    this.docFormat_ = docFormat;
    this.isJsForm_ = isJsForm;
  }

  /** The board's format as this session knows it. */
  get docFormat(): string {
    return this.docFormat_;
  }

  /** A `load` (or a reload) sets it from the document's `info.version`. */
  reset(docFormat: string): void {
    this.docFormat_ = docFormat;
  }

  /** True while the board is below 5.0 (a malformed version counts as below). */
  belowLatest(): boolean {
    const v = parseVersion(this.docFormat_);
    return v === null || v.lessThan(FormatVersion.of(FormatVersion.LATEST));
  }

  /** An incoming frame's stamp key, if any (spec 04 §9.4 "TS receivers"). */
  observe(stampValue: JsonValue | undefined): StampObservation {
    if (typeof stampValue !== 'string') return { stamp: null, raised: false, aboveLatest: false };
    const v = parseVersion(stampValue);
    if (v === null) return { stamp: null, raised: false, aboveLatest: false };
    const cur = parseVersion(this.docFormat_);
    let raised = false;
    if (cur === null || v.greaterThan(cur)) {
      this.docFormat_ = stampValue;
      raised = true;
    }
    return { stamp: stampValue, raised, aboveLatest: v.greaterThan(FormatVersion.of(FormatVersion.LATEST)) };
  }

  /**
   * An outgoing frame's `changes`, with the stamp added when the frame introduces a JS-form
   * generator on a board below 5.0 (the input is not modified).
   */
  stamp(type: string, changes: Readonly<Record<string, JsonValue>>): Readonly<Record<string, JsonValue>> {
    if (!this.belowLatest() || FORMAT_STAMP_KEY in changes) return changes;
    if (!this.writesJsTemplate(type, changes)) return changes;
    this.docFormat_ = FormatVersion.LATEST;
    return { ...changes, [FORMAT_STAMP_KEY]: FormatVersion.LATEST };
  }

  /** True when `changes` writes a template holding a JS-form generator (spec 04 §9.3 list). */
  writesJsTemplate(type: string, changes: Readonly<Record<string, JsonValue>>): boolean {
    if (type !== updatetypes.addObjects && type !== updatetypes.convertObjects && type !== updatetypes.changeAttr) {
      return false;
    }
    for (const key of Object.keys(changes)) {
      const keys = splitKey(key);
      const v = changes[key];
      if (v === undefined || v === null) continue;
      if (type === updatetypes.changeAttr) {
        const isTemplateKey = keys.length >= 6 && keys[keys.length - 1] === 'template';
        const isDocTemplate = keys.length === 3 && keys[1] === 'templates';
        if (!isTemplateKey && !isDocTemplate) continue;
      }
      if (this.containsJs(v)) return true;
    }
    return false;
  }

  /** Any template node in `v` (objects, group members, `multi` children, arrowheads) is JS-form. */
  containsJs(v: JsonValue): boolean {
    if (Array.isArray(v)) return (v as readonly JsonValue[]).some((x) => this.containsJs(x));
    if (!isJsonObject(v)) return false;
    const gen = v['generator'];
    const id = v['id'];
    if (isJsonObject(gen) && typeof id === 'string' && this.isJsForm_(gen, id)) return true;
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (x !== undefined && this.containsJs(x)) return true;
    }
    return false;
  }

  /**
   * The conversion frame's chunks (spec 04 §9.4). `templates` are the `doc.templates.*` entries,
   * `objects` the object-template entries in page order, then object order. `frameBytes` is the
   * UTF-8 size of the whole frame for a given `changes` (the session's envelope). Each chunk is a
   * `changes` map holding the stamp.
   */
  conversionChunks(
    templates: readonly ConversionEntry[],
    objects: readonly ConversionEntry[],
    frameBytes: (changes: Readonly<Record<string, JsonValue>>) => number,
  ): Record<string, JsonValue>[] {
    const stampOnly = { [FORMAT_STAMP_KEY]: FormatVersion.LATEST };
    const base = frameBytes(stampOnly);
    const entrySize = (e: ConversionEntry): number =>
      utf8Length(JSON.stringify(e.key)) + 1 + utf8Length(writeJsonText(e.template)) + 1;
    const chunks: Record<string, JsonValue>[] = [];
    let cur: Record<string, JsonValue> = { ...stampOnly };
    let count = 0;
    let bytes = base;
    for (const e of [...templates, ...objects]) {
      const size = entrySize(e);
      if (count > 0 && (count + 1 > CONVERSION_MAX_TEMPLATES || bytes + size > CONVERSION_MAX_BYTES)) {
        chunks.push(cur);
        cur = { ...stampOnly };
        count = 0;
        bytes = base;
      }
      cur[e.key] = e.template;
      count++;
      bytes += size;
    }
    if (count > 0) chunks.push(cur);
    if (chunks.length > 0) this.docFormat_ = FormatVersion.LATEST;
    return chunks;
  }
}

/** The `doc.templates.*` key of a document template (C++ `replace(id, '.', '_')`). */
export function docTemplateKey(id: string): string {
  return `doc.templates.${id.split('.').join('_')}`;
}

/** The object-template key of the conversion frame. */
export function objectTemplateKey(pageId: string, objectId: string): string {
  return `doc.pages.${pageId}.objects.${objectId}.template`;
}
