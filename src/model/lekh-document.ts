// The document root (port of C++ `document::LekhDocument`, `LekhDocument.{h,cpp}`): pages in
// order, the document-level template map, the root style, `info`, grid and scaling, and the
// active page. A document always has at least one page (`addDefaultPageIfRequired`).
//
// Differences from C++, each deliberate:
// - no singletons: ids, the clock and the config arrive in `DocumentContext` (spec 03 §1);
// - templates are held as catalog definitions (`TemplateDef`), the form `CatalogOverlay.getEmbed`
//   reads them in (`DocTemplates`); a live template is instantiated from its definition by the
//   caller, which is what C++ `getTemplate`'s clone was for;
// - `arrangePages` is a stable sort (C++ `std::sort`: pages with equal orders in any order);
// - `serialize` / `load` / `getEmptyDoc` are not here: they are `io/` (and in C++ were declared
//   and never defined).
import type { Clock, Config, IdSource } from '../base';
import { shortIdFromUuid } from '../base';
import { Length, Scaling, Style, Unit } from '../style';
import type { DocTemplates, TemplateDef } from '../template';
import type { LayoutServices } from './lekh-object';
import { DocumentInfo } from './document-info';
import { OrderAllocator } from './order-allocator';
import { settleLayout } from './settle';
import { Page } from './page';
import type { ObjectStoreOptions } from './object-store';

/** What a document and its pages need from the session. */
export interface DocumentContext {
  readonly config: Config;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly services?: LayoutServices;
}

/** C++ `LekhDocument::Grid`. */
export interface GridSettings {
  present: boolean;
  type: number;
}

export class LekhDocument implements DocTemplates {
  readonly info: DocumentInfo;
  readonly style = new Style();
  readonly grid: GridSettings = { present: true, type: 0 };
  name = '';
  scaling: Scaling = Scaling.default();
  private pages_: Page[] = [];
  private activePage_ = 0;
  private readonly templates_ = new Map<string, TemplateDef>();
  private readonly ctx_: DocumentContext;
  private readonly orders_: OrderAllocator;

  constructor(ctx: DocumentContext, info: DocumentInfo = new DocumentInfo()) {
    this.ctx_ = ctx;
    this.info = info;
    this.orders_ = new OrderAllocator(ctx.clock);
    this.addDefaultPageIfRequired();
  }

  /** The store options every page of this document is built with. */
  get storeOptions(): ObjectStoreOptions {
    const { config, clock, services } = this.ctx_;
    return services === undefined ? { config, clock } : { config, clock, services };
  }

  /** A new short id (`shortIdFromUuid(ids.next())`, KB document-model "Minting"). */
  newId(): string {
    return shortIdFromUuid(this.ctx_.ids.next());
  }

  /** A new, detached page with a minted id (C++ `new Page()`). */
  newPage(name = ''): Page {
    return new Page(this.newId(), name, this.storeOptions);
  }

  // ---- pages ----

  get pages(): readonly Page[] {
    return this.pages_;
  }

  get activePageIndex(): number {
    return this.activePage_;
  }

  /** C++ `setPages`: sorted by order, a default page if empty, the first one active. */
  setPages(pages: readonly Page[]): void {
    this.pages_ = [...pages];
    this.arrangePages();
    this.addDefaultPageIfRequired();
    this.activePage_ = 0;
  }

  arrangePages(): void {
    this.pages_.sort((a, b) => a.order - b.order);
  }

  /** C++ `deletePage`: the index the page had, or -1. */
  deletePage(pageId: string): number {
    const i = this.pages_.findIndex((p) => p.id === pageId);
    if (i >= 0) this.pages_.splice(i, 1);
    return i;
  }

  setActivePageIndex(index: number): boolean {
    if (index < 0 || index >= this.pages_.length) return false;
    this.activePage_ = index;
    return true;
  }

  /** C++ `reorderPage`: swaps the two pages and their orders. */
  reorderPage(from: number, to: number): boolean {
    const n = this.pages_.length;
    if (from < 0 || from >= n || to < 0 || to >= n) return false;
    if (from === to) return true;
    const page1 = this.pages_[from] as Page;
    const page2 = this.pages_[to] as Page;
    const order1 = page1.order;
    this.pages_[from] = page2;
    this.pages_[to] = page1;
    page1.order = page2.order;
    page2.order = order1;
    return true;
  }

  /** C++ `activePage`: a default page when there is none; an out-of-range index resets to 0. */
  activePage(): Page {
    if (this.pages_.length === 0) this.addDefaultPageIfRequired();
    if (this.activePage_ > this.pages_.length - 1 || this.activePage_ < 0) this.activePage_ = 0;
    return this.pages_[this.activePage_] as Page;
  }

  getPage(pageId: string): Page | null {
    return this.pages_.find((p) => p.id === pageId) ?? null;
  }

  getPageIndex(page: Page): number {
    return this.pages_.findIndex((p) => p.id === page.id);
  }

  /** C++ `addPageWithOrder`: before the first page with a greater order. */
  addPageWithOrder(page: Page): void {
    const i = this.pages_.findIndex((p) => page.order < p.order);
    if (i < 0) this.pages_.push(page);
    else this.pages_.splice(i, 0, page);
  }

  /** C++ `getPageOrderForIndex` (renumbered pages are written to `changes`). */
  getPageOrderForIndex(idx: number, changes: Map<string, number>): number {
    return this.orders_.pageOrderForIndex(this.pages_, idx, changes);
  }

  private addDefaultPageIfRequired(): void {
    if (this.pages_.length > 0) return;
    const pg = this.newPage('Page 1');
    pg.order = 0;
    this.addPageWithOrder(pg);
    this.activePage_ = 0;
  }

  // ---- templates ----

  /** C++ `addTemplate`: replaces a definition with the same id. */
  addTemplate(def: TemplateDef): void {
    this.templates_.set(def.id, def);
  }

  /** DocTemplates: the definition with `id`. */
  get(id: string): TemplateDef | undefined {
    return this.templates_.get(id);
  }

  hasTemplate(id: string): boolean {
    return this.templates_.has(id);
  }

  /** Template ids in insertion order. */
  templateIds(): string[] {
    return [...this.templates_.keys()];
  }

  // ---- grid and snapping ----

  /** C++ `snapStep`: 1/8 in, 0.25 cm, else 8 points. */
  snapStep(): Length {
    if (this.scaling.unit === Unit.Inch) return new Length(0.125, Unit.Inch);
    if (this.scaling.unit === Unit.Centimeter) return new Length(0.25, Unit.Centimeter);
    return new Length(8, Unit.Point);
  }

  resizeSnapStep(): Length {
    const s = this.snapStep();
    return new Length(s.val * 0.5, s.unit);
  }

  /** C++ `gridWidth`: twice the snap step, doubled again on the web for a point-unit document. */
  gridWidth(isWeb: boolean): Length {
    const s = this.snapStep();
    let val = s.val * 2;
    if (isWeb && this.scaling.unit === Unit.Point) val *= 2;
    return new Length(val, s.unit);
  }

  // ---- layout ----

  /** Settles the layout of every page, or of one, keeping the serialized state (`settleLayout`). */
  layoutAll(pageId?: string): void {
    for (const p of this.pages_) {
      if (pageId === undefined || p.id === pageId) settleLayout(p.objectStore);
    }
  }
}
