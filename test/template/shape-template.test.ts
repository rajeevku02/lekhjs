// ShapeTemplate and its subclasses: load order, generateData, titles, embeds, point attributes,
// vertex editing, the layout/paint split (AC-GEN-07), DR-GEN-01, and the C++ draw strings.
import { describe, expect, it } from 'vitest';
import { BezierCurve, PathComponent, Point, PointType, Rect, SimplePath } from '../../src/geometry';
import { STYLE_DEFAULTS, TextAlignHorizontal } from '../../src/style';
import {
  DataStore,
  EmbedInfo,
  ImageInfo,
  PathInfo,
  PathTemplate,
  PolygonTemplate,
  ShapeGenerator,
  ShapeTemplate,
  TemplateParam,
  TextInfo,
  TextSide,
  TextTemplate,
  BezierCurveTemplate,
  type EmbeddedShapeSource,
  type GeneratorBehavior,
  type GeneratorContext,
  type GeneratorJson,
  type InterestingPoint,
  type TemplateEnv,
} from '../../src/template';
import { LogPlatform, testEnv } from './helpers';

const LINE = 1.18 * STYLE_DEFAULTS.fontSize;

function rectTemplate(env: TemplateEnv): ShapeTemplate {
  const t = new ShapeTemplate(env);
  t.templateId = 'test.rect';
  t.dataExpStrs = ['-w/2', '-h/2', 'w/2', '-h/2', 'w/2', 'h/2', '-w/2', 'h/2', '0', '0', 'w', 'h', '0'];
  t.pathData.push(new PathInfo('M 0 1 L 2 3 L 4 5 L 6 7 Z'));
  const ti = new TextInfo();
  ti.location = '8 9 10 11 12';
  ti.text = 'Hello';
  t.textData.push(ti);
  return t;
}

function box(x: number, y: number, w: number, h: number, angle = 0): DataStore {
  const d = new DataStore();
  d.setRect(new Rect(x, y, w, h));
  d.setAngle(angle);
  return d;
}

class FakeGenerator extends ShapeGenerator {
  readonly behavior: GeneratorBehavior;
  calls = 0;
  text = '';
  private readonly interprets: boolean;

  constructor(behavior: GeneratorBehavior = 'generateAlways', interprets = false) {
    super();
    this.behavior = behavior;
    this.interprets = interprets;
  }
  interpretText(): boolean {
    return this.interprets;
  }
  interpretedText(): string {
    return this.text;
  }
  override setInterpretedText(text: string): void {
    this.text = text;
  }
  embedReferences(): readonly string[] {
    return [];
  }
  generate(t: ShapeTemplate, ctx: GeneratorContext): void {
    this.calls++;
    t.clearTemplateData();
    const w = ctx.textSize(this.text).w;
    t.dataExpStrs = ['-w/2', '0', 'w/2', '0', String(w)];
    t.pathData.push(new PathInfo('M 0 1 L 2 3'));
  }
  setDimension(ds: DataStore): void {
    if (ds.width() < 30) ds.setWidth(30);
  }
  clone(): FakeGenerator {
    const g = new FakeGenerator(this.behavior, this.interprets);
    g.text = this.text;
    return g;
  }
  toJSON(): GeneratorJson {
    return { script: '/*lekh-js:1:test*/', text: this.text };
  }
}

describe('load and generateData', () => {
  it('evaluates data, moves vertex points to the box and paints the path and text', () => {
    const env = testEnv();
    const t = rectTemplate(env);
    t.load();
    expect(t.paths()).toHaveLength(1);
    expect(t.texts()).toHaveLength(1);
    expect(t.texts()[0]?.isDefaultText()).toBe(true);
    const d = box(0, 0, 100, 50);
    t.generateData(d);
    expect(d.values.slice(0, 10)).toEqual([0, 0, 100, 0, 100, 50, 0, 50, 50, 25]);
    expect(d.values.slice(10)).toEqual([100, 50, 0]);
    expect(t.vertices(d)).toHaveLength(5);

    const dp = new LogPlatform();
    expect(t.isLaidOut()).toBe(false);
    t.draw(dp, d);
    expect(t.isLaidOut()).toBe(true);
    expect(dp.log).toEqual(['start 0 0', 'M 0 0', 'L 100 0', 'L 100 50', 'L 0 50', 'Z', 'end', 'text Hello']);
    const laid = dp.texts[0];
    expect(laid?.width).toBe(50);
    expect(laid?.box.center()).toEqual(new Point(50, 25));
    expect(laid?.box.height).toBeCloseTo(LINE, 9);
  });

  it('rotates vertex points about the centre', () => {
    const t = rectTemplate(testEnv());
    t.load();
    const d = box(0, 0, 100, 50, Math.PI / 2);
    t.generateData(d);
    expect(d.value(0)).toBeCloseTo(75, 9);
    expect(d.value(1)).toBeCloseTo(-25, 9);
  });

  it('evaluates in order: d(j) of a later index reads 0', () => {
    const t = new ShapeTemplate(testEnv());
    t.dataExpStrs = ['d(1) + 1', '5', 'd(1) * 2'];
    t.load();
    const d = box(0, 0, 10, 10);
    t.generateData(d);
    expect(d.values).toEqual([1, 5, 10]);
  });

  it('an unparsable expression evaluates to 0 and warns once per template (DR-GEN-01)', () => {
    const env = testEnv();
    const t = new ShapeTemplate(env);
    t.templateId = 'test.bad';
    t.dataExpStrs = ['w', 'w*-0.5', 'h'];
    t.load();
    t.load();
    const d = box(0, 0, 10, 20);
    t.generateData(d);
    expect(d.values).toEqual([10, 0, 20]);
    expect(env.warnings).toEqual([{ code: 'expression_invalid', details: { templateId: 'test.bad', index: 1 } }]);
  });

  it('no-fill paths lose their fill and keep it from the group style', () => {
    const t = rectTemplate(testEnv());
    t.noFillPathStr = '0';
    t.load();
    const st = t.paths()[0]?.style();
    expect(st?.fill()).toBe(false);
    expect(st?.nonOverridables().has('fillPaint')).toBe(true);
    expect(st?.parent()).toBe(t.getStyle());
  });

  it('builds the bound path, containers and align points', () => {
    const t = rectTemplate(testEnv());
    t.boundPathStr = 'M 0 1 L 2 3';
    t.containerPaths = ['M 0 1 L 2 3 L 4 5 L 6 7 Z'];
    t.alignPointsStr = '2 3';
    t.load();
    expect(t.boundPath()?.shapes()).toHaveLength(2);
    expect(t.boundPath()?.drawCmdStr()).toBe('');
    const d = box(0, 0, 100, 50);
    t.generateData(d);
    expect(t.getAlignPoints(d)).toEqual([new Point(100, 0)]);
    expect(t.isPointInsideContainer(new Point(50, 25), d)).toBe(true);
    expect(t.isPointInsideContainer(new Point(150, 25), d)).toBe(false);
    expect(t.isRectInsideContainer(new Rect(0, 0, 100, 50), d)).toBe(true);
    expect(t.isRectInsideContainer(new Rect(0, 0, 120, 50), d)).toBe(false);
  });

  it('setDataExpressions recompiles and keeps the title layout', () => {
    const t = rectTemplate(testEnv());
    const title = new TextInfo();
    title.text = 'T';
    title.external = TextSide.Bottom;
    t.textData.push(title);
    t.load();
    expect(t.expressionCount()).toBe(13 + 5);
    t.setDataExpressions(t.dataExprs().slice());
    expect(t.expressionCount()).toBe(13 + 5);
  });
});

describe('titles', () => {
  it('lays a bottom title out under the shape, centred, at the title gap', () => {
    const t = rectTemplate(testEnv());
    const title = new TextInfo();
    title.text = 'Title';
    title.external = TextSide.Bottom;
    t.textData.push(title);
    t.load();
    expect(t.titleIndex()).toBe(1);
    expect(t.titleSide()).toBe(TextSide.Bottom);
    expect(t.titleElement()?.floating()).toBe(true);
    const d = box(0, 0, 100, 50);
    t.generateData(d);
    const n = 13;
    expect(d.value(n)).toBeCloseTo(50, 9);
    expect(d.value(n + 1)).toBeCloseTo(25 + 25 + 8 + LINE / 2, 9);
    expect(d.value(n + 2)).toBeCloseTo(50 + 8, 9);
    // The title text centre is a floating point, not a vertex.
    expect(t.vertices(d)).toHaveLength(5);
  });

  it('a title with no alignment set aligns toward the shape', () => {
    const t = rectTemplate(testEnv());
    const title = new TextInfo();
    title.text = 'L';
    title.external = TextSide.Left;
    t.textData.push(title);
    t.load();
    expect(t.titleElement()?.paintStyle()?.effectiveTextAlignHorizontal()).toBe(TextAlignHorizontal.Right);
  });

  it('a regenerating or text-interpreting generator has no title', () => {
    const t = rectTemplate(testEnv());
    const title = new TextInfo();
    title.external = TextSide.Top;
    t.textData.push(title);
    t.generator = new FakeGenerator('onParamChange');
    expect(t.titleIndex()).toBe(1);
    t.generator = new FakeGenerator('generateAlways');
    expect(t.titleIndex()).toBe(-1);
    t.generator = new FakeGenerator('onParamChange', true);
    expect(t.titleIndex()).toBe(-1);
  });
});

describe('generators', () => {
  it('generate runs only from load: 100 layout+paint passes make no call (AC-GEN-07)', () => {
    const t = new ShapeTemplate(testEnv());
    const g = new FakeGenerator('generateAlways', true);
    g.text = 'abc';
    t.generator = g;
    t.load();
    expect(g.calls).toBe(1);
    const d = box(0, 0, 10, 10);
    t.generateData(d);
    // setDimension ran first: the minimum width applies before evaluation.
    expect(d.width()).toBe(30);
    expect(d.value(4)).toBe(30);
    const dp = new LogPlatform();
    for (let i = 0; i < 100; i++) {
      t.layout(d);
      t.paint(dp, d);
    }
    expect(g.calls).toBe(1);
    t.setInterpretedText('abcdef');
    expect(g.calls).toBe(2);
    expect(t.interpretedText()).toBe('abcdef');
  });

  it('while its text is edited, a text-interpreting shape paints a white box', () => {
    const t = new ShapeTemplate(testEnv());
    t.generator = new FakeGenerator('generateAlways', true);
    t.load();
    const d = box(0, 0, 40, 20);
    t.generateData(d);
    const dp = new LogPlatform();
    t.draw(dp, d, 0);
    expect(dp.log).toEqual(['start 0 0', 'L 0 20', 'L 40 20', 'L 40 0', 'Z', 'end']);
    expect(dp.styles[0]?.effectiveFillPaint().solidColor.red).toBe(255);
  });

  it('clone clones the generator', () => {
    const t = new ShapeTemplate(testEnv());
    const g = new FakeGenerator();
    g.text = 'x';
    t.generator = g;
    const c = t.clone();
    expect(c.generator).not.toBe(g);
    expect(c.interpretedText()).toBe('x');
  });
});

describe('embeds', () => {
  it('resolves through the env, places and paints the embedded template', () => {
    const inner = (env: TemplateEnv) => {
      const t = ShapeTemplate.fromDataAndDraw(env, ['-w/2', '-h/2', 'w/2', 'h/2'], 'M 0 1 L 2 3');
      t.load();
      return t;
    };
    const asked: string[] = [];
    const env: TemplateEnv = testEnv({
      resolver: {
        getEmbed: (id): EmbeddedShapeSource | null => {
          asked.push(id);
          return id === 'icon' ? { template: inner(env), rect: Rect.fromCenter(new Point(), 20, 10), angle: 0 } : null;
        },
        getTemplate: () => null,
      },
    });
    const t = new ShapeTemplate(env);
    t.dataExpStrs = ['10', '0', '40', '40', '0'];
    t.params.push(Object.assign(new TemplateParam(), { name: 'icon', value: 'icon' }));
    t.embedData.push(new EmbedInfo('', 'icon', '0 1 2 3 4', 'aspect', false, null));
    t.embedData.push(new EmbedInfo('missing', '', '0 1 2 3 4', '', false, null));
    t.load();
    expect(asked).toEqual(['icon', 'missing']);
    expect(t.embeds()).toHaveLength(1);
    const e = t.embeds()[0];
    expect(e?.origWidth).toBe(20);
    const d = box(0, 0, 100, 100);
    t.generateData(d);
    // The embed centre is a vertex point: (10, 0) + centre (50, 50); aspect 2 keeps 40 wide, 20 high.
    expect([e?.ds.cx(), e?.ds.cy(), e?.ds.width(), e?.ds.height()]).toEqual([60, 50, 40, 20]);
    const dp = new LogPlatform();
    t.draw(dp, d);
    expect(dp.log).toEqual(['start 0 0', 'M 40 40', 'L 80 60', 'end']);
  });
});

describe('vertex editing', () => {
  it('a point attribute moves within its box and sets its parameter', () => {
    const t = new ShapeTemplate(testEnv());
    t.dataExpStrs = ['-w/2', '-h/2', 'r', '0', '-w/2', 'w/2', '-h/2', 'h/2', 'd(2)'];
    t.params.push(Object.assign(new TemplateParam(), { name: 'r', value: 10 }));
    t.pathData.push(new PathInfo('M 0 1'));
    t.pointAttrStrs = ['2 3 4 5 6 7 r 8'];
    t.load();
    expect(t.pointAttributes()).toHaveLength(1);
    const d = box(0, 0, 100, 50);
    t.generateData(d);
    const out = t.moveVertexTo(0, new Point(80, 30), d);
    expect(t.params[0]?.value).toBe(80);
    expect(out).toEqual(new Point(80, 0));
    // Outside the box: clamped to the nearest edge.
    t.moveVertexTo(0, new Point(500, 30), d);
    expect(t.params[0]?.value).toBe(100);
    const pts: InterestingPoint[] = [];
    t.getInterestingPoints(d, pts);
    expect(pts.map((p) => p.type)).toEqual([PointType.Attr, PointType.Center]);
  });

  it('an editable vertex becomes fractions of the saved box', () => {
    const t = rectTemplate(testEnv());
    t.editableVerticesStr = '0 1';
    t.load();
    const d = box(0, 0, 100, 50);
    t.generateData(d);
    d.save();
    expect(t.moveVertexTo(0, new Point(10, 5), d)).toEqual(new Point(10, 5));
    expect(t.dataExprs().slice(0, 2)).toEqual(['-0.4*w', '-0.4*h']);
    expect([d.value(0), d.value(1)]).toEqual([10, 5]);
  });

  it('afterVertexEditing refits the box around the vertices', () => {
    const t = rectTemplate(testEnv());
    t.load();
    const d = box(0, 0, 100, 50);
    t.generateData(d);
    d.values[2] = 200;
    d.values[4] = 200;
    t.afterVertexEditing(d);
    expect(d.rect()).toEqual(new Rect(0, 0, 200, 50));
    expect(t.dataExprs().slice(0, 4)).toEqual(['-0.5*w', '-0.5*h', '0.5*w', '-0.5*h']);
  });
});

describe('images and text slots', () => {
  it('paints an image from the env, or a placeholder box', () => {
    const t = new ShapeTemplate(testEnv());
    t.dataExpStrs = ['0', '0', 'w', 'h', '0'];
    const ii = new ImageInfo();
    ii.location = '0 1 2 3 4';
    ii.src = 'res://a.png';
    t.imageData.push(ii);
    t.load();
    const d = box(0, 0, 40, 20);
    t.generateData(d);
    const dp = new LogPlatform();
    t.draw(dp, d);
    expect(dp.log[0]).toBe('start 0 0');
    expect(dp.styles[0]?.effectiveFillPaint().solidColor.alpha).toBe(251);

    const img = { width: 1, height: 1, source: null };
    const t2 = t.clone();
    const env2 = testEnv({ images: new Map([['res://a.png', img]]) });
    const t3 = new ShapeTemplate(env2);
    t3.copyFrom(t2);
    t3.load();
    t3.generateData(d);
    const dp2 = new LogPlatform();
    t3.draw(dp2, d);
    expect(dp2.log).toEqual(['image 20 10 40 20 0 true']);
  });

  it('setText and setImageData update data and element', () => {
    const t = rectTemplate(testEnv());
    const ii = new ImageInfo();
    ii.location = '8 9 10 11 12';
    t.imageData.push(ii);
    t.load();
    t.setText(0, 'Bye');
    expect(t.textData[0]?.text).toBe('Bye');
    expect(t.texts()[0]?.text()).toBe('Bye');
    t.setText(5, 'x');
    t.setImageData(0, 'QUJD', 'png');
    expect(t.images()[0]?.imageKey()).toBe('data:image/png;base64,QUJD');
  });
});

describe('PolygonTemplate', () => {
  const tri = [new Point(0, 0), new Point(100, 0), new Point(50, 50)];

  it('builds the C++ data and draw strings', () => {
    const p = new PolygonTemplate(testEnv(), tri, true);
    expect(p.dataExprs()).toEqual(['-0.5*w', '-0.5*h', '0.5*w', '-0.5*h', '0*w', '0.5*h']);
    expect(p.pathData[0]?.drawCmds).toBe('M  0 1 L  2 3 L  4 5 L 0 1');
    expect(p.textInCentroid).toBe(true);
    expect(p.usePathForDistance()).toBe(true);
    expect(p.boundPath()).not.toBeNull();
    expect(p.isLine()).toBe(false);
    const d = box(0, 0, 100, 50);
    p.generateData(d);
    const pts: InterestingPoint[] = [];
    p.getInterestingPoints(d, pts);
    expect(pts.map((x) => x.type)).toEqual([PointType.Vertex, PointType.Vertex, PointType.Vertex, PointType.Center]);
    expect(p.texts()[0]?.center(d)).toEqual(new Point(50, 50 / 3));
  });

  it('a line: height-1 box along it, with its angle, and arrow locations', () => {
    const { template, bound, angle } = PolygonTemplate.getPolygonTemplate(
      testEnv(),
      [new Point(0, 0), new Point(30, 40)],
      false,
      false,
    );
    expect(bound.width).toBe(50);
    expect(bound.height).toBe(1);
    expect(angle).toBeCloseTo(Math.atan2(40, 30), 12);
    expect(template.isLine()).toBe(true);
    const d = new DataStore();
    d.setRect(bound);
    d.setAngle(angle);
    template.generateData(d);
    expect(d.arrowLocations).toHaveLength(2);
  });

  it('makeRect: sharp and rounded', () => {
    const p = new PolygonTemplate(testEnv(), tri, true);
    p.makeRect(false);
    expect(p.pathData[0]?.drawCmds).toBe('M 0 1 L 2 3 L 4 5 L 6 7 L 0 1');
    expect(p.texts()).toHaveLength(1);
    p.makeRect(true);
    expect(p.isRounded()).toBe(true);
    expect(p.usePathForInsideCheck()).toBe(false);
    const d = box(0, 0, 100, 50);
    p.generateData(d);
    const dp = new LogPlatform();
    p.draw(dp, d);
    expect(dp.log.filter((l) => l.startsWith('C'))).toHaveLength(4);
    expect(p.canFlip()).toBe(false);
  });

  it('flip mirrors the vertices', () => {
    const p = new PolygonTemplate(testEnv(), tri, true);
    const d = box(0, 0, 100, 50);
    p.generateData(d);
    p.flip(2, d);
    // About the vertices' mean (y = 50/3): 0 → 100/3, 50 → -50/3.
    const got = p.vertices(d).map((v) => [v.x, v.y]);
    const want = [
      [0, 100 / 3],
      [100, 100 / 3],
      [50, -50 / 3],
    ];
    got.forEach((g, i) => {
      expect(g[0]).toBeCloseTo(want[i]?.[0] ?? NaN, 9);
      expect(g[1]).toBeCloseTo(want[i]?.[1] ?? NaN, 9);
    });
  });
});

describe('TextTemplate, BezierCurveTemplate, PathTemplate', () => {
  it('a text template is sized by its text plus textObjectBoundsAdjust', () => {
    const t = new TextTemplate(testEnv());
    t.load();
    t.setText(0, 'abcd');
    const d = box(0, 0, 1, 1);
    t.generateData(d);
    expect(d.width()).toBe(40 + 8);
    expect(d.height()).toBeCloseTo(LINE + 8, 9);
    expect(t.texts()[0]?.floating()).toBe(true);
  });

  it('a curve template draws M + C and reports vertex/control points', () => {
    const bz = new BezierCurve(new Point(0, 0), new Point(0, 100), new Point(100, 100), new Point(100, 0));
    const c = new BezierCurveTemplate(testEnv(), bz, new Rect(0, 0, 100, 100));
    expect(c.dataExprs()).toEqual(['-0.5*w', '-0.5*h', '-0.5*w', '0.5*h', '0.5*w', '0.5*h', '0.5*w', '-0.5*h']);
    const d = box(0, 0, 100, 100);
    c.generateData(d);
    const dp = new LogPlatform();
    c.draw(dp, d);
    expect(dp.log).toEqual(['start 0 0', 'M 0 0', 'C 0 100 100 100 100 0', 'end']);
    const pts: InterestingPoint[] = [];
    c.getInterestingPoints(d, pts);
    expect(pts.map((p) => p.type)).toEqual([PointType.Vertex, PointType.Control, PointType.Control, PointType.Vertex]);
    expect(c.canFlip()).toBe(true);
  });

  it('a path template round-trips its parts', () => {
    const sp = new SimplePath();
    sp.push(PathComponent.line(new Point(0, 0), new Point(100, 0)));
    sp.push(
      PathComponent.ofCurve(
        new BezierCurve(new Point(100, 0), new Point(100, 50), new Point(50, 50), new Point(0, 50)),
      ),
    );
    const { template, bound } = PathTemplate.from(testEnv(), sp);
    expect(template.pathData[0]?.drawCmds).toBe('M 0 1 L 2 3 C 4 5 6 7 8 9');
    template.load();
    const d = new DataStore();
    d.setRect(bound);
    template.generateData(d);
    const parts = template.getPathParts(d);
    expect(parts.size).toBe(2);
    expect(parts.at(1).curve.point4.x).toBeCloseTo(0, 9);
    expect(d.arrowLocations[1]?.[0].x).toBeCloseTo(0, 9);
    const pts: InterestingPoint[] = [];
    template.getInterestingPoints(d, pts);
    expect(pts).toHaveLength(4);
  });
});
