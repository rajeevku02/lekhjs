// Owner round UI5 #4: a generated template inserted as new content is generated in the font it is
// stamped with. The android date picker (`avabodh.wireframe.androiddatepicker`) sizes the year's
// text box to the year's measured width + 2 (android_datepicker.lua); a library insert built it in
// the platform default family and only then got "Noto Sans" (stampNewContentFont, DR-TXT-06), so
// the box was 1 px narrower than "2018" in Noto Sans less the text padding and the over-long word
// rule (DR-TXT-03 rule 3) broke the year as "201" / "8" — until the board was reopened, when the
// template is generated again in its stored family. C++ stamped no family, so its box always fit.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Point, Rect, Size } from '../../src/geometry';
import { TemplatedObject, type LekhObject } from '../../src/model';
import { RecordedWidthMeasurer } from '../../src/testing';
import { DEFAULT_FONT_FAMILY, type LineMetrics, type TextMeasurer } from '../../src/text';
import { viewHarness, type ViewHarness } from '../interaction/helpers';

const FIXTURES = path.resolve(__dirname, '../../parity/fixtures');
/** Boards holding the generated date shapes, with the platform default family (as the stencils). */
const BOARDS = {
  'avabodh.wireframe.androiddatepicker': 'DR-GEN-08/selected-weekday.lekh',
  'avabodh.wireframe.calendar': 'DR-GEN-05/malformed-date.lekh',
} as const;

type Id = keyof typeof BOARDS;

/**
 * 10 px a character, 5 % wider in Noto Sans (in the browser "2018" at 15 px is 33.37 px in the
 * default sans-serif and 34.32 px in Noto Sans).
 */
class FamilyMeasurer implements TextMeasurer {
  private readonly base_ = new RecordedWidthMeasurer(new Map(), 10);
  measureLine(text: string, fontKey: string): LineMetrics {
    const m = this.base_.measureLine(text, fontKey);
    return fontKey.includes(DEFAULT_FONT_FAMILY) ? { ...m, width: m.width * 1.05 } : m;
  }
}

function added(h: ViewHarness, fn: () => void): LekhObject[] {
  const store = () => h.session.editor.doc.activePage().objectStore;
  const before = new Set(store().objects.map((o) => o.id));
  fn();
  return store().objects.filter((o) => !before.has(o.id));
}

/** A library insert of the board's `id` shape: a new object on a copy of its template, placed as a drop places it. */
function insert(id: Id): { h: ViewHarness; obj: TemplatedObject } {
  const h = viewHarness({
    board: readFileSync(path.join(FIXTURES, BOARDS[id]), 'utf8'),
    measurer: new FamilyMeasurer(),
    host: 'web',
  });
  const src = h.session.editor.doc
    .activePage()
    .objectStore.objects.find((o) => o instanceof TemplatedObject && o.shapeTemplate()?.id() === id) as
    TemplatedObject | undefined;
  const tmpl = src?.shapeTemplate()?.clone() ?? null;
  if (src === undefined || tmpl === null) throw new Error(`no ${id} in the fixture`);
  expect(tmpl.getStyle().effectiveFontFamily()).toBe('');
  expect(tmpl.generator).not.toBeNull();
  const r = src.ds.rect();
  const fresh = new TemplatedObject(h.bv.board.objectEnv(), tmpl, Rect.fromCenter(new Point(0, 0), r.width, r.height));
  const [obj] = added(h, () => {
    h.bv.library.addObjectToCanvas(fresh, 600, 400);
  });
  expect(obj).toBe(fresh);
  return { h, obj: fresh };
}

describe('a generated template inserted as new content is generated in Noto Sans (UI5 #4)', () => {
  for (const id of Object.keys(BOARDS) as Id[]) {
    it(`${id}: the inserted object's data is what its stamped family generates (as a reopen gives)`, () => {
      const { obj } = insert(id);
      expect(obj.getDrawingProfile().effectiveFontFamily()).toBe(DEFAULT_FONT_FAMILY);
      const t = obj.shapeTemplate();
      if (t === null) throw new Error('no template');
      const live = JSON.stringify(t.dataExprs());
      t.load();
      obj.generateData();
      expect(live).toBe(JSON.stringify(t.dataExprs()));
    });
  }

  it('the android date picker year box is the year measured in Noto Sans + 2', () => {
    const { h, obj } = insert('avabodh.wireframe.androiddatepicker');
    const t = obj.shapeTemplate();
    if (t === null) throw new Error('no template');
    const year = t.textData[0]?.text ?? '';
    expect(year).toMatch(/^\d{4}$/);
    // data[10]: the year box width (after the 8 outline entries and the box's x and y).
    const width = Number(t.dataExprs()[10]);
    const style = t.getStyle();
    expect(style.effectiveFontFamily()).toBe(DEFAULT_FONT_FAMILY);
    const noto = h.session.text.measure(year, style, new Size(-1, -1)).width;
    expect(width).toBeCloseTo(noto + 2, 6);
  });
});
