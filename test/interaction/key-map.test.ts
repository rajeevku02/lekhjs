// AC-UI-09 (lekhjs half): `KeyMap.shortcuts()` is the 31 rows of C++ `Command::initShortcutInfo`
// (`Command.cpp:791-829`) in order; every row's keys trigger its command (Ctrl → Cmd off Apple);
// and every command has its C++ effect on a board. The Playwright half (the web board and the
// Keyboard shortcuts dialog) is e2e's.
import { describe, expect, it } from 'vitest';
import { GroupObject, type TemplatedObject } from '../../src/model';
import { FontStyle, FontWeight, TextDecoration } from '../../src/style';
import { DESKTOP_WEB, InputMode, KeyMap, type KeyChord, type KeyCommandId } from '../../src/interaction';
import { A, B, viewHarness, type ViewHarness } from './helpers';

const LABELS = [
  'Select tool',
  'Scroll tool',
  'Pen tool',
  'Smart pen tool',
  'Eraser tool',
  'Text tool',
  'Undo',
  'Redo',
  'Save',
  'Select all',
  'Copy',
  'Cut',
  'Paste',
  'Duplicate',
  'Delete',
  'Edit text of selected',
  'Remove popup / deselect',
  'Group',
  'UnGroup',
  'Zoom to 100%',
  'Zoom in',
  'Zoom out',
  'Toggle grid',
  'Move shape / canvas',
  'Duplicate selected shape',
  'Scroll canvas',
  'Multi select',
  'Zoom',
  'Bold',
  'Italic',
  'Underline',
];

function chord(km: KeyMap, id: KeyCommandId): KeyChord {
  const c = km.chordFor(id);
  if (c === null) throw new Error(`no chord for ${id}`);
  return c;
}

function press(h: ViewHarness, id: KeyCommandId): boolean {
  return h.bv.key(chord(h.bv.keys, id));
}

const count = (h: ViewHarness) => h.session.editor.doc.activePage().objectStore.size;

describe('KeyMap rows (AC-UI-09)', () => {
  it('has the 31 C++ rows, in order', () => {
    const km = new KeyMap(false);
    expect(km.shortcuts()).toHaveLength(31);
    expect(km.shortcuts().map((r) => r.label)).toEqual(LABELS);
    expect(km.shortcuts()[6]?.keys).toBe('Ctrl + Z');
    expect(new KeyMap(true).shortcuts()[6]?.keys).toBe('⌘ + Z');
  });

  for (const apple of [false, true]) {
    it(`every row with a command resolves from its keys (${apple ? 'Apple' : 'other'} host)`, () => {
      const km = new KeyMap(apple);
      for (const row of km.shortcuts()) {
        if (row.command === null) continue;
        expect(km.resolve(chord(km, row.command))).toBe(row.command);
      }
    });
  }

  it('matches the web today: lower-cased keys, exact modifiers, Ctrl is Cmd off Apple', () => {
    const none = { shift: false, ctrl: false, alt: false, meta: false };
    const other = new KeyMap(false);
    const mac = new KeyMap(true);
    expect(other.resolve({ ...none, key: 'Z', ctrl: true })).toBe('undo');
    expect(other.resolve({ ...none, key: 'Z', ctrl: true, shift: true })).toBe('redo');
    expect(mac.resolve({ ...none, key: 'z', ctrl: true })).toBeNull();
    expect(mac.resolve({ ...none, key: 'z', meta: true })).toBe('undo');
    expect(other.resolve({ ...none, key: 'v' })).toBe('tool_select');
    expect(other.resolve({ ...none, key: 'V', shift: true })).toBeNull();
    expect(other.resolve({ ...none, key: 'Backspace' })).toBe('delete');
    expect(other.resolve({ ...none, key: 'Delete', shift: true })).toBe('delete');
    expect(other.resolve({ ...none, key: 'ArrowUp', alt: true })).toBe('arrow_up');
    expect(other.resolve({ ...none, key: 'q' })).toBeNull();
  });
});

describe('KeyMap commands on a board (AC-UI-09)', () => {
  it('tools: v h p s e t', () => {
    const h = viewHarness();
    const want: [KeyCommandId, InputMode][] = [
      ['tool_scroll', InputMode.Scroll],
      ['tool_draw', InputMode.Draw],
      ['tool_smart_draw', InputMode.SmartDraw],
      ['tool_erase', InputMode.Erase],
      ['tool_text', InputMode.Text],
      ['tool_select', InputMode.Select],
    ];
    for (const [id, mode] of want) {
      expect(press(h, id)).toBe(true);
      expect(h.bv.modes.get()).toBe(mode);
    }
  });

  it('select all, group, ungroup, undo, redo', () => {
    const h = viewHarness();
    press(h, 'select_all');
    expect(new Set(h.session.selection)).toEqual(new Set([A, B, '4K5eYQdS7snA1MXucdVzUP']));
    press(h, 'group');
    const g = h.session.editor.doc.activePage().objectStore.objects.find((o) => o instanceof GroupObject);
    expect(g).toBeDefined();
    press(h, 'ungroup');
    expect(h.session.editor.doc.activePage().objectStore.objects.some((o) => o instanceof GroupObject)).toBe(false);
    press(h, 'undo');
    expect(h.session.editor.doc.activePage().objectStore.objects.some((o) => o instanceof GroupObject)).toBe(true);
    expect(h.session.selection).toEqual([]);
    press(h, 'redo');
    expect(h.session.editor.doc.activePage().objectStore.objects.some((o) => o instanceof GroupObject)).toBe(false);
  });

  it('delete, duplicate, copy / paste, cut', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    press(h, 'duplicate');
    expect(count(h)).toBe(4);
    h.bv.overlay.select(h.obj(B));
    press(h, 'copy');
    press(h, 'paste');
    expect(count(h)).toBe(5);
    h.bv.overlay.select(h.obj(A));
    press(h, 'cut');
    expect(h.session.editor.doc.activePage().objectStore.getObject(A)).toBeNull();
    h.bv.overlay.select(h.obj(B));
    press(h, 'delete');
    expect(h.session.editor.doc.activePage().objectStore.getObject(B)).toBeNull();
  });

  it('zoom in, zoom out, zoom to 100 %', () => {
    const h = viewHarness();
    press(h, 'zoom_in');
    expect(h.session.view.zoom).toBeCloseTo(1.05, 9);
    press(h, 'zoom_out');
    press(h, 'zoom_out');
    expect(h.session.view.zoom).toBeCloseTo(0.95, 9);
    press(h, 'reset_zoom');
    expect(h.session.view.zoom).toBe(1);
  });

  it('toggle grid', () => {
    const h = viewHarness();
    const was = h.session.document.grid.present;
    press(h, 'toggle_grid');
    expect(h.session.document.grid.present).toBe(!was);
  });

  it('bold, italic, underline toggle the selected shape', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const style = () => (h.obj(A) as TemplatedObject).getDrawingProfile();
    press(h, 'bold');
    expect(style().effectiveFontWeight()).toBe(FontWeight.Bold);
    press(h, 'italic');
    expect(style().effectiveFontStyle()).toBe(FontStyle.Italic);
    press(h, 'underline');
    expect(style().effectiveTextDecoration() & TextDecoration.UnderLine).toBe(TextDecoration.UnderLine);
    press(h, 'bold');
    expect(style().effectiveFontWeight()).not.toBe(FontWeight.Bold);
  });

  it("enter edits the selected shape's text; escape finishes it, then deselects", () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    press(h, 'enter');
    expect(h.bv.textEdit.active).toBe(true);
    expect(h.bv.textEdit.objectId).toBe(A);
    press(h, 'escape');
    expect(h.bv.textEdit.active).toBe(false);
    h.bv.overlay.select(h.obj(A));
    press(h, 'escape');
    expect(h.session.selection).toEqual([]);
  });

  it('escape closes the top popover before it deselects', () => {
    let open = true;
    const h = viewHarness({
      closeTopPopover: () => {
        const was = open;
        open = false;
        return was;
      },
    });
    h.bv.overlay.select(h.obj(A));
    press(h, 'escape');
    expect(h.session.selection).toEqual([A]);
    press(h, 'escape');
    expect(h.session.selection).toEqual([]);
  });

  it('arrows move the selection 2 px, or the canvas 8', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const cy = h.tobj(A).ds.cy();
    press(h, 'arrow_up');
    expect(h.tobj(A).ds.cy()).toBeCloseTo(cy - 2, 9);
    const cx = h.tobj(A).ds.cx();
    press(h, 'arrow_right');
    expect(h.tobj(A).ds.cx()).toBeCloseTo(cx + 2, 9);
    h.bv.overlay.deselect();
    const ty = h.session.view.ty;
    press(h, 'arrow_up');
    expect(h.session.view.ty).toBeCloseTo(ty + 8, 9);
  });

  it('save calls the host', () => {
    let saved = 0;
    const h = viewHarness({ save: () => saved++, env: { ...DESKTOP_WEB, isApple: true } });
    expect(h.bv.key({ key: 's', shift: false, ctrl: false, alt: false, meta: true })).toBe(true);
    expect(saved).toBe(1);
  });
});

describe('Zoom in on every "+" chord (owner fix list, item 5)', () => {
  const k = (key: string, m: Partial<KeyChord>): KeyChord => ({
    key,
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
    ...m,
  });

  it('Apple: ⌘+, ⌘⇧= (a US "+") and ⌘= zoom in; ⌘- still zooms out', () => {
    const km = new KeyMap(true);
    expect(km.resolve(k('+', { meta: true }))).toBe('zoom_in');
    expect(km.resolve(k('+', { meta: true, shift: true }))).toBe('zoom_in');
    expect(km.resolve(k('=', { meta: true }))).toBe('zoom_in');
    expect(km.resolve(k('=', { meta: true, shift: true }))).toBe('zoom_in');
    expect(km.resolve(k('-', { meta: true }))).toBe('zoom_out');
  });

  it('off Apple: Ctrl in place of ⌘, the same chords', () => {
    const km = new KeyMap(false);
    expect(km.resolve(k('+', { ctrl: true }))).toBe('zoom_in');
    expect(km.resolve(k('+', { ctrl: true, shift: true }))).toBe('zoom_in');
    expect(km.resolve(k('=', { ctrl: true }))).toBe('zoom_in');
  });

  it('not without the command key, nor with Alt', () => {
    const km = new KeyMap(true);
    expect(km.resolve(k('=', {}))).toBeNull();
    expect(km.resolve(k('+', { shift: true }))).toBeNull();
    expect(km.resolve(k('=', { meta: true, alt: true }))).toBeNull();
    expect(km.resolve(k('=', { ctrl: true }))).toBeNull();
  });
});
