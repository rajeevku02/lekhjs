// The template and style codecs (spec 02 `TemplateDataCodec`): the C++ `parseShapeTemplate` /
// `serializeShapeTemplate` contracts, the resolve hook on every template parsed, the default
// generators (generators/' converter), and the style read/write rules ported as is.
import { describe, expect, it } from 'vitest';
import { StoredNativeGenerator, UnknownGeneratorPlaceholder, WireframeGenerator } from '../../src/generators';
import {
  parsePaint,
  parseStyle,
  parseStyleOrDrawingProfile,
  parseTemplateParams,
  serializePaint,
  serializeStyle,
  serializeTemplateParams,
} from '../../src/io';
import type { TemplatedObject } from '../../src/model';
import { Color, GradientSpread, Paint, PaintType, Style } from '../../src/style';
import {
  ParamEditorType,
  PolygonTemplate,
  TextSide,
  type GeneratorResolveFn,
  type JsonObject,
} from '../../src/template';
import { testIo } from './helpers';

const body = (extra: Record<string, unknown> = {}): JsonObject => ({
  id: 'test.shape',
  data: ['-w/2', '-h/2', 'w/2', 'h/2', '0'],
  draw: ['M 0 1 L 2 3'],
  ...extra,
});

describe('TemplateDataCodec.parse', () => {
  it('needs a string id; a reference body is the catalog template', () => {
    const c = testIo().codec.templates;
    expect(c.parse({ data: [] })).toBeNull();
    expect(c.parse('x')).toBeNull();
    expect(c.parse({ id: 'nope.nothing' })).toBeNull();
    const ref = c.parse({ id: 'avabodh.basic.text' });
    expect(ref?.id()).toBe('avabodh.basic.text');
    expect(ref?.texts()).toHaveLength(1);
  });

  it('picks the class by id or the polygon flag', () => {
    const c = testIo().codec.templates;
    expect(c.parse(body({ polygon: true }))).toBeInstanceOf(PolygonTemplate);
    expect(c.parse(body({ id: 'avabodh.basic.polygon' }))).toBeInstanceOf(PolygonTemplate);
    expect(c.parse(body())).not.toBeInstanceOf(PolygonTemplate);
  });

  it('texts: a malformed condition skips the entry; only the first valid side is the title', () => {
    const t = testIo().codec.templates.parse(
      body({
        texts: [
          { location: '0 1 2 3 4', text: 'a', condition: { variable: 'v', op: '', value: 1 } },
          { location: '0 1 2 3 4', text: 'b', row: 2.0, col: -1 },
          { external: 'left', text: 'T1' },
          { external: 'right', location: '', text: 'T2' },
          { location: '', text: 'no location' },
        ],
      }),
    );
    expect(t?.textData.map((x) => x.text)).toEqual(['b', 'T1']);
    expect(t?.textData[0]?.row).toBe(2);
    expect(t?.textData[1]?.external).toBe(TextSide.Left);
    expect(t?.titleIndex()).toBe(1);
  });

  it('string forms of texts and images; draw entries as strings or objects', () => {
    const t = testIo().codec.templates.parse(
      body({
        texts: 'default',
        images: '0 1 2 3 4',
        draw: ['M 0 1', '', { path: 'L 2 3', style: { strokewidth: 5 } }, { path: '' }, 7],
      }),
    );
    expect(t?.textData.map((x) => x.location)).toEqual(['default']);
    expect(t?.imageData.map((x) => x.location)).toEqual(['0 1 2 3 4']);
    expect(t?.pathData.map((p) => p.drawCmds)).toEqual(['M 0 1', 'L 2 3']);
    expect(t?.pathData[1]?.style.effectiveStrokeWidth()).toBe(5);
  });

  it('params: sorted by order when every object-form param has one', () => {
    const sorted = parseTemplateParams({
      b: { value: 2, order: 1, display: 'B', editor: { type: 1, min: 0, max: 9 } },
      a: { value: 'x', order: 2, editor: { type: 4, options: ['x', 'y', 3] } },
      c: true,
    });
    expect(sorted.map((p) => p.name)).toEqual(['c', 'b', 'a']);
    const unsorted = parseTemplateParams({ b: { value: 2, order: 1 }, a: { value: 1 } });
    expect(unsorted.map((p) => p.name)).toEqual(['a', 'b']);
    const out = serializeTemplateParams(sorted);
    expect(out).toEqual({
      c: true,
      b: { value: 2, display: 'B', order: 1, editor: { type: ParamEditorType.IntMinMax, min: 0, max: 9 } },
      a: { value: 'x', display: '', order: 2, editor: { type: ParamEditorType.EnumString, options: ['x', 'y'] } },
    });
  });

  it('runs the resolve hook on every body it parses, and counts conversions', () => {
    const seen: string[] = [];
    const resolve: GeneratorResolveFn = (json) => {
      seen.push(typeof json['id'] === 'string' ? json['id'] : '');
      return { json, generator: null, converted: json['id'] === 'lua.one' };
    };
    const io = testIo({ generators: { resolve } });
    const stats = { converted: 0 };
    io.codec.templates.parse(body({ id: 'lua.one' }), stats);
    io.codec.templates.parse(body({ id: 'plain' }), stats);
    expect(seen).toEqual(['lua.one', 'plain']);
    expect(stats.converted).toBe(1);
  });

  it('a native generator not yet ported draws its stored members and writes back verbatim', () => {
    const gen = { type: 'native', shape: 'bpmn.event', text: 'x', interprettext: true, embedrefs: ['b', 'a', 'a'] };
    const io = testIo();
    const t = io.codec.templates.parse(body({ generator: gen, texts: [{ location: '0 1 2 3 4', text: 'kept' }] }));
    const g = t?.generator;
    expect(g).toBeInstanceOf(StoredNativeGenerator);
    expect(g?.behavior).toBe('onParamChange');
    expect(g?.interpretText()).toBe(true);
    expect(g?.embedReferences()).toEqual(['a', 'b']);
    if (t === null) throw new Error('no template');
    const out = io.codec.templates.serialize(t);
    expect(out['generator']).toEqual(gen);
    // A native generator's generated parts are written; a script generator's are not.
    expect(out['texts']).toBeDefined();
    const lua = io.codec.templates.parse(
      body({ id: 'avabodh.wireframe.button', generator: { script: 'x' }, texts: [{ location: '0', text: 't' }] }),
    );
    if (lua === null) throw new Error('no template');
    expect(lua.generator).toBeInstanceOf(WireframeGenerator);
    const luaOut = io.codec.templates.serialize(lua);
    expect(luaOut['texts']).toBeUndefined();
    expect(luaOut['draw']).toBeUndefined();
    expect(luaOut['data']).toBeDefined();
  });

  it('a script under an unknown id is a placeholder that writes the body back as read', () => {
    const io = testIo();
    const json = body({ generator: { script: 'x' }, texts: [{ location: '0', text: 't' }] });
    const t = io.codec.templates.parse(json);
    expect(t?.generator).toBeInstanceOf(UnknownGeneratorPlaceholder);
    if (t === null) throw new Error('no template');
    expect(io.codec.templates.serialize(t)).toEqual(json);
  });

  it('a build hook returning null drops the generator (C++ dropped an unknown one)', () => {
    const io = testIo({ generators: { build: () => null } });
    expect(io.codec.templates.parse(body({ generator: { type: 'weird' } }))?.generator).toBeNull();
  });
});

describe('TemplateDataCodec.serialize', () => {
  it('writes what C++ wrote and nothing it did not (name, help, aliases, libraryview, inheritstyle)', () => {
    const io = testIo();
    const t = io.codec.templates.parse(
      body({
        name: 'N',
        help: 'H',
        aliases: 'A',
        libraryview: { width: 3 },
        bound: 'B',
        no_fill: '1',
        editable_vertices: '0 1',
        alignpoints: '0 1',
        pointattrs: ['p'],
        containers: ['c', 3],
        embeds: [
          { name: 'e', location: '0 1 2 3 4', inheritstyle: false, condition: { variable: 'v', op: '==', value: 'x' } },
        ],
        default: { width: 7, height: 8, angle: 0.5 },
        primitive_for_distance: true,
      }),
    );
    if (t === null) throw new Error('no template');
    const out = io.codec.templates.serialize(t);
    expect(Object.keys(out).sort()).toEqual(
      [
        'alignpoints',
        'bound',
        'containers',
        'data',
        'default',
        'draw',
        'editable_vertices',
        'embeds',
        'flags',
        'id',
        'no_fill',
        'pointattrs',
      ].sort(),
    );
    expect(out['embeds']).toEqual([
      { name: 'e', location: '0 1 2 3 4', condition: { variable: 'v', op: '==', value: 'x' } },
    ]);
    expect(out['containers']).toEqual(['c']);
    expect(out['flags']).toBe(1);
    expect(out['default']).toEqual({ width: 7, height: 8, angle: 0.5 });
  });

  it('inlines a referenced image only through the hook', () => {
    const io = testIo();
    const t = io.codec.templates.parse(
      body({ images: [{ location: '0 1 2 3 4', src: 'res://a.png', format: 'png' }] }),
    );
    if (t === null) throw new Error('no template');
    expect((io.codec.templates.serialize(t)['images'] as JsonObject[])[0]?.['data']).toBe('');
    const inlined = io.codec.templates.serialize(t, {
      inlineImage: (src) => (src === 'res://a.png' ? 'AAAA' : undefined),
    });
    expect((inlined['images'] as JsonObject[])[0]?.['data']).toBe('AAAA');
  });
});

describe('style codec', () => {
  it('paints: solid, gradients (radial written with the linear spread, as C++), pattern → default', () => {
    const solid = parsePaint({ type: 2, color: -16776961, fillrule: 2 });
    expect([solid.type, solid.solidColor.toInt(), solid.fillRule]).toEqual([PaintType.Solid, -16776961, 2]);
    const noColor = parsePaint({ type: 2 });
    expect(noColor.type).toBe(PaintType.Solid);
    const pattern = parsePaint({ type: 5, color: 1 });
    expect(pattern.type).toBe(PaintType.Default);
    const radial = new Paint({ type: PaintType.RadialGradient }).with({
      radialGradient: {
        cx: 1,
        cy: 2,
        r: 3,
        fx: 4,
        fy: 5,
        fr: 6,
        stops: [{ offset: 0.5, color: new Color(1, 2, 3) }],
        spread: GradientSpread.Reflect,
      },
    });
    expect((serializePaint(radial)['radialgradient'] as JsonObject)['spread']).toBe(GradientSpread.Default);
    const back = parsePaint(serializePaint(radial));
    expect(back.radialGradient.stops[0]?.offset).toBe(0.5);
    expect(serializePaint(Paint.solid(new Color(1, 2, 3)))).toEqual({ type: 2, color: new Color(1, 2, 3).toInt() });
  });

  it('parseStyle sets or removes every attribute; dash entries and phase are truncated', () => {
    const s = new Style();
    s.setFontSize(30);
    expect(
      parseStyle(s, {
        strokewidth: 3,
        dasharray: [4.7, 2.2, 1, 1, 9],
        dashpatternphase: 2.8,
        disabled: false,
        nonoverridables: ['fontSize'],
      }),
    ).toBe(true);
    expect(s.isFontSizeDefined()).toBe(false);
    expect(s.effectiveDashArray()).toEqual([4, 2, 1, 1]);
    expect(s.effectiveDashPatternPhase()).toBe(2);
    expect(s.isDisabledDefined()).toBe(true);
    expect(serializeStyle(s)).toEqual({
      strokewidth: 3,
      disabled: false,
      dasharray: [4, 2, 1, 1],
      dashpatternphase: 2,
      nonoverridables: ['fontSize'],
    });
    expect(parseStyle(new Style(), { dasharray: [1, 'x'] })).toBe(false);
    expect(parseStyle(new Style(), { nonoverridables: 'x' })).toBe(false);
  });

  it('the old drawing-profile form', () => {
    const s = new Style();
    expect(
      parseStyleOrDrawingProfile(
        {
          drawingprofile: {
            width: 2.5,
            color: -65536,
            font: { size: 20, color: -16711936, family: 'Arial', modifiers: 'b' },
            dash: { phase: 1, pattern: [3, 4] },
          },
        },
        s,
      ),
    ).toBe(true);
    expect(s.effectiveStrokeWidth()).toBe(2.5);
    expect(s.effectiveStrokePaint().solidColor.toInt()).toBe(-65536);
    expect(s.effectiveFillPaint().type).toBe(PaintType.NoPaint);
    expect(s.effectiveFontSize()).toBe(20);
    expect(s.effectiveTextFill().solidColor.toInt()).toBe(-16711936);
    expect(s.effectiveDashArray()).toEqual([3, 4]);
    // `curdrawingprofile` wins over `drawingprofile`, which wins over `style`.
    const t = new Style();
    parseStyleOrDrawingProfile(
      { curdrawingprofile: { width: 9 }, drawingprofile: { width: 8 }, style: { strokewidth: 7 } },
      t,
    );
    expect(t.effectiveStrokeWidth()).toBe(9);
  });

  it("an object-level style is read into a templated object's template style", () => {
    const io = testIo();
    const { object } = io.codec.readObject({
      type: 'templated',
      params: { cx: 0, cy: 0, width: 10, height: 10, angle: 0 },
      template: body(),
      style: { strokewidth: 6 },
    });
    expect((object as TemplatedObject).shapeTemplate()?.getStyle().effectiveStrokeWidth()).toBe(6);
  });
});
