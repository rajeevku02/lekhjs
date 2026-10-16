// TemplateCatalog (immutable, shared) and CatalogOverlay (per session, copy-on-write):
// AC-GEN-02 (every stencil template builds), AC-GEN-03 (definitions are frozen), AC-GEN-04 (two
// sessions over one base do not see each other), the C++ lookup orders, the compiled-expression
// cache, and the generator classification.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Point } from '../../src/geometry';
import {
  CatalogOverlay,
  CatalogTemplateResolver,
  EmbedInfo,
  PathInfo,
  ShapeTemplate,
  TemplateCatalog,
  classifyGenerator,
  classifyOnly,
  compiledDataOf,
  defaultEmbedFrame,
  type GeneratorResolveFn,
  type LibraryFileJson,
  type TemplateDef,
  type TemplateEnv,
} from '../../src/template';
import { PKG_ROOT } from '../lint/eslint-helpers';
import { testEnv } from './helpers';

const STENCILS = path.join(PKG_ROOT, 'stencils');
const V4 = path.join(PKG_ROOT, '..', 'lekhboard', 'stencils', 'v4');

function readDir(dir: string): LibraryFileJson[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_') && f !== 'libnames.json')
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as LibraryFileJson);
}

const bundled = () => [
  ...readDir(path.join(STENCILS, 'builtin')),
  ...readDir(path.join(STENCILS, 'builtin', 'icons')),
  ...readDir(path.join(STENCILS, 'core')),
];

function file(): LibraryFileJson {
  return {
    templates: [
      { id: 't.box', data: ['-w/2', '-h/2', 'w/2', 'h/2'], draw: ['M 0 1 L 2 3'], help: 'A box' },
      { id: 't.poly', polygon: true, data: ['w'] },
      { id: 'avabodh.basic.text' },
      { id: 't.bad', data: ['w*-0.5', 'h'] },
      { data: ['w'] },
      'not an object',
    ],
    arrows: [
      { id: 'arrow.b', data: [] },
      { id: 'arrow.a', data: [] },
    ],
    library: [
      {
        id: 'cat.one',
        name: 'One',
        group: 'g',
        category: 'c',
        objects: [
          't.box',
          'no.such',
          { template: { id: 't.obj', data: ['w'] }, params: { width: 30, height: 20 } },
          { type: 'templated', template: { id: 't.box' }, params: { width: 5, height: 5 } },
          { type: 'group', objects: [] },
          { type: 'connection' },
          { template: { id: 't.ref.missing' } },
        ],
      },
    ],
  };
}

describe('TemplateCatalog.build', () => {
  it('reads templates, arrows and categories, and records issues without content', () => {
    const c = TemplateCatalog.build([file()]);
    expect(c.templateIds()).toEqual(['t.box', 't.poly', 'avabodh.basic.text', 't.bad']);
    expect(c.template('t.poly')?.klass).toBe('polygon');
    expect(c.template('avabodh.basic.text')?.klass).toBe('text');
    expect(c.template('t.box')?.klass).toBe('shape');
    expect(c.help('t.box')).toBe('A box');
    expect(c.arrowheads().map((a) => a.id)).toEqual(['arrow.a', 'arrow.b']);
    expect(c.issues()).toEqual([
      { id: 't.bad', reason: 'expression_invalid', index: 0 },
      { id: '', reason: 'no_id' },
      { id: '', reason: 'not_object' },
      { id: 't.ref.missing', reason: 'unknown_reference' },
    ]);
    const cat = c.category('cat.one');
    expect(cat?.name).toBe('One');
    // 'no.such', the connection and the missing reference are dropped; the group is kept unkeyed.
    expect(cat?.items.map((i) => i.templateId)).toEqual(['t.box', 't.obj', 't.box', null]);
    expect(c.template('t.bad')?.compiled[0]).toBeNull();
  });

  it('keeps the C++ lookup orders: get = templates then objects, getEmbed = objects then templates', () => {
    const c = TemplateCatalog.build([file()]);
    // 't.box' is a template and (by reference) a library object.
    expect(c.get('t.box')?.object).toBeNull();
    expect(c.getEmbed('t.box')?.object).not.toBeNull();
    expect(c.get('t.obj')?.object).not.toBeNull();
    expect(c.has('t.obj')).toBe(true);
    expect(c.has('arrow.a')).toBe(false);
  });

  it('every definition is frozen, recursively (AC-GEN-03)', () => {
    const c = TemplateCatalog.build(bundled());
    let n = 0;
    for (const id of c.templateIds()) {
      const def = c.template(id) as TemplateDef;
      expect(Object.isFrozen(def)).toBe(true);
      expect(Object.isFrozen(def.json)).toBe(true);
      expect(Object.isFrozen(def.compiled)).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(100);
    const def = c.template(c.templateIds()[0] ?? '') as TemplateDef;
    expect(() => {
      (def as { id: string }).id = 'x';
    }).toThrow(TypeError);
    expect(() => {
      (def.json as Record<string, unknown>)['data'] = [];
    }).toThrow(TypeError);
    const data = def.json['data'];
    if (Array.isArray(data)) {
      expect(() => {
        (data as unknown[]).push('w');
      }).toThrow(TypeError);
    }
    expect(Object.isFrozen(c.categories()[0])).toBe(true);
  });

  it('every bundled template (builtin, icons, core) builds with no issue (AC-GEN-02)', () => {
    const c = TemplateCatalog.build(bundled());
    expect(c.issues()).toEqual([]);
    expect(c.templateIds().length).toBeGreaterThan(200);
    expect(c.arrowheads()).toHaveLength(26);
  });

  it.skipIf(!existsSync(V4))(
    'every lekhboard/stencils/v4 template builds with no issue (AC-GEN-02; v5 once G6 publishes it)',
    () => {
      const c = TemplateCatalog.build(readDir(V4));
      expect(c.issues()).toEqual([]);
      expect(c.templateIds().length).toBeGreaterThan(300);
      // The 34 wireframe generator templates are classified Lua (no conversion without generators/).
      const lua = c.templateIds().filter((id) => c.template(id)?.generator?.kind === 'lua');
      expect(lua.filter((id) => id.startsWith('avabodh.wireframe.'))).toHaveLength(34);
    },
    60_000,
  );

  it('withLibrary returns a new catalog and leaves the base alone', () => {
    const base = TemplateCatalog.build([file()]);
    const more = TemplateCatalog.withLibrary(base, { templates: [{ id: 'x.new', data: ['1'] }] });
    expect(more.template('x.new')).toBeDefined();
    expect(more.template('t.box')).toBe(base.template('t.box'));
    expect(base.template('x.new')).toBeUndefined();
  });

  it('runs the resolve hook on every body, objects included, and keeps the converted body', () => {
    const seen: string[] = [];
    const resolve: GeneratorResolveFn = (json) => {
      seen.push(typeof json['id'] === 'string' ? json['id'] : '?');
      if (json['generator'] === undefined) return classifyOnly(json);
      const converted = { ...json, generator: { script: '/*lekh-js:1:wireframe/button*/', text: 'OK' } };
      return { json: converted, generator: { kind: 'js', key: 'wireframe/button' }, converted: true };
    };
    const c = TemplateCatalog.build(
      [
        {
          templates: [{ id: 'w.btn', generator: { scriptfile: 'button.lua', text: 'OK' } }],
          library: [{ id: 'l', objects: [{ template: { id: 'w.obj', generator: { script: 'return 1' } } }] }],
        },
      ],
      resolve,
    );
    expect(seen).toEqual(['w.btn', 'w.obj']);
    expect(c.template('w.btn')?.converted).toBe(true);
    expect(c.template('w.btn')?.generator).toEqual({ kind: 'js', key: 'wireframe/button' });
    const obj = c.object('w.obj')?.object;
    expect((obj?.['template'] as Record<string, unknown>)['generator']).toEqual({
      script: '/*lekh-js:1:wireframe/button*/',
      text: 'OK',
    });
  });
});

describe('CatalogOverlay', () => {
  it('two sessions over one base: additions stay in their overlay (AC-GEN-04)', () => {
    const base = TemplateCatalog.build([file()]);
    const before = base.templateIds().slice();
    const a = new CatalogOverlay(base);
    const b = new CatalogOverlay(base);
    a.addLibraryFile(
      { templates: [{ id: 'only.a', data: ['w'] }], library: [{ id: 'cat.one', objects: ['only.a'] }] },
      'stencil',
    );
    b.addTemplate({ id: 'doc.b', data: ['h'] });
    expect(a.get('only.a')).toBeDefined();
    expect(b.get('only.a')).toBeUndefined();
    expect(b.get('doc.b')).toBeDefined();
    expect(a.get('doc.b')).toBeUndefined();
    expect(base.get('only.a')).toBeUndefined();
    expect(base.get('doc.b')).toBeUndefined();
    expect(base.templateIds()).toEqual(before);
    // The overlay extends the base category; the base category is unchanged.
    expect(
      a
        .categories()
        .find((c) => c.id === 'cat.one')
        ?.items.at(-1)?.templateId,
    ).toBe('only.a');
    expect(base.category('cat.one')?.items.map((i) => i.templateId)).toEqual(['t.box', 't.obj', 't.box', null]);
    expect(b.categories()).toEqual(base.categories());
  });

  it('an overlay template shadows the base one of the same id', () => {
    const base = TemplateCatalog.build([file()]);
    const o = new CatalogOverlay(base);
    const mine = o.addTemplate({ id: 't.box', data: ['1', '2'] });
    expect(o.get('t.box')).toBe(mine);
    expect(base.get('t.box')).not.toBe(mine);
  });

  it('getEmbed: library objects, then templates (overlay before base), then the document', () => {
    const base = TemplateCatalog.build([file()]);
    const o = new CatalogOverlay(base);
    const docDef = new CatalogOverlay(TemplateCatalog.empty()).addTemplate({ id: 'doc.only', data: [] });
    const doc = new Map([
      ['doc.only', docDef as TemplateDef],
      ['t.box', docDef as TemplateDef],
    ]);
    expect(o.getEmbed('t.box', doc)?.object).not.toBeNull();
    expect(o.getEmbed('doc.only', doc)).toBe(docDef);
    expect(o.getEmbed('doc.only')).toBeUndefined();
  });

  it('instantiate needs the injected factory', () => {
    const o = new CatalogOverlay(TemplateCatalog.build([file()]));
    expect(() => o.instantiate(o.get('t.box') as TemplateDef)).toThrow(/no template factory/);
  });
});

describe('CatalogTemplateResolver', () => {
  /** A minimal codec: data and draw only. */
  function factory(env: () => TemplateEnv) {
    return (def: TemplateDef): ShapeTemplate => {
      const t = new ShapeTemplate(env());
      t.templateId = def.id;
      t.dataExpStrs = def.data.slice();
      const draw = def.json['draw'];
      if (Array.isArray(draw)) for (const d of draw) if (typeof d === 'string') t.pathData.push(new PathInfo(d));
      t.useCompiled(compiledDataOf(def));
      return t;
    };
  }

  it('instantiated templates share the catalog-compiled expressions', () => {
    const base = TemplateCatalog.build([file()]);
    const late: { env?: TemplateEnv } = {};
    const o = new CatalogOverlay(base, { instantiate: factory(() => late.env as TemplateEnv) });
    const resolver = new CatalogTemplateResolver(o, (def) => {
      const t = o.instantiate(def);
      t.load();
      return { template: t, ...defaultEmbedFrame(t) };
    });
    late.env = testEnv({ resolver });
    const t1 = resolver.getTemplate('t.box');
    const t2 = resolver.getTemplate('t.box');
    expect(t1).not.toBeNull();
    const ex = (t: ShapeTemplate | null) => (t as unknown as { expressions_: unknown[] }).expressions_;
    expect(ex(t1)[0]).toBe(base.template('t.box')?.compiled[0]);
    expect(ex(t1)[0]).toBe(ex(t2)[0]);
    expect(resolver.getEmbed('t.box')?.rect.center()).toEqual(new Point(0, 0));
    expect(resolver.getEmbed('nothing')).toBeNull();
  });

  it('an embed cycle resolves to nothing instead of recursing forever', () => {
    const cyc: LibraryFileJson = {
      templates: [
        { id: 'a', data: ['0', '0', 'w', 'h', '0'], embeds: [{ name: 'b', location: '0 1 2 3 4' }] },
        { id: 'b', data: ['0', '0', 'w', 'h', '0'], embeds: [{ name: 'a', location: '0 1 2 3 4' }] },
      ],
    };
    const base = TemplateCatalog.build([cyc]);
    const late: { env?: TemplateEnv } = {};
    const make = (def: TemplateDef): ShapeTemplate => {
      const t = new ShapeTemplate(late.env as TemplateEnv);
      t.templateId = def.id;
      t.dataExpStrs = def.data.slice();
      const e = (def.json['embeds'] as { name: string; location: string }[] | undefined)?.[0];
      if (e !== undefined) {
        t.embedData.push(new EmbedInfo(e.name, '', e.location, '', false, null));
      }
      return t;
    };
    const o = new CatalogOverlay(base, { instantiate: make });
    const cycles: string[] = [];
    const resolver = new CatalogTemplateResolver(
      o,
      (def) => {
        const t = o.instantiate(def);
        t.load();
        return { template: t, ...defaultEmbedFrame(t) };
      },
      undefined,
      (id) => cycles.push(id),
    );
    late.env = testEnv({ resolver });
    const a = resolver.getEmbed('a');
    expect(a?.template.embeds()).toHaveLength(1);
    expect(a?.template.embeds()[0]?.template.embeds()).toHaveLength(0);
    expect(cycles).toEqual(['a']);
  });
});

describe('classifyGenerator', () => {
  it.each([
    [{ script: '/*lekh-js:1:wireframe/button*/ x' }, { kind: 'js', key: 'wireframe/button' }],
    [
      { type: 'LuaShapeGenerator', script: 'return 1' },
      { kind: 'lua', key: '' },
    ],
    [
      { scriptfile: 'button.lua', script: '' },
      { kind: 'lua', key: '' },
    ],
    [{ text: 'no script at all' }, { kind: 'lua', key: '' }],
    [
      { type: 'native', shape: 'table-v1' },
      { kind: 'native', key: 'table-v1' },
    ],
    [
      { type: 'native', shape: '' },
      { kind: 'unknown', key: '', reason: 'unknown_native_shape' },
    ],
    [{ type: 'python' }, { kind: 'unknown', key: '', reason: 'unknown_type' }],
  ])('%j', (gen, expected) => {
    expect(classifyGenerator(gen)).toEqual(expected);
  });

  it('classifyOnly never converts and never evaluates the script (AC-GEN-09)', () => {
    const json = { id: 'x', generator: { script: 'globalThis.__lekhHit = true' } };
    const r = classifyOnly(json);
    expect(r.converted).toBe(false);
    expect(r.json).toBe(json);
    expect((globalThis as Record<string, unknown>)['__lekhHit']).toBeUndefined();
  });
});
