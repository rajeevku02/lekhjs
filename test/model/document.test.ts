// LekhDocument, Page and PageBackground, against the C++ semantics (LekhDocument.cpp, Page.cpp,
// Platform.cpp LekhBackground).
import { describe, expect, it } from 'vitest';
import { EngineConfig } from '../../src/base';
import { Rect } from '../../src/geometry';
import {
  BackgroundType,
  CanvasSizeType,
  DocumentInfo,
  LekhDocument,
  OLD_GRID_BACKGROUND,
  Page,
  PageBackground,
  PageSize,
} from '../../src/model';
import { RecordingPlatform } from '../render/helpers';
import { Color, Scaling, Unit } from '../../src/style';
import type { TemplateDef } from '../../src/template';
import { BoxShape, fixedClock, paintEnv, seqIds, verifyConfig } from './helpers';
import { ViewTransform } from '../../src/render';

const ctx = () => ({ config: verifyConfig, clock: fixedClock(1234), ids: seqIds() });

describe('LekhDocument', () => {
  it('always has a page: a default "Page 1" with a minted short id', () => {
    const doc = new LekhDocument(ctx());
    expect(doc.pages).toHaveLength(1);
    const p = doc.activePage();
    expect(p.name).toBe('Page 1');
    expect(p.order).toBe(0);
    expect(p.id).toHaveLength(22);
    doc.setPages([]);
    expect(doc.pages).toHaveLength(1);
    expect(doc.info).toBeInstanceOf(DocumentInfo);
    expect(doc.info.title).toBe('Lekh Diagram');
    expect(doc.grid).toEqual({ present: true, type: 0 });
  });

  it('pages: sorted, added by order, reordered by swapping orders, deleted, activated', () => {
    const doc = new LekhDocument(ctx());
    const mk = (name: string, order: number) => {
      const p = doc.newPage(name);
      p.order = order;
      return p;
    };
    const [a, b, c] = [mk('a', 300), mk('b', 100), mk('c', 200)];
    doc.setPages([a, b, c]);
    expect(doc.pages.map((p) => p.name)).toEqual(['b', 'c', 'a']);
    doc.addPageWithOrder(mk('d', 150));
    expect(doc.pages.map((p) => p.name)).toEqual(['b', 'd', 'c', 'a']);
    expect(doc.reorderPage(0, 3)).toBe(true);
    expect(doc.pages.map((p) => `${p.name}:${String(p.order)}`)).toEqual(['a:100', 'd:150', 'c:200', 'b:300']);
    expect(doc.reorderPage(0, 9)).toBe(false);
    expect(doc.setActivePageIndex(2)).toBe(true);
    expect(doc.activePage().name).toBe('c');
    expect(doc.deletePage(c.id)).toBe(2);
    expect(doc.deletePage('nope')).toBe(-1);
    expect(doc.activePage().name).toBe('b');
    expect(doc.getPage(a.id)).toBe(a);
    expect(doc.getPageIndex(b)).toBe(2);
  });

  it('getPageOrderForIndex: ends, midpoint, and renumbering of adjacent orders', () => {
    const doc = new LekhDocument(ctx());
    const p = (order: number) => {
      const pg = doc.newPage();
      pg.order = order;
      return pg;
    };
    doc.setPages([p(100), p(101), p(300)]);
    const changes = new Map<string, number>();
    expect(doc.getPageOrderForIndex(0, changes)).toBe(100 - 100 - 34);
    expect(doc.getPageOrderForIndex(3, changes)).toBe(300 + 100 + 34);
    expect(doc.getPageOrderForIndex(2, changes)).toBe(200);
    expect(changes.size).toBe(0);
    // 100 and 101 are adjacent: the new order is 100 + 134, and pages from 1 on are renumbered.
    expect(doc.getPageOrderForIndex(1, changes)).toBe(234);
    expect(doc.pages.map((pg) => pg.order)).toEqual([100, 368, 502]);
    expect([...changes.values()]).toEqual([368, 502]);
  });

  it('templates are definitions keyed by id (DocTemplates)', () => {
    const doc = new LekhDocument(ctx());
    const def = { id: 't1' } as TemplateDef;
    doc.addTemplate(def);
    expect(doc.get('t1')).toBe(def);
    expect(doc.hasTemplate('t1')).toBe(true);
    expect(doc.templateIds()).toEqual(['t1']);
  });

  it('snap step, resize snap step and grid width per unit', () => {
    const doc = new LekhDocument(ctx());
    expect(doc.snapStep()).toMatchObject({ val: 8, unit: Unit.Point });
    expect(doc.resizeSnapStep().val).toBe(4);
    expect(doc.gridWidth(false).val).toBe(16);
    expect(doc.gridWidth(true).val).toBe(32);
    doc.scaling = new Scaling(Unit.Inch, 1);
    expect(doc.snapStep()).toMatchObject({ val: 0.125, unit: Unit.Inch });
    expect(doc.gridWidth(true).val).toBe(0.25);
    doc.scaling = new Scaling(Unit.Centimeter, 1);
    expect(doc.snapStep()).toMatchObject({ val: 0.25, unit: Unit.Centimeter });
  });

  it('layoutAll flushes every page or one', () => {
    const doc = new LekhDocument(ctx());
    const s = new BoxShape('s', new Rect(0, 0, 10, 10), 100);
    doc.activePage().objectStore.add(s);
    doc.layoutAll('other');
    expect(s.layouts).toBe(0);
    doc.layoutAll();
    expect(s.layouts).toBe(1);
  });
});

describe('Page', () => {
  const page = (cfg = verifyConfig) => new Page('p1', 'P', { config: cfg, clock: fixedClock() });

  it('size type names round-trip; unknown is auto', () => {
    expect(Page.sizeTypeToStr(CanvasSizeType.Infinite)).toBe('infinite');
    expect(Page.sizeTypeFromStr('fixed')).toBe(CanvasSizeType.Fixed);
    expect(Page.sizeTypeFromStr('bogus')).toBe(CanvasSizeType.Auto);
  });

  it('auto canvas size: bounds of all + rightBottomMargin, at least the minimum, capped', () => {
    const p = page();
    expect(p.getCanvasSize(false)).toEqual({ width: 612, height: 792, offsetx: 0, offsety: 0 });
    const s = new BoxShape('s', new Rect(100, 50, 1000, 2000), 100);
    s.stroke = 0;
    p.objectStore.add(s);
    expect(p.getCanvasSize(false)).toEqual({ width: 1164, height: 2114, offsetx: 100, offsety: 50 });
    expect(p.computedSize).toEqual({ width: 1164, height: 2114 });
    s.setRect(new Rect(0, 0, 90000, 10));
    expect(p.getCanvasSize(true).width).toBe(50000);
    expect(p.computedSize.width).toBe(1164);
  });

  it('fixed canvas size by unit; pixel units divide by the integer pixels-per-point', () => {
    const p = page();
    p.canvasSizeType = CanvasSizeType.Fixed;
    p.size = new PageSize(Unit.Inch, 8.5, 11);
    expect(p.getCanvasSize(false)).toMatchObject({ width: 1224, height: 1584 });
    p.size = new PageSize(Unit.Centimeter, 2.54, 1);
    expect(p.getCanvasSize(false).width).toBeCloseTo(144);
    p.size = new PageSize(Unit.Point, 2, 300);
    expect(p.getCanvasSize(false)).toMatchObject({ width: 5, height: 300 });
    p.size = new PageSize(Unit.Pixel, 800, 600);
    expect(p.getCanvasSize(false, 144)).toMatchObject({ width: 800, height: 600 });
    // Web and backend (96 ppi): C++ divides by int(96 / 144) = 0 and caps the infinity.
    expect(p.getCanvasSize(false, 96)).toMatchObject({ width: 50000, height: 50000 });
  });

  it('margin box: drawn on screen when positive and under half the canvas, never on export', () => {
    const p = page();
    p.margin = { show: true, size: new PageSize(Unit.Point, 36, 36) };
    p.getCanvasSize(false);
    expect(p.marginBox(1)).toEqual({ fromX: 36, fromY: 36, toX: 612 - 36, toY: 792 - 36 });
    const dp = new RecordingPlatform();
    const view = new ViewTransform({ zoom: 1, canvasW: 800, canvasH: 600 });
    p.paint(dp, { env: paintEnv(), view });
    expect(dp.paths).toHaveLength(1);
    const dp2 = new RecordingPlatform();
    p.paint(dp2, { env: paintEnv(verifyConfig, 1, true), view });
    expect(dp2.paths).toHaveLength(0);
    p.canvasSizeType = CanvasSizeType.Infinite;
    expect(p.marginBox(1)).toBeNull();
    p.canvasSizeType = CanvasSizeType.Auto;
    p.margin = { show: true, size: new PageSize(Unit.Point, 400, 36) };
    expect(p.marginBox(1)).toBeNull();
  });

  it('cloneWithoutObjects copies the attributes, not the id, order or objects', () => {
    const p = page(new EngineConfig());
    p.order = 500;
    p.canvasName = 'A4';
    p.objectStore.add(new BoxShape('s', new Rect(0, 0, 1, 1)));
    const c = p.cloneWithoutObjects('p2');
    expect([c.id, c.order, c.canvasName, c.name, c.objectStore.size]).toEqual(['p2', 0, 'A4', 'P', 0]);
    expect(c.background).not.toBe(p.background);
  });
});

describe('PageBackground', () => {
  it('colour, image, equality, and the old grid images turning the grid on', () => {
    const bg = new PageBackground();
    expect(bg.type).toBe(BackgroundType.Default);
    bg.setColor(new Color(1, 2, 3, 255));
    expect(bg.type).toBe(BackgroundType.Color);
    const other = new PageBackground();
    other.setColor(new Color(1, 2, 3, 255));
    expect(bg.equals(other)).toBe(true);
    bg.setImageData('abc');
    expect(bg.type).toBe(BackgroundType.Image);
    expect(bg.equals(other)).toBe(false);
    bg.setImageData(OLD_GRID_BACKGROUND);
    expect(bg.type).toBe(BackgroundType.Default);
    expect(bg.hasGrid).toBe(true);
    bg.setImageData('');
    expect(bg.type).toBe(BackgroundType.Default);
  });
});
