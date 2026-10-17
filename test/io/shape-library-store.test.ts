// The shape library's store (C++ `LibraryObjectStore`) and the library thumbnail (C++
// `CellObject::draw` + `drawObject`): search keys, filtering with not-loaded categories, display
// settings, user libraries first, the template → category rule, and the thumbnail's fit.
import { describe, expect, it } from 'vitest';
import { EngineConfig } from '../../src/base';
import { ShapeLibraryStore, drawLibraryThumbnail, makeLibraryKeys, type TemplateInfo } from '../../src/io';
import { TemplatedObject } from '../../src/model';
import type { CatalogCategory } from '../../src/template';
import { recordingCanvas } from '../render/helpers';
import { bundledCatalog, testIo } from './helpers';

const info: TemplateInfo = (id) => {
  const def = bundledCatalog().get(id);
  if (def === undefined) return undefined;
  const j = def.json as Record<string, unknown>;
  return {
    name: typeof j['name'] === 'string' ? j['name'] : '',
    aliases: typeof j['aliases'] === 'string' ? j['aliases'] : '',
  };
};

function bundled(id: string): CatalogCategory {
  const c = bundledCatalog().category(id);
  if (c === undefined) throw new Error(id);
  return c;
}

describe('makeLibraryKeys', () => {
  it('lower-cased alphanumeric words, with prefixes of length >= 2', () => {
    expect([...makeLibraryKeys(' Rounded-Rect ', true)].sort()).toEqual(
      ['ro', 'rou', 'roun', 'round', 'rounde', 'rounded', 're', 'rec', 'rect'].sort(),
    );
    expect([...makeLibraryKeys('Rounded Rect', false)].sort()).toEqual(['rect', 'rounded']);
  });
});

describe('ShapeLibraryStore', () => {
  function store(): ShapeLibraryStore {
    const s = new ShapeLibraryStore({ isCustomVisible: (id) => id === 'lib1' });
    s.initNames({ 'avabodh.networks': 'Router,Switch' });
    s.addCategories([bundled('avabodh.basic'), bundled('avabodh.container')], info);
    s.initEmptyCateg('Flowchart', 'avabodh.flowchart', 'Standard', 'Flowchart', 'https://x/flowchart.json');
    s.initEmptyCateg(
      'Network Infrastructure',
      'avabodh.networks',
      'Network',
      'Network Infrastructure',
      'https://x/n.json',
    );
    s.addCategories([bundled('avabodh.flowchart')], info);
    s.onDisplaySettingChange();
    return s;
  }

  it('keeps C++ order, display settings by category, and fills a known empty category in place', () => {
    const s = store();
    expect(s.allCategories().map((c) => c.id)).toEqual([
      'avabodh.basic',
      'avabodh.container',
      'avabodh.flowchart',
      'avabodh.networks',
    ]);
    expect(s.categoryById('avabodh.flowchart')?.objects().length).toBe(bundled('avabodh.flowchart').items.length);
    expect(s.displaySettings().map((d) => d.name)).toEqual([
      'Basic',
      'Container',
      'Flowchart',
      'Network Infrastructure',
    ]);
    s.addDisplaySetting('Container', false);
    s.onDisplaySettingChange();
    expect(s.categories().map((c) => c.id)).toEqual(['avabodh.basic', 'avabodh.flowchart', 'avabodh.networks']);
  });

  it('search keeps matching shapes and not-loaded categories whose names match', () => {
    const s = store();
    s.filterObjects('rect');
    const basic = s.categoryById('avabodh.basic');
    expect(basic?.objects().length).toBeGreaterThan(0);
    expect(basic?.objects().every((e) => /rect/i.test(`${e.name} ${e.aliases}`))).toBe(true);
    expect(s.categories().some((c) => c.id === 'avabodh.networks')).toBe(false);
    s.filterObjects('rout');
    expect(s.categories().map((c) => c.id)).toEqual(['avabodh.networks']);
    s.filterObjects('');
    expect(s.categories().length).toBe(4);
  });

  it('user libraries go first, in the given order, and keep their entries across a refresh', () => {
    const s = store();
    s.initCustomLibs([
      { name: 'Mine', id: 'lib1', url: 'u1' },
      { name: 'Other', id: 'lib2', url: 'u2' },
    ]);
    s.addCategories(
      [
        {
          id: 'lib1',
          name: 'From content',
          group: 'My Shapes',
          category: 'My Shapes',
          items: bundled('avabodh.basic').items.slice(0, 2),
        },
      ],
      info,
    );
    s.onDisplaySettingChange();
    expect(
      s
        .allCategories()
        .slice(0, 2)
        .map((c) => c.name),
    ).toEqual(['Mine', 'Other']);
    expect(s.categories()[0]?.id).toBe('lib1');
    expect(s.categories().some((c) => c.id === 'lib2')).toBe(false);
    s.initCustomLibs([{ name: 'Mine 2', id: 'lib1', url: 'u1' }]);
    expect(s.allCategories()[0]?.name).toBe('Mine 2');
    expect(s.allCategories()[0]?.objects().length).toBe(2);
    expect(s.categoryById('lib2')).toBeUndefined();
  });

  it('categoryIdForTemplate: overrides, the longest prefix, else Basic', () => {
    const s = store();
    expect(s.categoryIdForTemplate('avabodh.conatiner.pill')).toBe('avabodh.container');
    expect(s.categoryIdForTemplate('avabodh.flowchart.process')).toBe('avabodh.flowchart');
    expect(s.categoryIdForTemplate('unknown.thing')).toBe('avabodh.basic');
  });

  it('collapsing an empty category lets the next expand load again', () => {
    const s = store();
    const n = s.categoryById('avabodh.networks');
    if (n === undefined) throw new Error('n');
    n.loadingAttempted = true;
    s.setExpanded(n, true);
    s.setExpanded(n, false);
    expect(n.loadingAttempted).toBe(false);
  });
});

describe('drawLibraryThumbnail', () => {
  it('resizes a plain shape to the cell (size - 12) and draws it 1:1 at the pixel ratio', () => {
    const io = testIo();
    const obj = io.codec.readObject({
      type: 'templated',
      template: { id: 'avabodh.basic.rectangle' },
      params: { cx: 100, cy: 50, width: 200, height: 100, angle: 0 },
    }).object;
    expect(obj).toBeInstanceOf(TemplatedObject);
    const c = recordingCanvas();
    drawLibraryThumbnail(c.ctx, obj, { size: 52, pixelRatio: 2, config: new EngineConfig() });
    const r = (obj as TemplatedObject).ds.rect();
    expect(r.width).toBeCloseTo(40);
    expect(r.height).toBeCloseTo(20);
    expect(r.center().x).toBeCloseTo(26);
    expect(c.log).toContain('setTransform 2 0 0 2 0 0');
    expect(c.log.some((l) => l.startsWith('stroke') || l.startsWith('fill'))).toBe(true);
  });

  it('a user-library item keeps its size and is drawn scaled', () => {
    const io = testIo();
    const obj = io.codec.readObject({
      type: 'templated',
      template: { id: 'avabodh.basic.rectangle' },
      params: { cx: 200, cy: 50, width: 400, height: 100, angle: 0 },
    }).object;
    const c = recordingCanvas();
    drawLibraryThumbnail(c.ctx, obj, { size: 52, isCustomLib: true, config: new EngineConfig() });
    expect((obj as TemplatedObject).ds.rect().width).toBeCloseTo(400);
    expect(c.log).toContain('setTransform 0.1 0 0 0.1 0 0');
  });
});
