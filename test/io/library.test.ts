// Stencil and user-library reading (spec 04 §4, §11): the v5 source and paths, the local-first
// plan, the parse into a session overlay (resolve hook included), and user library items read
// without being written back.
import { describe, expect, it } from 'vitest';
import { LibraryItemCodec, LoadError, STENCIL_LIB_VERSION, StencilSetLoader, StencilSource } from '../../src/io';
import { TemplatedObject } from '../../src/model';
import { CatalogOverlay, type GeneratorResolveFn, type JsonObject } from '../../src/template';
import { bundledCatalog, testIo } from './helpers';

describe('StencilSource', () => {
  it('derives the URL and the cache directory from v5', () => {
    expect(STENCIL_LIB_VERSION).toBe('v5');
    expect(StencilSource.baseUrl).toBe('https://rajeevku02.github.io/lekhboard/stencils/v5/');
    expect(StencilSource.cacheDir).toBe('stencils/v5');
    expect(StencilSource.stencilUrl(StencilSource.baseUrl, 'uml.json')).toBe(
      'https://rajeevku02.github.io/lekhboard/stencils/v5/uml.json',
    );
    expect(StencilSource.stencilUrl('https://x/y', 'uml.json')).toBe('https://x/y/uml.json');
  });

  it('local paths as C++ getLocalPath / getLocalPathForCustomLib', () => {
    expect(StencilSource.localPath('https://rajeevku02.github.io/lekhboard/stencils/v5/uml.json', false)).toBe(
      'stencils/v5/uml.json',
    );
    expect(StencilSource.localPath('https://api.lekh.app/v2/library/abc/content', true)).toBe(
      'stencils/v5/abc_content',
    );
    expect(StencilSource.customLibLocalPath('abc')).toBe('stencils/v5/abc_content');
  });
});

describe('StencilSetLoader', () => {
  const file = {
    templates: [{ id: 'my.t', data: ['0'], draw: ['M 0 1'], help: 'Help!' }],
    library: [{ id: 'my.cat', name: 'Mine', group: 'G', category: 'C', objects: ['my.t'] }],
  };

  it('plans local first where the host has files; no credentials for the stencil host', () => {
    const cat = { contentUrl: `${StencilSource.baseUrl}uml.json`, isCustomLib: false };
    expect(StencilSetLoader.plan(cat, true)).toEqual({
      localPath: 'stencils/v5/uml.json',
      url: cat.contentUrl,
      authenticated: false,
    });
    expect(StencilSetLoader.plan(cat, false).localPath).toBeNull();
    expect(
      StencilSetLoader.plan({ contentUrl: 'https://api.lekh.app/v2/library/abc/content', isCustomLib: true }, true)
        .authenticated,
    ).toBe(true);
  });

  it('parses into the session overlay only', () => {
    const a = testIo();
    const b = testIo();
    const categs = StencilSetLoader.load(JSON.stringify(file), a.overlay);
    expect(categs.map((c) => c.id)).toEqual(['my.cat']);
    expect(a.overlay.get('my.t')).toBeDefined();
    expect(a.overlay.help('my.t')).toBe('Help!');
    expect(b.overlay.get('my.t')).toBeUndefined();
  });

  it("runs the overlay's resolve hook on every template", () => {
    const seen: string[] = [];
    const resolve: GeneratorResolveFn = (json) => {
      seen.push(typeof json['id'] === 'string' ? json['id'] : '');
      return { json, generator: null, converted: false };
    };
    const overlay = new CatalogOverlay(bundledCatalog(), { resolve });
    StencilSetLoader.loadValue(file, overlay);
    expect(seen).toEqual(['my.t']);
  });

  it('a file that is not an object fails', () => {
    expect(() => StencilSetLoader.parse('[1, 2]')).toThrow(LoadError);
    expect(() => StencilSetLoader.parse('{')).toThrow(LoadError);
  });
});

describe('LibraryItemCodec (spec 04 §11)', () => {
  const item: JsonObject = {
    type: 'templated',
    name: 'Box',
    params: { cx: 0, cy: 0, width: 40, height: 20, angle: 0 },
    template: {
      id: 'my.box',
      data: ['-w/2', '-h/2', 'w/2', 'h/2'],
      draw: ['M 0 1 L 2 3'],
      generator: { script: 'lua' },
    },
  };

  it('reads an item, converting Lua in memory, and never changes what it read', () => {
    const resolve: GeneratorResolveFn = (json) => {
      const gen = json['generator'] as JsonObject | undefined;
      if (gen === undefined) return { json, generator: null, converted: false };
      return {
        json: { ...json, generator: { script: '/*lekh-js:1:x*/' } },
        generator: { kind: 'js', key: 'x' },
        converted: true,
      };
    };
    const io = testIo({ generators: { resolve } });
    const lib = new LibraryItemCodec(io.codec);
    const before = JSON.stringify(item);
    const read = lib.readItem(item);
    expect(read.convertedLua).toBe(true);
    expect(read.object).toBeInstanceOf(TemplatedObject);
    expect(JSON.stringify(item)).toBe(before);
    // Saved by TS: JS generator, no version added.
    const saved = lib.writeItem(read.object);
    expect((saved['template'] as JsonObject)['generator']).toEqual({ script: '/*lekh-js:1:x*/' });
    expect(saved['info']).toBeUndefined();
  });
});
