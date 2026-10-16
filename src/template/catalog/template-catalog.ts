// The immutable base set of template definitions, arrowheads, library objects and categories
// (spec 04 §3; replaces the C++ global `TemplateStore`, `L/TemplateStore.{h,cpp}`, and the
// catalogue half of `LibraryObjectStore`). One per JS realm: the front end builds one per page
// from the bundled core set; kashi builds one per pool worker at warm-up. Nothing writes to it:
// every definition is deep-frozen at build (AC-GEN-03), and per-session additions go to a
// `CatalogOverlay`.
import { classifyOnly, type GeneratorResolveFn } from '../generator/classify';
import type { LibraryFileJson } from '../json';
import { ingestLibraryFile, type CatalogCategory, type CatalogSink } from './library-ingest';
import type { CatalogIssue, TemplateDef } from './template-def';

/** The maps a catalog (or an overlay) holds. */
export interface CatalogMaps {
  readonly templates: ReadonlyMap<string, TemplateDef>;
  readonly arrows: ReadonlyMap<string, TemplateDef>;
  readonly objects: ReadonlyMap<string, TemplateDef>;
  readonly help: ReadonlyMap<string, string>;
  /** Categories in first-seen order. */
  readonly categories: ReadonlyMap<string, CatalogCategory>;
}

/** Mutable maps plus the sink that fills them; `under` is what lookups fall back to. */
export class CatalogMapsBuilder implements CatalogSink {
  readonly templates = new Map<string, TemplateDef>();
  readonly arrows = new Map<string, TemplateDef>();
  readonly objects = new Map<string, TemplateDef>();
  readonly help = new Map<string, string>();
  readonly categories = new Map<string, CatalogCategory>();
  private readonly under: CatalogMaps | null;

  constructor(under: CatalogMaps | null = null) {
    this.under = under;
  }

  /** C++ `addTemplate`: the template, and its help text when it has one. */
  addTemplate(def: TemplateDef): void {
    this.templates.set(def.id, def);
    if (def.help !== '') this.help.set(def.id, def.help);
  }
  addArrow(def: TemplateDef): void {
    this.arrows.set(def.id, def);
  }
  addObject(def: TemplateDef): void {
    this.objects.set(def.id, def);
    if (def.help !== '') this.help.set(def.id, def.help);
  }
  findCategory(id: string): CatalogCategory | undefined {
    return this.categories.get(id) ?? this.under?.categories.get(id);
  }
  putCategory(c: CatalogCategory): void {
    this.categories.set(c.id, c);
  }
  lookupTemplate(id: string): TemplateDef | undefined {
    return (
      this.templates.get(id) ?? this.under?.templates.get(id) ?? this.objects.get(id) ?? this.under?.objects.get(id)
    );
  }
  lookupObjectOrTemplate(id: string): TemplateDef | undefined {
    return (
      this.objects.get(id) ?? this.under?.objects.get(id) ?? this.templates.get(id) ?? this.under?.templates.get(id)
    );
  }
}

export class TemplateCatalog {
  private readonly maps_: CatalogMaps;
  private readonly issues_: readonly CatalogIssue[];

  private constructor(maps: CatalogMaps, issues: readonly CatalogIssue[]) {
    this.maps_ = maps;
    this.issues_ = Object.freeze(issues.slice());
    Object.freeze(this);
  }

  /** A catalog with nothing in it. */
  static empty(): TemplateCatalog {
    return TemplateCatalog.build([]);
  }

  /** The base catalog from `files`, read in order (later files win on an id clash, as C++). */
  static build(files: readonly LibraryFileJson[], resolve: GeneratorResolveFn = classifyOnly): TemplateCatalog {
    const b = new CatalogMapsBuilder();
    const issues: CatalogIssue[] = [];
    for (const f of files) ingestLibraryFile(f, b, resolve, issues);
    return new TemplateCatalog(b, issues);
  }

  /** `base` plus `file`: a new immutable catalog; `base` is unchanged (kashi warm-up, spec 10 §3). */
  static withLibrary(
    base: TemplateCatalog,
    file: LibraryFileJson,
    resolve: GeneratorResolveFn = classifyOnly,
  ): TemplateCatalog {
    const b = new CatalogMapsBuilder();
    const m = base.maps_;
    for (const [k, v] of m.templates) b.templates.set(k, v);
    for (const [k, v] of m.arrows) b.arrows.set(k, v);
    for (const [k, v] of m.objects) b.objects.set(k, v);
    for (const [k, v] of m.help) b.help.set(k, v);
    for (const [k, v] of m.categories) b.categories.set(k, v);
    const issues = base.issues_.slice();
    ingestLibraryFile(file, b, resolve, issues);
    return new TemplateCatalog(b, issues);
  }

  /** The maps, read-only (for `CatalogOverlay`). */
  maps(): CatalogMaps {
    return this.maps_;
  }

  /** C++ `TemplateStore::getTemplate` order: a template, else a library object's template. */
  get(id: string): TemplateDef | undefined {
    return this.maps_.templates.get(id) ?? this.maps_.objects.get(id);
  }
  template(id: string): TemplateDef | undefined {
    return this.maps_.templates.get(id);
  }
  object(id: string): TemplateDef | undefined {
    return this.maps_.objects.get(id);
  }
  /** C++ `TemplateStore::getObjectFromTemplate` order: a library object, else a template. */
  getEmbed(id: string): TemplateDef | undefined {
    return this.maps_.objects.get(id) ?? this.maps_.templates.get(id);
  }
  /** C++ `contains`: a template or a library object. */
  has(id: string): boolean {
    return this.maps_.templates.has(id) || this.maps_.objects.has(id);
  }
  /** A connector arrowhead (C++ `getArrow`). */
  arrowhead(id: string): TemplateDef | undefined {
    return this.maps_.arrows.get(id);
  }
  /** Every arrowhead, ordered by id (C++ `std::map` order). */
  arrowheads(): readonly TemplateDef[] {
    return [...this.maps_.arrows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  help(id: string): string | undefined {
    return this.maps_.help.get(id);
  }
  categories(): readonly CatalogCategory[] {
    return [...this.maps_.categories.values()];
  }
  category(id: string): CatalogCategory | undefined {
    return this.maps_.categories.get(id);
  }
  templateIds(): readonly string[] {
    return [...this.maps_.templates.keys()];
  }
  /** What did not build, or built with a defect (content-free). */
  issues(): readonly CatalogIssue[] {
    return this.issues_;
  }
}
