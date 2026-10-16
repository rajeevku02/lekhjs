// SvgPathParser, the PrimitiveShapes and the ShapeElements: parsing, the layout/paint split,
// position points, element types, hit queries and the text box placement.
import { describe, expect, it } from 'vitest';
import { LineEquation, Point, Rect, Size } from '../../src/geometry';
import { Paint, PaintType, Style, TextAlignHorizontal, TextAlignVertical } from '../../src/style';
import {
  CloseCommand,
  DataStore,
  ElementType,
  EllipseShape,
  LineShape,
  MoveToCommand,
  ShapeImageElement,
  ShapePathElement,
  ShapeTextElement,
  SvgPathParser,
  TextSide,
  textEditRect,
  textSideFromName,
  textSideName,
  type PrimitiveShape,
} from '../../src/template';
import { LogPlatform, testEnv } from './helpers';

function ds(values: number[], w = 100, h = 50, angle = 0): DataStore {
  const d = new DataStore();
  d.setRect(new Rect(0, 0, w, h));
  d.setAngle(angle);
  d.values = values;
  return d;
}

function paintAll(shapes: readonly PrimitiveShape[], d: DataStore): string[] {
  const dp = new LogPlatform();
  for (const s of shapes) s.layout(d);
  for (const s of shapes) s.paint(dp);
  return dp.log;
}

describe('SvgPathParser', () => {
  const parse = (s: string) => new SvgPathParser().parse(s);

  it('parses every command and the relative forms', () => {
    const r = parse('M 0 1 l 2,3 H 4 v 5 C 0 1 2 3 4 5 Q 0 1 2 3 A 0 1 2 3 4 5 E 0 1 2 3 4 R 0 1 2 3 4 5 6 z');
    expect(r.ok).toBe(true);
    expect(r.shapes.map((s) => s.command).join('')).toBe('MLHVCQAERZ');
  });

  it('keeps the commands read before an error', () => {
    const r = parse('M 0 1 L 2');
    expect(r.ok).toBe(false);
    expect(r.shapes.map((s) => s.command)).toEqual(['M']);
    expect(parse('M 0 1 7').ok).toBe(false);
    expect(parse('M 0 1 L -2 3').ok).toBe(false);
  });

  it('skips an unknown letter', () => {
    const r = parse('M 0 1 X L 2 3');
    expect(r.ok).toBe(true);
    expect(r.shapes.map((s) => s.command)).toEqual(['M', 'L']);
  });
});

describe('PrimitiveShape layout and paint', () => {
  it('relative moves and lines add the previous point; H and V keep the other coordinate', () => {
    const r = new SvgPathParser().parse('M 0 1 l 2 3 H 4 v 5 Z');
    expect(paintAll(r.shapes, ds([10, 20, 5, 5, 40, 7]))).toEqual(['M 10 20', 'L 15 25', 'L 40 25', 'L 40 32', 'Z']);
  });

  it('a curve starts at the previous point; a quad is a 3-point curve', () => {
    const r = new SvgPathParser().parse('M 0 1 C 2 3 4 5 6 7 Q 0 1 2 3');
    expect(paintAll(r.shapes, ds([0, 0, 10, 0, 10, 10, 20, 10]))).toEqual([
      'M 0 0',
      'C 10 0 10 10 20 10',
      'Q 0 0 10 0',
    ]);
  });

  it('an ellipse adds the instance angle; out-of-range indices read 0', () => {
    const r = new SvgPathParser().parse('E 0 1 2 3 4');
    expect(paintAll(r.shapes, ds([5, 6, 30, 20, 0.5], 1, 1, 0.25))).toEqual(['E 5 6 30 20 0.75']);
    expect(paintAll(new SvgPathParser().parse('E 9 9 9 9 9').shapes, ds([]))).toEqual(['E 0 0 0 0 0']);
  });

  it('a rounded rect: four corner curves joined by lines, radius min(w,h)/5 when 0', () => {
    const log = paintAll(new SvgPathParser().parse('R 0 1 2 3 4 4 4').shapes, ds([50, 25, 100, 50, 0]));
    expect(log[0]).toBe('M 90 0');
    expect(log.filter((l) => l.startsWith('C'))).toHaveLength(4);
    expect(log.at(-1)).toBe('Z');
  });

  it('position points are deduplicated data pairs', () => {
    const pts: number[] = [];
    for (const s of new SvgPathParser().parse('M 0 1 L 2 3 L 0 1 C 4 5 6 7 2 3 H 8').shapes) s.getPositionPoints(pts);
    expect(pts).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('distance and intersection of a line segment', () => {
    const [m, l] = new SvgPathParser().parse('M 0 1 L 2 3').shapes;
    const d = ds([0, 0, 100, 0]);
    m?.computePoints(d);
    expect(l?.distanceFrom(new Point(50, 10), d)).toBeCloseTo(10, 9);
    const pts: { point: Point; slope: number }[] = [];
    l?.intersectionWith(LineEquation.through(new Point(50, -10), new Point(50, 10)), d, pts);
    expect(pts).toHaveLength(1);
    expect(pts[0]?.point.x).toBeCloseTo(50, 9);
  });

  it('an ellipse replaces earlier intersections (as C++)', () => {
    const e = new EllipseShape(0, 1, 2, 3, 4);
    const pts = [{ point: new Point(1, 1), slope: 0 }];
    e.intersectionWith(LineEquation.through(new Point(0, -100), new Point(0, 100)), ds([0, 0, 20, 10, 0]), pts);
    expect(pts).toHaveLength(2);
    expect(pts.every((p) => Math.abs(p.point.x) < 1e-9)).toBe(true);
    expect(e.isPointInside(new Point(9, 0), ds([0, 0, 20, 10, 0]))).toBe(true);
  });

  it('commands without a predecessor read (0, 0)', () => {
    const r = new SvgPathParser().parse('H 0');
    expect(paintAll(r.shapes, ds([7]))).toEqual(['L 7 0']);
    expect(new CloseCommand(null, true).command).toBe('Z');
    expect(new LineShape(0, 1, false, new MoveToCommand(0, 0, false, null)).command).toBe('L');
  });
});

describe('ShapePathElement', () => {
  const el = (cmd: string, style: Style | null = new Style()) => {
    const p = new ShapePathElement();
    p.setStyle(style);
    p.setDrawCmdStr(cmd);
    return p;
  };

  it('classifies its commands (C++ getType)', () => {
    expect(el('M 0 1 L 2 3 Z').elementType()).toBe(ElementType.Polygon);
    expect(el('E 0 1 2 3 4').elementType()).toBe(ElementType.Ellipse);
    expect(el('M 0 1 C 0 1 2 3 4 5').elementType()).toBe(ElementType.Bezier);
    expect(el('R 0 1 2 3 4 5 6').elementType()).toBe(ElementType.Rounded);
    expect(el('M 0 1 L 2 3 C 0 1 2 3 4 5').elementType()).toBe(ElementType.Mixed);
  });

  it('point inside a polygon and an ellipse', () => {
    const d = ds([0, 0, 100, 0, 100, 50, 0, 50]);
    const poly = el('M 0 1 L 2 3 L 4 5 L 6 7 Z');
    expect(poly.isPointInside(new Point(50, 25), d)).toBe(true);
    expect(poly.isPointInside(new Point(150, 25), d)).toBe(false);
    expect(poly.getVertexPointsForSimplePath(d)).toHaveLength(4);
    expect(el('E 0 1 2 3 4').isPointInside(new Point(0, 0), ds([0, 0, 10, 10, 0]))).toBe(true);
  });

  it('paints in one start/end with the gradient of the current box (B10)', () => {
    const st = new Style();
    st.setFillPaint(new Paint({ type: PaintType.LinearGradient }));
    const p = el('M 0 1 L 2 3', st);
    const dp = new LogPlatform();
    const d = ds([0, 0, 10, 10]);
    p.draw(dp, d, testEnv());
    expect(dp.log).toEqual(['start 0 0', 'M 0 0', 'L 10 10', 'end']);
    expect(dp.paints[0]?.fillGradient?.type).toBe('linear');
    // The style itself is not written to.
    expect(st.effectiveFillPaint().linearGradient).toBe(new Paint({ type: PaintType.LinearGradient }).linearGradient);
  });

  it('snaps the slope at a polygon join', () => {
    const p = el('M 0 1 L 2 3 L 4 5 L 0 1');
    const d = ds([0, 0, 100, 0, 100, 100]);
    const pts: { point: Point; slope: number }[] = [];
    p.intersectionWith(LineEquation.through(new Point(-10, -10), new Point(10, 10)), d, pts);
    expect(pts.length).toBeGreaterThan(0);
  });

  it('a container path has no style and paints nothing', () => {
    const p = el('M 0 1 L 2 3', null);
    const dp = new LogPlatform();
    p.draw(dp, ds([0, 0, 1, 1]), testEnv());
    expect(dp.log).toEqual([]);
  });
});

describe('ShapeBoxElement', () => {
  it('location forms: default, two indices, five indices', () => {
    const t = new ShapeTextElement();
    t.setLocationStr('default');
    expect(t.atShapeCenter()).toBe(true);
    t.setLocationStr('0 1');
    expect(t.getRectAndAngle(ds([10, 20])).rect).toEqual(new Rect(10, 20, 0, 0));
    t.setLocationStr('0 1 2 3 4');
    const ra = t.getRectAndAngle(ds([10, 20, 6, 4, 0.5], 1, 1, 0.25));
    expect(ra.rect).toEqual(new Rect(7, 18, 6, 4));
    expect(ra.angle).toBe(0.75);
    t.setLocationStr('0 1 2');
    expect(t.atShapeCenter()).toBe(true);
    const pts = [0, 1];
    t.setLocationStr('0 1 2 3 4');
    t.getPositionPoints(pts);
    expect(pts).toEqual([0, 1]);
  });

  it('point inside a rotated box', () => {
    const im = new ShapeImageElement({ cx: 0, cy: 1, w: 2, h: 3, angle: 4 });
    const d = ds([0, 0, 100, 10, Math.PI / 2]);
    expect(im.isPointInside(new Point(0, 40), d)).toBe(true);
    expect(im.isPointInside(new Point(40, 0), d)).toBe(false);
  });
});

describe('ShapeTextElement', () => {
  it('lays default text out in the shape box minus the padding', () => {
    const env = testEnv();
    const st = new Style();
    const t = new ShapeTextElement();
    t.setStyle(st);
    t.setText('one two three four');
    t.setIsDefaultText(true);
    const d = ds([], 100, 50);
    t.layout(d, env);
    const laid = t.laidOut();
    // pad = stroke/2 + alignmentPad = 1 + 2: wrap width 94 at 10 per character.
    expect(laid?.lines.map((l) => l.text)).toEqual(['one two', 'three', 'four']);
    expect(laid?.box.center().x).toBeCloseTo(50, 9);
  });

  it('measures once while the key holds (memo)', () => {
    const env = testEnv();
    const t = new ShapeTextElement();
    t.setStyle(new Style());
    t.setText('abc');
    const d = ds([], 100, 50);
    t.layout(d, env);
    const calls = env.measurer.calls;
    expect(calls).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) t.layout(d, env);
    expect(env.measurer.calls).toBe(calls);
  });

  it('empty text lays out to nothing and paints nothing', () => {
    const t = new ShapeTextElement();
    t.setStyle(new Style());
    const dp = new LogPlatform();
    t.draw(dp, ds([]), testEnv());
    expect(t.laidOut()).toBeNull();
    expect(dp.log).toEqual([]);
  });
});

describe('textEditRect (C++ LekhUtil::getTextEditRect)', () => {
  const style = (h: TextAlignHorizontal, v: TextAlignVertical) => {
    const s = new Style();
    s.setTextAlignHorizontal(h);
    s.setTextAlignVertical(v);
    return s;
  };
  const inRect = new Rect(0, 0, 100, 60);

  it('wrap: aligned within the padded box', () => {
    const p = { text: 'x', angle: 0, inRect, pad: 5 };
    expect(textEditRect(p, style(TextAlignHorizontal.Left, TextAlignVertical.Top), new Size(20, 10), 120)).toEqual(
      new Rect(5, 5, 20, 10),
    );
    expect(textEditRect(p, style(TextAlignHorizontal.Right, TextAlignVertical.Bottom), new Size(20, 10), 120)).toEqual(
      new Rect(75, 45, 20, 10),
    );
    expect(textEditRect(p, style(TextAlignHorizontal.Center, TextAlignVertical.Center), new Size(20, 10), 120)).toEqual(
      new Rect(40, 25, 20, 10),
    );
  });

  it('float: the text size plus the adjustment, at the box centre', () => {
    const p = { text: 'x', angle: 0, inRect, wrapMode: 'float' as const, textSizeAdjustment: 1 };
    expect(textEditRect(p, style(TextAlignHorizontal.Center, TextAlignVertical.Center), new Size(20, 10), 120)).toEqual(
      new Rect(39.5, 24.5, 21, 11),
    );
  });

  it('empty text is a 1×1 box at the centre', () => {
    expect(textEditRect({ text: '', angle: 0, inRect }, new Style(), new Size(), 120)).toEqual(
      new Rect(49.5, 29.5, 1, 1),
    );
  });
});

describe('TextSide names', () => {
  it('round-trips', () => {
    for (const n of ['top', 'bottom', 'left', 'right']) expect(textSideName(textSideFromName(n))).toBe(n);
    expect(textSideFromName('middle')).toBe(TextSide.None);
    expect(textSideName(TextSide.None)).toBe('');
  });
});
