// The clipboard (copy/cut/paste, style and size, the OS-clipboard payload) and the editors'
// engine half (colour swatches, property values, page orientation).
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import {
  ClipboardService,
  ColorEditor,
  ColorType,
  MultiSelection,
  PageEditor,
  PageOrientation,
  PropertyEditor,
  StyleEditor,
} from '../../src/edit';
import { CanvasSizeType, MultiObjects, PageSize, TemplatedObject } from '../../src/model';
import { Color, LEKH_COLORS, Style, Unit } from '../../src/style';
import { A, B, C, P, board, fixtureJson, type Board, must } from '../sync/helpers';

const conn = () => board(fixtureJson('format/03-connector.lekh'));
const get = (b: Board, id: string) => b.doc.getPage(P)?.objectStore.getObject(id) ?? null;

describe('ClipboardService', () => {
  it('copy a selection with its connector, paste twice at points: fresh ids, connector between the copies', () => {
    const b = conn();
    const clip = new ClipboardService(b.editor);
    expect(clip.canCopy(get(b, C))).toBe(false);
    clip.copy(new MultiSelection([must(get(b, A)), must(get(b, B)), must(get(b, C))]));
    expect(clip.canPaste()).toBe(true);
    clip.paste(new Point(1000, 1000));
    clip.paste(new Point(2000, 2000));
    const store = must(b.doc.getPage(P)).objectStore;
    expect(store.size).toBe(9);
    const ids = new Set(store.objects.map((o) => o.id));
    expect(ids.size).toBe(9);
    expect(b.editor.undo.undoDepth).toBe(2);
  });

  it('cut deletes the target and its connectors, one step', () => {
    const b = conn();
    const clip = new ClipboardService(b.editor);
    expect(clip.cut(get(b, A))).toBeNull();
    expect(get(b, A)).toBeNull();
    expect(get(b, C)).toBeNull();
    b.editor.undo.undo();
    expect(get(b, A)).not.toBeNull();
    expect(get(b, C)).not.toBeNull();
  });

  it('the OS clipboard payload: a multi object for several, loaded back on another board', () => {
    const b = conn();
    const clip = new ClipboardService(b.editor);
    clip.copy(new MultiSelection([must(get(b, A)), must(get(b, B)), must(get(b, C))]));
    const payload = clip.serialize();
    expect(payload.object?.['type']).toBe('multi');
    const other = board(fixtureJson('format/01-empty.lekh'));
    const clip2 = new ClipboardService(other.editor);
    expect(clip2.load(payload)).toBe(true);
    clip2.paste(new Point(100, 100));
    expect(other.doc.activePage().objectStore.size).toBe(3);
    const single = new ClipboardService(b.editor);
    single.copy(get(b, A));
    expect(single.serialize().object?.['type']).toBe('templated');
    expect(new MultiObjects(b.io.env.objects, null).empty()).toBe(true);
  });

  it('copy style / paste style and copy size / paste size are one step each', () => {
    const b = conn();
    const clip = new ClipboardService(b.editor);
    must(get(b, A)).getDrawingProfile().setStrokeWidth(9);
    clip.copyStyle(get(b, A));
    clip.pasteStyle(get(b, B));
    expect(must(get(b, B)).getDrawingProfile().effectiveStrokeWidth()).toBe(9);
    (get(b, A) as TemplatedObject).setRect((get(b, A) as TemplatedObject).ds.rect().inflate(10));
    clip.copySize(get(b, A));
    clip.pasteSize(get(b, B));
    expect((get(b, B) as TemplatedObject).ds.width()).toBe((get(b, A) as TemplatedObject).selectionRect().width);
    expect((get(b, B) as TemplatedObject).ds.width()).not.toBe(120);
    expect(b.editor.undo.undoDepth).toBe(2);
  });
});

describe('editors', () => {
  it('ColorEditor: the nearest swatch, fill swatches at alpha 230, transparent first for fill', () => {
    const ce = new ColorEditor();
    ce.init(ColorType.Fill, 6, null);
    expect(ce.colors()[0]?.alpha).toBe(0);
    expect(ce.colors()[1]?.alpha).toBe(230);
    // C++ cdist subtracts unsigned channels (owner round UI8): red (255, 0, 0) is brighter in red
    // than (250, 5, 5), so it is "far", and black is picked; an exact swatch is its own.
    ce.setColor(new Color(250, 5, 5));
    expect(ce.currentIndex()).toBe(1 + LEKH_COLORS.findIndex((c) => c.equals(new Color(0, 0, 0))));
    ce.setColor(new Color(255, 0, 0));
    expect(ce.currentIndex()).toBe(1 + LEKH_COLORS.findIndex((c) => c.equals(new Color(255, 0, 0))));
    expect(ce.groupStartIndex()).toBe(Math.trunc(ce.currentIndex() / 6) * 6);
    ce.setColor(new Color(1, 2, 3, 0));
    expect(ce.currentIndex()).toBe(0);
  });

  it('ColorEditor drives the style editor (line colour)', () => {
    const b = conn();
    const se = new StyleEditor(b.editor, new Style());
    const a = must(get(b, A));
    se.start(a, a.getDrawingProfile());
    const ce = new ColorEditor();
    ce.init(ColorType.Line, 6, se);
    ce.setIndex(3);
    expect(a.getDrawingProfile().effectiveStrokePaint().solidColor.equals(ce.currentColor())).toBe(true);
    ce.setOpacity(0.5);
    expect(a.getDrawingProfile().effectiveStrokePaint().solidColor.alpha).toBe(127);
  });

  it('StyleEditor without a target changes the canvas style only', () => {
    const b = conn();
    const current = new Style();
    const se = new StyleEditor(b.editor, current);
    se.start(null);
    se.setStrokeWidth(4);
    se.setDashType(2);
    expect(current.effectiveStrokeWidth()).toBe(4);
    expect(se.getDashType()).toBe(2);
    expect(b.editor.undo.canUndo()).toBe(false);
  });

  it('PropertyEditor: a parameter change is one step and a changetemplateparams update', () => {
    const b = board(fixtureJson('generated/generators.lekh'));
    const t = b.doc
      .activePage()
      .objectStore.objects.find(
        (o) => o instanceof TemplatedObject && o.shapeTemplate()?.id() === 'avabodh.wireframe.iospagecontrol',
      ) as TemplatedObject;
    const pe = new PropertyEditor(b.editor);
    pe.start(t);
    expect(pe.isValid()).toBe(true);
    const i = must(t.shapeTemplate()).params.findIndex((p) => p.name === 'number of pages');
    expect(pe.getValueType(i)).toBe('int');
    pe.setIntVal(i, 7);
    pe.setIntVal(i, 7);
    expect(pe.getIntVal(i)).toBe(7);
    expect(b.editor.undo.undoDepth).toBe(1);
    expect(b.sink.updates.map((u) => u.type)).toEqual(['changetemplateparams']);
    b.editor.undo.undo();
    expect(pe.getIntVal(i)).toBe(5);
  });

  it('PageEditor: orientation of a fixed page swaps the size; a size of 0 makes it auto', () => {
    const b = conn();
    const pe = new PageEditor(b.editor);
    pe.start();
    pe.setSize(CanvasSizeType.Fixed, new PageSize(Unit.Point, 600, 400), 'X');
    expect(pe.orientation()).toBe(PageOrientation.Landscape);
    pe.setOrientation(PageOrientation.Portrait);
    expect(pe.getSize().width).toBe(400);
    expect(b.editor.undo.undoDepth).toBe(1);
    pe.start();
    pe.setSize(CanvasSizeType.Fixed, new PageSize(Unit.Point, 0, 0), 'Y');
    expect(pe.getCanvasType()).toBe(CanvasSizeType.Auto);
    expect(pe.select(0)).toBe(false);
  });
});
