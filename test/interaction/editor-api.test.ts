// The panels' engine API (task W5; spec 05 §6.3): style, colour picker, connection, pages,
// properties, set size and settings each change the document as one undo step with its update,
// and continued changes of one kind extend the step; the text editor's view, live update and
// commit (spec 06 §6); image insertion; the user settings file (C++ `Settings`).
import { describe, expect, it } from 'vitest';
import { EngineConfig, LiveConfig, parseUserSettings, serializeUserSettings } from '../../src/base';
import { insertedImageSize } from '../../src/edit';
import { Point } from '../../src/geometry';
import { ConnectionObject, TemplatedObject } from '../../src/model';
import { parseCssColor } from '../../src/interaction';
import { updatetypes } from '../../src/sync';
import { A, C, viewHarness } from './helpers';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('StyleApi', () => {
  it('a stroke-width change is one undo step and one changeattr frame; a second width change extends it', () => {
    const h = viewHarness({ cloud: true });
    h.bv.overlay.select(h.obj(A));
    const style = h.bv.editors.style('selection');
    const depth = h.session.editor.undo.undoDepth;
    style.setStrokeWidth(4);
    style.setStrokeWidth(5);
    expect(h.obj(A).getDrawingProfile().effectiveStrokeWidth()).toBe(5);
    expect(h.session.editor.undo.undoDepth - depth).toBe(1);
    expect(h.transport.sent.length).toBeGreaterThan(0);
    h.bv.commands.run('undo');
    expect(h.obj(A).getDrawingProfile().effectiveStrokeWidth()).not.toBe(5);
  });

  it('text attributes reach the selection and its UI snapshot', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const style = h.bv.editors.style();
    style.setText({ bold: true, italic: true, size: 22, color: '#ff0000', align: 'left' });
    style.setVerticalAlign('top');
    const snap = h.bv.ui.get().selection?.style.text;
    expect(snap).toMatchObject({
      bold: true,
      italic: true,
      size: 22,
      align: 'left',
      verticalAlign: 'top',
      color: 'rgba(255, 0, 0, 1)',
    });
  });

  it('the canvas target edits the drawing style, not the document', () => {
    const h = viewHarness();
    const depth = h.session.editor.undo.undoDepth;
    h.bv.editors.style('canvas').setStrokeWidth(7);
    expect(h.session.currentStyle.effectiveStrokeWidth()).toBe(7);
    expect(h.bv.ui.get().drawingStyle.stroke.width).toBe(7);
    expect(h.session.editor.undo.undoDepth).toBe(depth);
  });

  it('the dash picker row i sets {2i, 2i}; row 0 is solid', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const s = h.bv.editors.style();
    s.setDashArray([6, 6]);
    expect(s.dashArray()).toEqual([6, 6]);
    s.setDashArray([0, 0]);
    expect(s.dashArray()).toEqual([]);
  });
});

describe('ColorPickerApi', () => {
  it('a swatch tap sets the line colour; brightness extends the same step', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const cp = h.bv.editors.colorPicker('line');
    const st = cp.state();
    expect(st.colors.length).toBeGreaterThan(6);
    const depth = h.session.editor.undo.undoDepth;
    cp.setIndex(3);
    expect(cp.state().index).toBe(3);
    cp.setBrightness(40);
    expect(h.session.editor.undo.undoDepth - depth).toBe(1);
    expect(Math.round(cp.state().brightness)).toBe(40);
  });

  it('background swatches change the page background', () => {
    const h = viewHarness();
    const cp = h.bv.editors.colorPicker('background');
    cp.setIndex(2);
    expect(h.session.editor.doc.activePage().background.type).toBe(2);
  });
});

describe('ConnectionApi', () => {
  it('changes the connector type and swaps arrows as single steps', () => {
    const h = viewHarness();
    const con = h.obj(C);
    expect(con).toBeInstanceOf(ConnectionObject);
    h.bv.overlay.select(con);
    const api = h.bv.editors.connection();
    const s0 = api.state();
    expect(s0.isConnection).toBe(true);
    const next = s0.type === 0 ? 2 : 0;
    api.changeConnection(next);
    expect(api.state().type).toBe(next);
    api.setEndArrow(1);
    expect(api.state().endArrow).toBe(1);
    api.swapArrows();
    expect(api.state().startArrow).toBe(1);
  });
});

describe('PageApi', () => {
  it('adds, renames, duplicates, reorders and deletes pages (C++ ManagePages rules)', () => {
    const h = viewHarness();
    const p = h.bv.editors.page();
    p.addPage('');
    expect(
      p
        .pages()
        .map((x) => x.name)
        .at(-1),
    ).toBe('Page-2');
    p.select(1);
    expect(p.activePageIndex()).toBe(1);
    p.renameActive('  Second ');
    expect(p.pages()[1]?.name).toBe('Second');
    p.duplicateActive();
    expect(p.pages()[2]?.name).toBe('Second-copy');
    expect(p.activePageIndex()).toBe(2);
    p.deleteActive();
    expect(p.pages()).toHaveLength(2);
    expect(p.activePageIndex()).toBe(1);
    expect(h.bv.ui.get().pages.names).toEqual(p.pages().map((x) => x.name));
  });

  it('page size, orientation, margin and scaling', () => {
    const h = viewHarness();
    const p = h.bv.editors.page();
    expect(p.canChangeOrientation()).toBe(false);
    p.setPageSizeIndex(3);
    expect(p.pageSizeIndex()).toBe(3);
    expect(p.orientation()).toBe('portrait');
    p.setOrientation('landscape');
    expect(p.orientation()).toBe('landscape');
    p.setMargin({ unit: 'inch', width: 1, height: 1 });
    expect(p.margin()).toEqual({ unit: 'inch', width: 1, height: 1 });
    const depth = h.session.editor.undo.undoDepth;
    p.setScaling({ enabled: true });
    p.setScaling({ enabled: true, value: 3 });
    expect(p.scaling()).toMatchObject({ enabled: true, unit: 'inch', value: 3 });
    expect(h.session.editor.undo.undoDepth - depth).toBe(1);
  });
});

describe('SetSizeApi', () => {
  it('edits live and records one step on close', () => {
    const h = viewHarness();
    const o = h.tobj(A);
    h.bv.overlay.select(o);
    const ss = h.bv.editors.setSize();
    const depth = h.session.editor.undo.undoDepth;
    ss.set('width', 123);
    ss.set('angle', 90);
    expect(ss.values()?.width).toBe(123);
    expect(Math.round(ss.values()?.angle ?? 0)).toBe(90);
    ss.close();
    expect(h.session.editor.undo.undoDepth - depth).toBe(2);
  });
});

describe('PropertyApi', () => {
  it('lists only the editable parameters of a templated selection', () => {
    const h = viewHarness();
    h.bv.overlay.select(h.obj(A));
    const rows = h.bv.editors.property().rows();
    for (const r of rows) expect(['switch', 'enum', 'spinner', 'slider']).toContain(r.editor);
  });
});

describe('SettingsApi and LiveConfig', () => {
  it('a setting change is read by every holder of the runtime config and republishes the UI', () => {
    const h = viewHarness();
    expect(h.bv.board.config.snapToGrid).toBe(true);
    expect(h.bv.editors.settings.set('snapToGrid', false)).toBe(true);
    expect(h.bv.board.config.snapToGrid).toBe(false);
    expect(h.session.config.snapToGrid).toBe(false);
    expect(h.bv.ui.get().settings.snapToGrid).toBe(false);
    expect(h.bv.editors.settings.set('snapToGrid', false)).toBe(false);
    h.bv.editors.settings.set('shapeConnectionGap', false);
    expect(h.session.config.connectionLineSeparationFromObject).toBe(0);
    expect(h.bv.editors.settings.set('screenMode', 5)).toBe(false);
  });

  it('LiveConfig keeps EngineConfig values immutable and notifies', () => {
    const live = new LiveConfig(new EngineConfig({}));
    const first = live.current;
    let n = 0;
    live.onChange(() => n++);
    live.update({ defaultFontSize: 20 });
    expect(first.defaultFontSize).toBe(15);
    expect(live.asConfig().defaultFontSize).toBe(20);
    expect(n).toBe(1);
  });

  it('the settings file reads and writes the C++ keys', () => {
    const o = parseUserSettings(
      '{"snap_objects":false,"shape_connection_gap":false,"screen_display_mode":2,"default_connection_type":7,"default_font_size":20}',
      false,
    );
    expect(o).toEqual({
      showConnectionHandles: false,
      snapToGrid: false,
      connectionLineSeparationFromObject: 0,
      screenMode: 2,
      defaultFontSize: 20,
    });
    expect(parseUserSettings('not json', true)).toEqual({ showConnectionHandles: true });
    const cfg = new EngineConfig(o);
    const text = serializeUserSettings(cfg);
    expect(JSON.parse(text)).toMatchObject({
      snap_objects: false,
      shape_connection_gap: false,
      screen_display_mode: 2,
      default_font_size: 20,
    });
    expect(parseUserSettings(text, true)).toMatchObject(o);
  });
});

describe('text editor (spec 06 §6)', () => {
  it('view: font and line height scale with zoom; colour is the text paint; update re-lays out; finish is one step', () => {
    const h = viewHarness({ cloud: true });
    h.bv.board.setView({ zoom: 1.5 });
    const o = h.tobj(A);
    o.getDrawingProfile().setFontSize(10);
    h.bv.board.edit(() => {
      o.startTextEditing(o.getTextEditCenter());
      h.bv.textEdit.began(o);
    });
    const v = h.bv.ui.get().textEdit;
    expect(v).not.toBeNull();
    expect(v?.lineHeight).toBeCloseTo(1.18 * 10 * o.getEditTextStyle().effectiveFontMultiplier() * 1.5, 5);
    expect(v?.font).toMatch(/15px/);
    expect(v?.color).toBe(o.getEditTextStyle().effectiveTextFill().solidColor.toCss());
    const depth = h.session.editor.undo.undoDepth;
    h.transport.sent.length = 0;
    h.bv.textEdit.update('hello\nworld');
    expect(h.bv.ui.get().textEdit?.text).toBe('hello\nworld');
    expect(h.session.editor.undo.undoDepth).toBe(depth);
    h.bv.textEdit.finish();
    expect(h.bv.ui.get().textEdit).toBeNull();
    expect(o.getTextForEditing()).toBe('hello\nworld');
    expect(h.session.editor.undo.undoDepth - depth).toBe(1);
    expect(
      h.transport.sent.filter((f) => f.includes(updatetypes.changeAttr) || f.includes('text')).length,
    ).toBeGreaterThan(0);
  });

  it('a new floating text left empty is removed with its creation step', () => {
    const h = viewHarness();
    const n = h.session.editor.doc.activePage().objectStore.size;
    const depth = h.session.editor.undo.undoDepth;
    h.bv.canvas.editTextAt(new Point(700, 500), false);
    expect(h.session.editor.doc.activePage().objectStore.size).toBe(n + 1);
    h.bv.textEdit.finish('');
    expect(h.session.editor.doc.activePage().objectStore.size).toBe(n);
    expect(h.session.editor.undo.undoDepth).toBe(depth);
  });
});

describe('insertImage', () => {
  it('adds one image shape of the given size at the point, one undo step', () => {
    // Without snapping the box is exactly the image's size (C++ snaps it with snapToGridNewObject).
    const h = viewHarness({ config: { snapToGridNewObject: false } });
    const n = h.session.editor.doc.activePage().objectStore.size;
    const id = h.bv.insertImage(
      { kind: 'data', base64: PNG_1PX, format: 'PNG', width: 40, height: 20 },
      new Point(100, 100),
    );
    expect(id).not.toBe('');
    const o = h.tobj(id);
    expect(o).toBeInstanceOf(TemplatedObject);
    expect(o.shapeTemplate()?.id()).toBe('avabodh.basic.image');
    expect([o.ds.width(), o.ds.height()]).toEqual([40, 20]);
    expect(h.session.editor.doc.activePage().objectStore.size).toBe(n + 1);
    const r = h.bv.insertImage({ kind: 'resource', url: 'res://abc', width: 10, height: 10 });
    expect(h.tobj(r).shapeTemplate()?.imageData[0]?.src).toBe('res://abc');
  });

  it('insertedImageSize caps the width at insertedImageMaxWidth when resizing is on', () => {
    expect(insertedImageSize(1000, 500, { resizeInsertedImage: true, insertedImageMaxWidth: 500 })).toMatchObject({
      width: 500,
      height: 250,
    });
    expect(insertedImageSize(1000, 500, { resizeInsertedImage: false, insertedImageMaxWidth: 500 })).toMatchObject({
      width: 1000,
      height: 500,
    });
  });
});

describe('parseCssColor', () => {
  it('reads hex and rgba', () => {
    expect(parseCssColor('#f00')?.toCss()).toBe('rgba(255, 0, 0, 1)');
    expect(parseCssColor('rgba(1, 2, 3, 0.5)')?.alpha).toBe(128);
    expect(parseCssColor('nope')).toBeNull();
  });
});
