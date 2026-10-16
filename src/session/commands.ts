// The `command` events a session runs (spec 01 §4.2 `EditCommand`, spec 03 §12.1): what
// `interaction/BoardController`, the React panels, the keyboard map and dialog continuations
// dispatch. Each one wraps `edit/` (the commands, the undo stack, the transaction helper); the
// session never re-implements an edit.
//
// Ids, never objects: an event may be queued behind a reload or a remote delete, so every command
// names its objects by id and the session re-resolves them when the command runs (spec 03 §12.2).
// Ids that no longer exist are dropped; a command with `docGeneration` from before a reload is
// dropped whole (`stale_continuation`).
//
// `custom` runs a handler registered with `BoardSession.registerCommand`: how the interaction
// layer and the panels add their own commands, and how a test registers one that throws.
import type { ClipboardService, EditCommands, EditorContext } from '../edit';
import type { LekhDocument, LekhObject, Page } from '../model';

export type EditCommand =
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  /** Replaces the selection (ids on the active page). */
  | { readonly kind: 'select'; readonly ids: readonly string[] }
  /** `TranslateObjectAction`: one undo step, one `changeattr` frame. */
  | { readonly kind: 'move'; readonly ids: readonly string[]; readonly dx: number; readonly dy: number }
  | { readonly kind: 'delete'; readonly ids: readonly string[] }
  | { readonly kind: 'duplicate'; readonly ids: readonly string[] }
  | { readonly kind: 'group'; readonly ids: readonly string[] }
  | { readonly kind: 'ungroup'; readonly ids: readonly string[] }
  /** C++ `flip(type)`: 1 horizontal, 2 vertical. */
  | { readonly kind: 'flip'; readonly ids: readonly string[]; readonly direction: 1 | 2 }
  | { readonly kind: 'zOrder'; readonly ids: readonly string[]; readonly front: boolean }
  /** C++ `Command::clear`: every object of the active page, one undo step. */
  | { readonly kind: 'clear' }
  | { readonly kind: 'setActivePage'; readonly pageId: string }
  /** Zoom, scroll and canvas size (`ViewState`); not an edit, never sent. */
  | {
      readonly kind: 'view';
      readonly zoom?: number;
      readonly tx?: number;
      readonly ty?: number;
      readonly canvasW?: number;
      readonly canvasH?: number;
      readonly dpr?: number;
    }
  | { readonly kind: 'custom'; readonly name: string; readonly ids?: readonly string[]; readonly arg?: unknown };

/** What a `custom` handler (and a recognition-result applier) gets: the board's edit services. */
export interface CommandContext {
  readonly doc: LekhDocument;
  /** The active page. */
  readonly page: Page;
  readonly editor: EditorContext;
  readonly commands: EditCommands;
  readonly clipboard: ClipboardService;
  /** The command's ids resolved on the active page; ids that no longer exist are left out. */
  readonly objects: readonly LekhObject[];
  /** Replaces the selection after the command (ids on the active page). */
  select(ids: readonly string[]): void;
}

/** A registered `custom` command. Synchronous: an engine handler never awaits (spec 03 §12.1). */
export type CommandHandler = (ctx: CommandContext, arg: unknown) => void;
