// The shape library's categories, their loaded entries and the search filter (port of C++
// `LibraryObjectStore`, `L/LibraryObjectStore.{h,cpp}`; spec 02 `ShapeLibraryStore`, io).
//
// Data only: a category holds its entries as catalog items (a template id and/or the library
// object JSON) with the name and aliases the search keys come from; the host instantiates an
// entry through the session's codec when it draws or inserts it. Where the content comes from
// (bundled, the stencil host, a user library) is the host's `ShapeLibraryService`.
//
// Visible categories (C++ `categories_`) are recomputed by `onDisplaySettingChange` from the
// display settings (by `category`), the custom libraries' visibility and the search filter.
import type { CatalogCategory, JsonObject } from '../../template';

/** One shape of a category (C++ an `ObjectCategory` object, kept as data). */
export interface LibraryEntry {
  /** The template the entry instantiates; `null` for a group or multi object. */
  readonly templateId: string | null;
  /** The library object JSON, or `null` when the entry named a template. */
  readonly object: JsonObject | null;
  /** C++ `nameInLibraryView`, else the template's `name` ('' when neither). */
  readonly name: string;
  /** The template's `aliases` ('' for none). */
  readonly aliases: string;
}

/** A display setting (C++ `displaySettings_` pair): a `category` name and whether it is shown. */
export interface DisplaySetting {
  readonly name: string;
  selected: boolean;
}

/** What `addCategories` needs to know of a template (from the catalog): name and aliases. */
export type TemplateInfo = (templateId: string) => { readonly name: string; readonly aliases: string } | undefined;

function isAlnum(ch: string): boolean {
  return /^[A-Za-z0-9]$/.test(ch);
}

/** C++ `LekhUtil::trim`: ASCII white space off both ends. */
function trim(s: string): string {
  return s.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '');
}

/**
 * C++ `ObjectCategory::makeKeys`: the lower-cased alphanumeric words of `str`, and with
 * `usePrefix` every prefix of each word of at least two characters (not the word itself twice).
 */
export function makeLibraryKeys(str: string, usePrefix: boolean, keys: Set<string> = new Set()): Set<string> {
  const search = trim(str).toLowerCase();
  const split: string[] = [];
  let tmp = '';
  for (const ch of search) {
    if (!isAlnum(ch)) {
      if (tmp.length > 0) {
        split.push(tmp);
        tmp = '';
      }
    } else {
      tmp += ch;
    }
  }
  if (tmp.length > 0) split.push(tmp);
  for (const w of split) {
    keys.add(w);
    if (usePrefix) for (let j = w.length - 1; j > 1; j--) keys.add(w.slice(0, j));
  }
  return keys;
}

/** C++ `LibraryObjectStore::ObjectCategory`. */
export class LibraryCategory {
  group = '';
  category = '';
  name = '';
  id = '';
  contentUrl = '';
  isCustomLib = false;
  loadingAttempted = false;
  expanded = false;
  private all_: LibraryEntry[] = [];
  private filtered_ = false;
  private unloadedFiltered_ = false;
  private filteredEntries_: LibraryEntry[] = [];
  private readonly keywords_ = new Map<string, Set<LibraryEntry>>();
  private readonly keysWhenNotLoaded_ = new Set<string>();
  private filterString_ = '';

  /** The entries shown (the filtered ones while a search is on). */
  objects(): readonly LibraryEntry[] {
    return this.filtered_ ? this.filteredEntries_ : this.all_;
  }

  /** Every loaded entry, whatever the search. */
  unfilteredObjects(): readonly LibraryEntry[] {
    return this.all_;
  }

  addObject(e: LibraryEntry): void {
    this.all_.push(e);
    const keys = new Set<string>();
    if (this.isCustomLib) makeLibraryKeys(e.name, true, keys);
    else if (e.templateId !== null) {
      makeLibraryKeys(e.name, true, keys);
      makeLibraryKeys(e.aliases, true, keys);
    }
    for (const k of keys) {
      let set = this.keywords_.get(k);
      if (set === undefined) {
        set = new Set();
        this.keywords_.set(k, set);
      }
      set.add(e);
    }
  }

  /** C++ `setInitialKeys`: the search keys of a category not loaded yet (from `libnames.json`). */
  setInitialKeys(str: string): void {
    makeLibraryKeys(str, true, this.keysWhenNotLoaded_);
  }

  isFiltered(): boolean {
    return this.filtered_;
  }

  hasUnloadedFilteredObjects(): boolean {
    return this.unloadedFiltered_;
  }

  resetFilter(): void {
    this.filtered_ = false;
    this.unloadedFiltered_ = false;
    this.filterString_ = '';
  }

  refilter(): void {
    if (this.filtered_) this.filter(this.filterString_);
  }

  /** C++ `filter`: entries matching any word of `str` (prefix keys); none loaded: the initial keys. */
  filter(str: string): void {
    const key = trim(str);
    if (key === '') {
      this.resetFilter();
      return;
    }
    this.filterString_ = key;
    const keys = makeLibraryKeys(key, false);
    const subset = new Set<LibraryEntry>();
    this.unloadedFiltered_ = false;
    if (this.all_.length === 0) {
      for (const k of keys) {
        if (this.keysWhenNotLoaded_.has(k)) {
          this.unloadedFiltered_ = true;
          break;
        }
      }
    } else {
      for (const k of keys) for (const e of this.keywords_.get(k) ?? []) subset.add(e);
    }
    this.filteredEntries_ = this.all_.filter((e) => subset.has(e));
    this.filtered_ = true;
  }

  clearObjects(): void {
    this.all_ = [];
    this.filteredEntries_ = [];
    this.keywords_.clear();
  }
}

/**
 * Core stencils whose template ids do not start with their library's id (C++
 * `categoryOverrides`, spec connection-dragger.md §5.2).
 */
const CATEGORY_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  'avabodh.conatiner.rectangle': 'avabodh.container',
  'avabodh.conatiner.diamond': 'avabodh.container',
  'avabodh.conatiner.pill': 'avabodh.container',
  'avabodh.conatiner.doublebracket': 'avabodh.container',
  'avabodh.conatiner.doublebracketv': 'avabodh.container',
  'avabodh.conatiner.doublebrace': 'avabodh.container',
  'avabodh.conatiner.doublebracev': 'avabodh.container',
  'avabodh.basic.arrow_forward': 'avabodh.arrow',
  'avabodh.basic.arrow_backward': 'avabodh.arrow',
  'avabodh.basic.arrow_both_side': 'avabodh.arrow',
  'avabodh.basic.star': 'avabodh.misc',
  'avabodh.basic.cross': 'avabodh.misc',
});

export const BASIC_CATEGORY_ID = 'avabodh.basic';

export interface ShapeLibraryStoreOptions {
  /** C++ `CustomLibService::isVisibleInLibrary`. */
  readonly isCustomVisible?: (libId: string) => boolean;
}

/** C++ `LibraryObjectStore` (one per page; the host's `ShapeLibraryService` owns it). */
export class ShapeLibraryStore {
  private readonly all_: LibraryCategory[] = [];
  private visible_: LibraryCategory[] = [];
  private readonly display_: DisplaySetting[] = [];
  private readonly initialNames_ = new Map<string, string>();
  private isCustomVisible_: (libId: string) => boolean;
  private revision_ = 0;
  private readonly listeners_ = new Set<() => void>();

  constructor(opts: ShapeLibraryStoreOptions = {}) {
    this.isCustomVisible_ = opts.isCustomVisible ?? (() => false);
  }

  setCustomVisibility(fn: (libId: string) => boolean): void {
    this.isCustomVisible_ = fn;
  }

  /** Bumped by every change the panel shows. */
  get revision(): number {
    return this.revision_;
  }

  subscribe(fn: () => void): () => void {
    this.listeners_.add(fn);
    return () => {
      this.listeners_.delete(fn);
    };
  }

  /** Tells the listeners (the panel) that something changed. */
  changed(): void {
    this.revision_++;
    for (const l of [...this.listeners_]) l();
  }

  // ---- categories ----

  /** The visible categories, in order (C++ `categories_`). */
  categories(): readonly LibraryCategory[] {
    return this.visible_;
  }

  allCategories(): readonly LibraryCategory[] {
    return this.all_;
  }

  categoryById(id: string): LibraryCategory | undefined {
    return this.all_.find((c) => c.id === id);
  }

  /** C++ `categoryIndexById`: among all categories; -1 for none. */
  categoryIndexById(id: string): number {
    return this.all_.findIndex((c) => c.id === id);
  }

  /** C++ `initNames`: category id → comma-separated shape names (`libnames.json`). */
  initNames(names: Readonly<Record<string, string>>): void {
    for (const [k, v] of Object.entries(names)) this.initialNames_.set(k, v);
  }

  /** C++ `initEmptyCateg`: a category whose content is fetched on first expand. */
  initEmptyCateg(name: string, id: string, group: string, category: string, contentUrl: string): void {
    if (this.categoryById(id) !== undefined) return;
    const oc = new LibraryCategory();
    oc.name = name;
    oc.id = id;
    oc.group = group;
    oc.category = category;
    oc.contentUrl = contentUrl;
    const n = this.initialNames_.get(id);
    if (n !== undefined) oc.setInitialKeys(n);
    this.all_.push(oc);
    this.addDisplaySetting(category, true);
  }

  /**
   * C++ `initCustomLibs`: the user's selected libraries first, in `libs` order; a library already
   * known keeps its loaded entries (renamed), a new one starts empty, and dropped ones go.
   */
  initCustomLibs(libs: readonly { readonly name: string; readonly id: string; readonly url: string }[]): void {
    const kept: LibraryCategory[] = [];
    while (this.all_.length > 0 && (this.all_[0] as LibraryCategory).isCustomLib)
      kept.push(this.all_.shift() as LibraryCategory);
    let insertIdx = 0;
    for (const lib of libs) {
      const found = kept.findIndex((c) => c.id === lib.id);
      if (found >= 0) {
        const c = kept.splice(found, 1)[0] as LibraryCategory;
        c.name = lib.name;
        this.all_.splice(insertIdx, 0, c);
      } else {
        this.initCustomLib(lib.name, lib.id, lib.url);
      }
      insertIdx++;
    }
  }

  /** C++ `initCustomLib`: a user library, after the other user libraries. */
  initCustomLib(name: string, id: string, contentUrl: string): void {
    let idx = 0;
    while (idx < this.all_.length && (this.all_[idx] as LibraryCategory).isCustomLib) idx++;
    const oc = new LibraryCategory();
    oc.name = name;
    oc.id = id;
    oc.group = 'My Shapes';
    oc.isCustomLib = true;
    oc.category = name;
    oc.contentUrl = contentUrl;
    const n = this.initialNames_.get(id);
    if (n !== undefined) oc.setInitialKeys(n);
    this.all_.splice(idx, 0, oc);
  }

  /**
   * The library half of C++ `initObjects`: catalog categories (from `CatalogOverlay.addLibraryFile`
   * or the base catalog) filled into this store. A category not known yet is appended. A user
   * library keeps its own name; a stencil category's display setting is set shown, as C++ did.
   * The entries replace nothing: C++ appended (callers load a category once, or clear it first).
   */
  addCategories(cats: readonly CatalogCategory[], info: TemplateInfo): void {
    for (const c of cats) {
      let oc = this.categoryById(c.id);
      if (oc === undefined) {
        oc = new LibraryCategory();
        this.all_.push(oc);
      }
      if (oc.name === '' || !oc.isCustomLib) oc.name = c.name;
      oc.id = c.id;
      oc.category = c.category;
      oc.group = c.group;
      if (!oc.isCustomLib) this.addDisplaySetting(oc.category, true);
      for (const item of c.items) {
        const t = item.templateId === null ? undefined : info(item.templateId);
        const objName = item.object !== null && typeof item.object['name'] === 'string' ? item.object['name'] : '';
        oc.addObject({
          templateId: item.templateId,
          object: item.object,
          name: objName !== '' ? objName : (t?.name ?? ''),
          aliases: t?.aliases ?? '',
        });
      }
      oc.refilter();
    }
  }

  // ---- expansion and loading ----

  /** C++ `setExpanded`: collapsing an empty category lets the next expand try loading again. */
  setExpanded(c: LibraryCategory, value: boolean): void {
    if (!value && c.objects().length === 0) c.loadingAttempted = false;
    c.expanded = value;
  }

  // ---- display settings and search ----

  displaySettings(): DisplaySetting[] {
    return this.display_;
  }

  /** C++ `addDisplaySetting`: sets an existing entry, else appends one. */
  addDisplaySetting(name: string, flag: boolean): void {
    const d = this.display_.find((x) => x.name === name);
    if (d !== undefined) d.selected = flag;
    else this.display_.push({ name, selected: flag });
  }

  resetDispSetting(): void {
    for (const d of this.display_) d.selected = false;
  }

  /** C++ `filterObjects`. */
  filterObjects(search: string): void {
    for (const c of this.all_) c.filter(search);
    this.onDisplaySettingChange();
  }

  /** C++ `onDisplaySettingChange`: recomputes the visible categories. */
  onDisplaySettingChange(): void {
    const out: LibraryCategory[] = [];
    for (const c of this.all_) {
      if (c.isCustomLib) {
        if (!this.isCustomVisible_(c.id)) continue;
        if (!c.isFiltered() || c.objects().length > 0) out.push(c);
        continue;
      }
      const d = this.display_.find((x) => x.name === c.category);
      if (d === undefined || !d.selected) continue;
      if (!c.isFiltered() || c.objects().length > 0 || c.hasUnloadedFilteredObjects()) out.push(c);
    }
    this.visible_ = out;
  }

  /**
   * C++ `categoryIdForTemplate`: the override table, else the longest category id that is a prefix
   * of `templateId` followed by '.', else Basic.
   */
  categoryIdForTemplate(templateId: string): string {
    const o = Object.prototype.hasOwnProperty.call(CATEGORY_OVERRIDES, templateId)
      ? CATEGORY_OVERRIDES[templateId]
      : undefined;
    if (o !== undefined && this.categoryById(o) !== undefined) return o;
    let best: LibraryCategory | null = null;
    for (const c of this.all_) {
      const id = c.id;
      if (id === '' || templateId.length <= id.length + 1) continue;
      if (templateId.startsWith(id) && templateId.charAt(id.length) === '.') {
        if (best === null || id.length > best.id.length) best = c;
      }
    }
    return best?.id ?? BASIC_CATEGORY_ID;
  }
}
