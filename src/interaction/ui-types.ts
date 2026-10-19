// The engine ↔ React contract's types (spec 05 §6.1-§6.3): the observable `BoardUiState`, the
// `Store` React reads with `useSyncExternalStore`, the commands React calls, and the value types
// they carry. The requests the session makes of its UI (`UiRequests`, `DialogRequest`,
// `ToastRequest`, `StyleSnapshot`, …) are `session/ui.ts`'s and are re-exported here so the UI
// imports every contract type from one place.
import type { Point, Rect } from '../geometry';
import type { StyleSnapshot } from '../session';
import type { CursorKind } from './cursor';
import type { HostEnvironment } from './env';
import type { InputMode } from './input-mode';

export type {
  ContextAction,
  DialogRequest,
  DialogResponse,
  OpenViewKind,
  PickedImage,
  ShapePickerRequest,
  StyleSnapshot,
  ToastRequest,
  UiRequests,
} from '../session';

/** A read-only observable value; `subscribe` returns the unsubscribe. */
export interface Store<T> {
  get(): T;
  subscribe(fn: () => void): () => void;
}

/** The catalog id of a selection-menu item, e.g. `delete`, `duplicate`, `group` (spec 05 §8). */
export type SelectionActionId = string;

/** One selection-menu item as the React menu shows it. */
export interface SelectionAction {
  readonly id: SelectionActionId;
  readonly iconId: string;
  readonly label: string;
  readonly collapsed: boolean;
  readonly enabled: boolean;
}

/** The open text editor overlay (spec 06 §6). */
export interface TextEditView {
  readonly objectId: string;
  readonly rect: Rect;
  readonly rotation: number;
  readonly font: string;
  readonly color: string;
  readonly align: 'left' | 'center' | 'right';
  readonly lineHeight: number;
  readonly text: string;
  readonly placeholder?: string;
  /** C++ `TextEditParam` (spec 06 §6.1): a textarea, bordered on the web, growing with the text. */
  readonly multiLine?: boolean;
  readonly showBorder?: boolean;
  readonly variableWidth?: boolean;
  readonly variableHeight?: boolean;
  /** An interpreted-text template edits left-aligned (`defaultAlignAlways`). */
  readonly defaultAlignAlways?: boolean;
}

/** The `Config` values the panels show (read-only). */
export interface ConfigSnapshot {
  readonly gridOn: boolean;
  readonly snapToGrid: boolean;
  readonly darkMode: 'system' | 'light' | 'dark';
  readonly onlyDrawWithPencil: boolean;
  readonly recognizeShape: boolean;
  readonly keepScreenOn: boolean;
  readonly autoConnect: boolean;
  readonly showRulers: boolean;
  readonly [key: string]: unknown;
}

export interface SelectionState {
  readonly ids: readonly string[];
  readonly kind: 'shape' | 'connector' | 'multi' | 'group' | 'text';
  /** View px; re-emitted on selection, viewport or layout change. */
  readonly anchorRect: Rect;
  readonly actions: readonly SelectionAction[];
  readonly style: StyleSnapshot;
  /**
   * The selection menu is not shown (C++ `SelectionMenuWidget::shouldShow` false: the selection
   * is moving, resizing or rotating; or the whole `SelectionWidget` is hidden: scaling, or text
   * being edited). Spec 05 §8, AC-UI-23.
   */
  readonly menuHidden: boolean;
  /**
   * The arrow attributes the connection popup shows, for a single connector or arrow object (C++
   * `ConnectionAttrViewManager`): the routing type (`ConnectionObject::Type`, -1 for an arrow
   * object) and the start / end arrowhead template ids (`null` without one). Part of the published
   * state so the popup re-reads them whenever they change: its own picker, swap, undo and redo,
   * a collaborator's update. `null` for any other selection, a multi-selection included.
   */
  readonly arrows: SelectionArrows | null;
}

export interface SelectionArrows {
  readonly type: number;
  readonly start: string | null;
  readonly end: string | null;
}

export interface BoardUiState {
  readonly inputMode: InputMode;
  /** `ToolMenu` PopupStatus. */
  readonly popup: { readonly for: 'Draw' | 'SmartDraw' | 'Text' | null };
  readonly shapeLibraryOpen: boolean;
  readonly selection: SelectionState | null;
  readonly zoom: number;
  readonly scroll: Point;
  readonly doc: {
    readonly name: string;
    readonly permission: 'owner' | 'edit' | 'read';
    readonly remote: boolean;
    readonly sharable: boolean;
    readonly canRename: boolean;
    readonly canDelete: boolean;
    readonly formatVersion: string;
  };
  readonly pages: { readonly ids: readonly string[]; readonly names: readonly string[]; readonly active: number };
  /** The canvas style new strokes and shapes take (C++ `LekhGlobal::currentStyle`; the pen popup edits it). */
  readonly drawingStyle: StyleSnapshot;
  readonly undo: { readonly canUndo: boolean; readonly canRedo: boolean };
  /** `blockView`. */
  readonly busy: null | {
    readonly message: string;
    readonly actions: readonly { readonly label: string; readonly id: string }[];
  };
  readonly textEdit: TextEditView | null;
  readonly cursor: CursorKind;
  readonly theme: 'light' | 'dark';
  readonly env: HostEnvironment;
  readonly settings: ConfigSnapshot;
}

/** Port of `L/editor/StyleEditor` (engine side): one setter per C++ setter, no return values. */
export interface StyleEditorApi {
  setStrokeColor(c: string): void;
  setStrokeWidth(w: number): void;
  setDash(d: 'solid' | 'dash' | 'dot'): void;
  /** A CSS colour, or `'none'`. */
  setFill(c: string): void;
  setText(p: Partial<StyleSnapshot['text']>): void;
  setCorner(c: 'round' | 'sharp'): void;
}

/** What React calls (spec 05 §6.3). The `*EditorApi` objects follow `StyleEditorApi`'s pattern. */
export interface BoardCommands {
  setInputMode(m: InputMode): void;
  toggleShapeLibrary(open?: boolean): void;
  runSelectionAction(id: SelectionActionId, arg?: unknown): void;
  runContextAction(id: string, at: Point): void;
  insertShape(templateId: string, viewPt?: Point): void;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  goToBeginning(): void;
  clearCanvas(): void;
  undo(): void;
  redo(): void;
}
