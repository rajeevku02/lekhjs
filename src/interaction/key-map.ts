// The one shortcut table (port of C++ `Command::initKeyCmd` and `Command::initShortcutInfo`,
// `L/app/Command.cpp:648-829`; spec 05 §3.4, spec 02 `KeyMap`). It replaces the three host key
// maps (the web's `KeyboardInput.js`, iOS `KeyCommand.mm`, Android `CanvasView.java`).
//
// Matching is the web's today: the key lower-cased, the modifiers exact (Shift, Ctrl, Alt,
// Command), Ctrl read as Command on non-Apple hosts; Backspace / Delete, Escape, Enter and the
// arrows match with any modifiers. `shortcuts()` is the 31 rows the Keyboard shortcuts screen
// lists, built from the same table so the two cannot drift.

export type KeyCommandId =
  | 'enter'
  | 'escape'
  | 'delete'
  | 'arrow_up'
  | 'arrow_down'
  | 'arrow_left'
  | 'arrow_right'
  | 'save'
  | 'tool_select'
  | 'tool_scroll'
  | 'tool_draw'
  | 'tool_smart_draw'
  | 'tool_erase'
  | 'tool_text'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'reset_zoom'
  | 'zoom_in'
  | 'zoom_out'
  | 'toggle_grid'
  | 'group'
  | 'ungroup'
  | 'select_all'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'cut';

/** A key press as the host reports it (DOM `KeyboardEvent` fields). */
export interface KeyChord {
  readonly key: string;
  readonly code?: string;
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly repeat?: boolean;
}

/** C++ `Modifiers` bits. */
const SHIFT = 1;
const CONTROL = 2;
const ALT = 4;
const COMMAND = 16;

interface Binding {
  readonly key: string;
  readonly mods: number;
  readonly id: KeyCommandId;
}

/** `Command::initKeyCmd`, in its order. */
const BINDINGS: readonly Binding[] = Object.freeze([
  { key: 's', mods: COMMAND, id: 'save' },
  { key: 'v', mods: 0, id: 'tool_select' },
  { key: 'h', mods: 0, id: 'tool_scroll' },
  { key: 'p', mods: 0, id: 'tool_draw' },
  { key: 's', mods: 0, id: 'tool_smart_draw' },
  { key: 'e', mods: 0, id: 'tool_erase' },
  { key: 't', mods: 0, id: 'tool_text' },
  { key: 'b', mods: COMMAND, id: 'bold' },
  { key: 'i', mods: COMMAND, id: 'italic' },
  { key: 'u', mods: COMMAND, id: 'underline' },
  { key: '0', mods: COMMAND, id: 'reset_zoom' },
  { key: '+', mods: COMMAND, id: 'zoom_in' },
  { key: '-', mods: COMMAND, id: 'zoom_out' },
  { key: 'g', mods: 0, id: 'toggle_grid' },
  { key: 'g', mods: COMMAND, id: 'group' },
  { key: 'g', mods: COMMAND | SHIFT, id: 'ungroup' },
  { key: 'a', mods: COMMAND, id: 'select_all' },
  { key: 'z', mods: COMMAND, id: 'undo' },
  { key: 'z', mods: COMMAND | SHIFT, id: 'redo' },
  { key: 'c', mods: COMMAND, id: 'copy' },
  { key: 'v', mods: COMMAND, id: 'paste' },
  { key: 'd', mods: COMMAND, id: 'duplicate' },
  { key: 'x', mods: COMMAND, id: 'cut' },
]);

/** The keys matched with any modifiers (C++ `CmdKey` with `Modifiers::None`). */
const CMD_KEYS: Readonly<Record<string, KeyCommandId>> = Object.freeze({
  backspace: 'delete',
  delete: 'delete',
  escape: 'escape',
  enter: 'enter',
  arrowright: 'arrow_right',
  arrowleft: 'arrow_left',
  arrowup: 'arrow_up',
  arrowdown: 'arrow_down',
});

/** One row of the Keyboard shortcuts screen (C++ `ShortcutInfo`). */
export interface ShortcutRow {
  readonly keys: string;
  readonly label: string;
  /** The C++ icon id, `''` for none. */
  readonly iconId: string;
  /** The command the row triggers; null for a gesture row (Alt + Drag, …). */
  readonly command: KeyCommandId | null;
}

export class KeyMap {
  readonly isApple: boolean;
  private readonly rows_: readonly ShortcutRow[];

  constructor(isApple: boolean) {
    this.isApple = isApple;
    const c = isApple ? '⌘' : 'Ctrl';
    const row = (keys: string, label: string, command: KeyCommandId | null, iconId = ''): ShortcutRow =>
      Object.freeze({ keys, label, iconId, command });
    this.rows_ = Object.freeze([
      row('V', 'Select tool', 'tool_select', 'lekhapp.ui.pointer_mouse'),
      row('H', 'Scroll tool', 'tool_scroll', 'lekhapp.ui.pointer_hand'),
      row('P', 'Pen tool', 'tool_draw', 'lekhapp.ui.pen'),
      row('S', 'Smart pen tool', 'tool_smart_draw', 'lekhapp.ui.smart_pen'),
      row('E', 'Eraser tool', 'tool_erase', 'lekhapp.ui.eraser'),
      row('T', 'Text tool', 'tool_text', 'lekhapp.ui.title_t'),
      row(`${c} + Z`, 'Undo', 'undo', 'lekhapp.ui.undo'),
      row(`${c} + Shift + Z`, 'Redo', 'redo', 'lekhapp.ui.redo'),
      row(`${c} + S`, 'Save', 'save'),
      row(`${c} + A`, 'Select all', 'select_all'),
      row(`${c} + C`, 'Copy', 'copy'),
      row(`${c} + X`, 'Cut', 'cut'),
      row(`${c} + V`, 'Paste', 'paste'),
      row(`${c} + D`, 'Duplicate', 'duplicate'),
      row('backspace', 'Delete', 'delete'),
      row('enter', 'Edit text of selected', 'enter'),
      row('esc', 'Remove popup / deselect', 'escape'),
      row(`${c} + G`, 'Group', 'group'),
      row(`${c} + Shift + G`, 'UnGroup', 'ungroup'),
      row(`${c} + 0`, 'Zoom to 100%', 'reset_zoom'),
      row(`${c} +`, 'Zoom in', 'zoom_in'),
      row(`${c} -`, 'Zoom out', 'zoom_out'),
      row('G', 'Toggle grid', 'toggle_grid'),
      row('← ↑ → ↓', 'Move shape / canvas', null),
      row('Alt + Drag', 'Duplicate selected shape', null),
      row(`${c} + Drag`, 'Scroll canvas', null),
      row(`${c} + Click`, 'Multi select', null),
      row(`${c} + Scroll`, 'Zoom', null),
      row(`${c} + B`, 'Bold', 'bold'),
      row(`${c} + I`, 'Italic', 'italic'),
      row(`${c} + U`, 'Underline', 'underline'),
    ]);
  }

  /** The command `k` triggers, or null (C++ `Command::executeKeys`). */
  resolve(k: KeyChord): KeyCommandId | null {
    const key = k.key.toLowerCase();
    const fixed = CMD_KEYS[key];
    if (fixed !== undefined) return fixed;
    let mods = (k.shift ? SHIFT : 0) | (k.ctrl ? CONTROL : 0) | (k.alt ? ALT : 0) | (k.meta ? COMMAND : 0);
    // Ctrl is Command on non-Apple hosts (`KeyboardInput.js:66-70`).
    if ((mods & CONTROL) !== 0 && !this.isApple) mods = (mods & ~CONTROL) | COMMAND;
    for (const b of BINDINGS) if (b.key === key && b.mods === mods) return b.id;
    return null;
  }

  /** Resolves and runs `k`; true when it matched (the host then calls `preventDefault`). */
  handle(k: KeyChord, run: (id: KeyCommandId) => void): boolean {
    const id = this.resolve(k);
    if (id === null) return false;
    run(id);
    return true;
  }

  /** The 31 rows of the Keyboard shortcuts screen (`Command::initShortcutInfo`). */
  shortcuts(): readonly ShortcutRow[] {
    return this.rows_;
  }

  /** A key press that triggers `id` (tests and the shortcuts screen's "try it"). */
  chordFor(id: KeyCommandId): KeyChord | null {
    const fixed = Object.entries(CMD_KEYS).find(([, v]) => v === id);
    const none = { shift: false, ctrl: false, alt: false, meta: false };
    if (fixed !== undefined) return { key: fixed[0] === 'escape' ? 'Escape' : fixed[0], ...none };
    const b = BINDINGS.find((x) => x.id === id);
    if (b === undefined) return null;
    const cmd = (b.mods & COMMAND) !== 0;
    return {
      key: b.key,
      shift: (b.mods & SHIFT) !== 0,
      ctrl: cmd && !this.isApple,
      alt: false,
      meta: cmd && this.isApple,
    };
  }
}
