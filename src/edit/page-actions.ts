// The page and document commands (port of C++ `BackgroundChangeAction`, `PageSizeChangeAction`,
// `SetPageNameAction`, `SetPageMarginAction`, `AddDelPageBaseAction`, `AddPageAction`,
// `DeletePageAction`, `ReorderPageAction`, `ChangeGridAction`, `ChangeScalingAction`,
// `L/UserAction.cpp:1000-1037, 1490-1769, 2060-2177`). `Platform::setBackgoundNeedUpdate` and
// `drawCanvas(Grid)` become the session's repaint after the event (the session repaints the grid
// layer on any page or document attribute change).
import {
  Page,
  type CanvasSizeType,
  type LekhDocument,
  type PageBackground,
  type PageMargin,
  type PageSize,
} from '../model';
import { Length, type Scaling } from '../style';
import { EditKeys as K, EditUpdateType, OutgoingUpdate } from './update';
import { UserAction, type EditEnv } from './user-action';

function sizeJson(sz: PageSize): { width: number; height: number; unit: string } {
  return { width: sz.width, height: sz.height, unit: Length.unitStr(sz.unit) };
}

/** C++ `BackgroundChangeAction`. Only a colour (no image data) is raised, as C++. */
export class BackgroundChangeAction extends UserAction {
  private readonly oldbg: PageBackground;
  private readonly newbg: PageBackground;

  constructor(env: EditEnv, doc: LekhDocument, oldbg: PageBackground, newbg: PageBackground) {
    super(env, doc);
    this.oldbg = oldbg.clone();
    this.newbg = newbg.clone();
  }

  private set(bg: PageBackground): boolean {
    const page = this.page();
    if (page === null) return false;
    page.background = bg.clone();
    this.raise();
    return true;
  }

  perform(): boolean {
    return this.set(this.newbg);
  }

  undo(): boolean {
    return this.set(this.oldbg);
  }

  override raise(): void {
    const page = this.page();
    if (page === null || page.background.imageData !== '') return;
    const update = new OutgoingUpdate(EditUpdateType.changeBackground);
    update.set(`${this.pagesPrefix}${this.pageId_}.${K.background}`, this.writer().background(page));
    this.send(update);
  }
}

/** C++ `PageSizeChangeAction`: canvas size type, size and canvas name. */
export class PageSizeChangeAction extends UserAction {
  private readonly oldSize_: PageSize;
  private newSize_: PageSize;
  private readonly oldSizeType_: CanvasSizeType;
  private newSizeType_: CanvasSizeType;
  private readonly oldName_: string;
  private newName_: string;

  constructor(
    env: EditEnv,
    doc: LekhDocument,
    page: Page,
    old: { type: CanvasSizeType; size: PageSize; name: string },
    cur: { type: CanvasSizeType; size: PageSize; name: string },
  ) {
    super(env, doc);
    this.pageId_ = page.id;
    this.oldSize_ = old.size;
    this.newSize_ = cur.size;
    this.oldSizeType_ = old.type;
    this.newSizeType_ = cur.type;
    this.oldName_ = old.name;
    this.newName_ = cur.name;
  }

  setNewName(name: string): void {
    this.newName_ = name;
  }

  setNewType(t: CanvasSizeType): void {
    this.newSizeType_ = t;
  }

  setNewSize(sz: PageSize): void {
    this.newSize_ = sz;
  }

  private set(type: CanvasSizeType, size: PageSize, name: string): boolean {
    const page = this.page();
    if (page === null) return false;
    page.canvasSizeType = type;
    page.size = size;
    page.canvasName = name;
    const update = new OutgoingUpdate(EditUpdateType.changePageAttr);
    const path = this.pagesPrefix + this.pageId_;
    update.set(`${path}.size`, sizeJson(size));
    update.set(`${path}.canvassizetype`, Page.sizeTypeToStr(type));
    update.set(`${path}.canvasname`, name);
    this.send(update);
    return true;
  }

  perform(): boolean {
    return this.set(this.newSizeType_, this.newSize_, this.newName_);
  }

  undo(): boolean {
    return this.set(this.oldSizeType_, this.oldSize_, this.oldName_);
  }
}

/** C++ `SetPageNameAction`. */
export class SetPageNameAction extends UserAction {
  private readonly oldName_: string;
  private readonly newName_: string;

  constructor(env: EditEnv, doc: LekhDocument, page: Page, oldName: string, newName: string) {
    super(env, doc);
    this.pageId_ = page.id;
    this.oldName_ = oldName;
    this.newName_ = newName;
  }

  private set(name: string): boolean {
    const page = this.page();
    if (page === null) return false;
    page.name = name;
    const update = new OutgoingUpdate(EditUpdateType.changePageAttr);
    update.set(`${this.pagesPrefix}${this.pageId_}.name`, name);
    this.send(update);
    return true;
  }

  perform(): boolean {
    return this.set(this.newName_);
  }

  undo(): boolean {
    return this.set(this.oldName_);
  }
}

/** C++ `SetPageMarginAction`: a hidden margin is raised as `null`. */
export class SetPageMarginAction extends UserAction {
  private readonly oldMargin_: PageMargin;
  private newMargin_: PageMargin;

  constructor(env: EditEnv, doc: LekhDocument, page: Page, oldMargin: PageMargin, newMargin: PageMargin) {
    super(env, doc);
    this.pageId_ = page.id;
    this.oldMargin_ = oldMargin;
    this.newMargin_ = newMargin;
  }

  setNewMargin(m: PageMargin): void {
    this.newMargin_ = m;
  }

  private set(m: PageMargin): boolean {
    const page = this.page();
    if (page === null) return false;
    page.margin = m;
    const update = new OutgoingUpdate(EditUpdateType.changePageAttr);
    update.set(`${this.pagesPrefix}${this.pageId_}.margin`, m.show ? sizeJson(m.size) : null);
    this.send(update);
    return true;
  }

  perform(): boolean {
    return this.set(this.newMargin_);
  }

  undo(): boolean {
    return this.set(this.oldMargin_);
  }
}

/** C++ `AddDelPageBaseAction`. */
export abstract class AddDelPageBaseAction extends UserAction {
  protected page_: Page | null = null;
  protected index_ = -1;

  /** C++ `add`: at `index_` (renumbering pages as needed), raised as `addpages`. */
  protected add(): boolean {
    const page = this.page_;
    if (page === null) return false;
    const orderChanges = new Map<string, number>();
    if (this.index_ >= 0) {
      if (this.index_ > this.document_.pages.length) this.index_ = this.document_.pages.length;
      page.order = this.document_.getPageOrderForIndex(this.index_, orderChanges);
      this.index_ = -1;
    }
    const update = new OutgoingUpdate(EditUpdateType.addPages);
    update.set(this.pagesPrefix + this.pageId_, this.writer().page(page));
    for (const [id, order] of orderChanges) update.set(`${this.pagesPrefix}${id}.order`, order);
    this.document_.addPageWithOrder(page);
    this.page_ = null;
    this.send(update);
    return true;
  }

  /** C++ `remove`: the page leaves, and is held for the undo. */
  protected remove(): boolean {
    this.page_ = this.document_.getPage(this.pageId_);
    this.index_ = this.document_.deletePage(this.pageId_);
    if (this.index_ < 0) return false;
    const update = new OutgoingUpdate(EditUpdateType.delPages);
    update.set(this.pagesPrefix + this.pageId_, null);
    this.send(update);
    return true;
  }
}

/** C++ `AddPageAction`. */
export class AddPageAction extends AddDelPageBaseAction {
  constructor(env: EditEnv, doc: LekhDocument, page: Page, index: number) {
    super(env, doc);
    this.page_ = page;
    this.pageId_ = page.id;
    this.index_ = index;
  }

  perform(): boolean {
    return this.add();
  }

  undo(): boolean {
    return this.remove();
  }
}

/** C++ `DeletePageAction`. */
export class DeletePageAction extends AddDelPageBaseAction {
  constructor(env: EditEnv, doc: LekhDocument, page: Page) {
    super(env, doc);
    this.pageId_ = page.id;
  }

  perform(): boolean {
    return this.remove();
  }

  undo(): boolean {
    return this.add();
  }
}

/** C++ `ReorderPageAction`: swaps two pages (and their orders). */
export class ReorderPageAction extends UserAction {
  private readonly from_: number;
  private readonly to_: number;

  constructor(env: EditEnv, doc: LekhDocument, from: number, to: number) {
    super(env, doc);
    this.from_ = from;
    this.to_ = to;
  }

  private swap(a: number, b: number, active: number): boolean {
    const ok = this.document_.reorderPage(a, b);
    if (ok) {
      this.document_.setActivePageIndex(active);
      this.raise();
    }
    return ok;
  }

  perform(): boolean {
    return this.swap(this.from_, this.to_, this.to_);
  }

  undo(): boolean {
    return this.swap(this.to_, this.from_, this.from_);
  }

  override raise(): void {
    const p1 = this.document_.pages[this.from_];
    const p2 = this.document_.pages[this.to_];
    if (p1 === undefined || p2 === undefined) return;
    const update = new OutgoingUpdate(EditUpdateType.changePageAttr);
    update.set(`${this.pagesPrefix}${p1.id}.order`, p1.order);
    update.set(`${this.pagesPrefix}${p2.id}.order`, p2.order);
    this.send(update);
  }
}

/** C++ `ChangeGridAction`. */
export class ChangeGridAction extends UserAction {
  private readonly val_: boolean;

  constructor(env: EditEnv, doc: LekhDocument, val: boolean) {
    super(env, doc);
    this.val_ = val;
  }

  perform(): boolean {
    this.document_.grid.present = this.val_;
    this.raise();
    return true;
  }

  undo(): boolean {
    this.document_.grid.present = !this.val_;
    this.raise();
    return true;
  }

  override raise(): void {
    const update = new OutgoingUpdate(EditUpdateType.changeGrid);
    update.set(`${K.doc}.${K.attributes}.${K.grid}.${K.present}`, this.document_.grid.present);
    this.send(update);
  }
}

/**
 * C++ `ChangeScalingAction`. As C++, the update always carries the *new* scaling, also on undo
 * (peers keep the new scaling after an undo; ported as is).
 */
export class ChangeScalingAction extends UserAction {
  private readonly old_: Scaling;
  private new_: Scaling;

  constructor(env: EditEnv, doc: LekhDocument, oldScaling: Scaling, newScaling: Scaling) {
    super(env, doc);
    this.old_ = oldScaling;
    this.new_ = newScaling;
  }

  perform(): boolean {
    this.document_.scaling = this.new_;
    this.raise();
    return true;
  }

  undo(): boolean {
    this.document_.scaling = this.old_;
    this.raise();
    return true;
  }

  /** C++ `updateAction`: a continued change from the same old scaling replaces the new one. */
  updateAction(oldScaling: Scaling, newScaling: Scaling): boolean {
    if (this.old_.value === oldScaling.value && this.old_.unit === oldScaling.unit) {
      this.new_ = newScaling;
      return true;
    }
    return false;
  }

  override raise(): void {
    const update = new OutgoingUpdate(EditUpdateType.changeScaling);
    update.set(`${K.doc}.${K.attributes}.${K.scaling}`, {
      [K.unit]: Length.unitStr(this.new_.unit),
      [K.scale]: this.new_.value,
    });
    this.send(update);
  }
}
