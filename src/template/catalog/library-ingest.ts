// Reading one stencil library file into catalog maps (port of C++
// `LibraryObjectStore::initObjects`, `L/LibraryObjectStore.cpp:779-866`, and the `TemplateStore`
// writes it makes). Shared by `TemplateCatalog.build` (the immutable base) and
// `CatalogOverlay.addLibraryFile` (a session's additions); what differs is the sink.
//
// Order, as C++: `templates[]`, then `arrows[]`, then each `library[]` category. A category entry is
// either a template id (resolved now, through the sink, objects first) or an object; a
// templated object is keyed by its template's id, a group or multi object is kept in the
// category without a key, and any other object is dropped (C++ kept only `TemplatedObject`s).
import type { GeneratorResolveFn } from '../generator/classify';
import { deepFreeze, isJsonObject, stringField, type JsonObject, type LibraryFileJson } from '../json';
import { buildTemplateDef, isReferenceOnly, type CatalogIssue, type TemplateDef } from './template-def';

/** One entry of a library category. */
export interface CatalogItem {
  /** The template id the item instantiates (`null` for a group or multi object). */
  readonly templateId: string | null;
  /** The library object, or `null` when the entry named a template. */
  readonly object: JsonObject | null;
}

/** One library (category) entry: id, name, group, category, items (spec 02 `ObjectCategory`). */
export interface CatalogCategory {
  readonly id: string;
  readonly name: string;
  readonly group: string;
  readonly category: string;
  readonly items: readonly CatalogItem[];
}

/** Where ingested definitions go. */
export interface CatalogSink {
  addTemplate(def: TemplateDef): void;
  addArrow(def: TemplateDef): void;
  addObject(def: TemplateDef): void;
  /** The category with this id, from this sink or what it sits on; `undefined` for a new one. */
  findCategory(id: string): CatalogCategory | undefined;
  putCategory(c: CatalogCategory): void;
  /** C++ `TemplateStore::getTemplate` (templates, then objects). */
  lookupTemplate(id: string): TemplateDef | undefined;
  /** C++ `TemplateStore::getObjectFromTemplate` (objects, then templates). */
  lookupObjectOrTemplate(id: string): TemplateDef | undefined;
}

/** Ingests `file` into `sink`; returns the categories it created or extended, in file order. */
export function ingestLibraryFile(
  file: LibraryFileJson,
  sink: CatalogSink,
  resolve: GeneratorResolveFn,
  issues: CatalogIssue[],
): CatalogCategory[] {
  for (const t of file.templates ?? []) {
    const def = buildTemplateDef(t, resolve, issues);
    if (def !== null) sink.addTemplate(def);
  }
  for (const a of file.arrows ?? []) {
    const def = buildTemplateDef(a, resolve, issues);
    if (def !== null) sink.addArrow(def);
  }
  const touched: CatalogCategory[] = [];
  for (const categ of file.library ?? []) {
    const cid = categ.id ?? '';
    const prev = sink.findCategory(cid);
    const items: CatalogItem[] = prev !== undefined ? prev.items.slice() : [];
    for (const entry of categ.objects ?? []) {
      if (typeof entry === 'string') {
        const def = sink.lookupObjectOrTemplate(entry);
        if (def !== undefined) items.push({ templateId: def.id, object: def.object });
        continue;
      }
      if (!isJsonObject(entry)) continue;
      const item = ingestObject(entry, sink, resolve, issues);
      if (item !== null) items.push(item);
    }
    const c: CatalogCategory = deepFreeze({
      id: cid,
      name: categ.name ?? prev?.name ?? '',
      group: categ.group ?? prev?.group ?? '',
      category: categ.category ?? prev?.category ?? '',
      items,
    });
    sink.putCategory(c);
    touched.push(c);
  }
  return touched;
}

function ingestObject(
  obj: JsonObject,
  sink: CatalogSink,
  resolve: GeneratorResolveFn,
  issues: CatalogIssue[],
): CatalogItem | null {
  const type = stringField(obj, 'type') ?? 'templated';
  if (type === 'group' || type === 'multi') return { templateId: null, object: deepFreeze(obj) };
  if (type !== 'templated') return null;
  const tmpl = obj['template'];
  if (!isJsonObject(tmpl)) return null;
  const tid = stringField(tmpl, 'id') ?? '';
  if (isReferenceOnly(tmpl)) {
    const ref = sink.lookupTemplate(tid);
    if (ref === undefined) {
      issues.push({ id: tid, reason: 'unknown_reference' });
      return null;
    }
    const def = deepFreeze({ ...ref, object: deepFreeze(obj) });
    sink.addObject(def);
    return { templateId: def.id, object: def.object };
  }
  // The object keeps the converted body, so instantiating it never sees Lua.
  const kept = { object: obj };
  const def = buildTemplateDef(
    tmpl,
    (json) => {
      const r = resolve(json);
      if (r.json !== json) kept.object = { ...obj, template: r.json };
      return r;
    },
    issues,
  );
  if (def === null) return null;
  const withObject = deepFreeze({ ...def, object: deepFreeze(kept.object) });
  sink.addObject(withObject);
  return { templateId: withObject.id, object: withObject.object };
}
