// Canvas2DDrawingPlatform: the path build, the fill/stroke rules of the web and kashi platforms
// (effective join and cap, dash reset, disabled colours), no shadows, the clip steps, images,
// text through TextPainter, gradients only when passed, and a real @napi-rs/canvas draw under a
// zoom transform.
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { BezierCurve, PathStepType, Point, Rect, Size, pathStep } from '../../src/geometry';
import {
  Canvas2DDrawingPlatform,
  ViewTransform,
  computeGradient,
  cssColor,
  type DrawingPlatform,
} from '../../src/render';
import { CapStyle, Color, Gradient, JoinStyle, NO_PAINT, Paint, PaintType, Shadow, Style } from '../../src/style';
import { createTestTextStack } from '../../src/testing';
import { textStyleSnapshot } from '../../src/text';
import { fixedMeasurer } from '../text/helpers';
import { recordingCanvas } from './helpers';

const RED = new Color(255, 0, 0);
const BLUE = new Color(0, 0, 255);

function filledStroked(): Style {
  const s = new Style();
  s.setFillColor(RED);
  s.setStrokeColor(BLUE);
  s.setStrokeWidth(2);
  return s;
}

describe('Canvas2DDrawingPlatform paths', () => {
  it('builds the path on the context and fills, then strokes, inside save/restore', () => {
    const { ctx, log } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.startDrawing(new Point(1, 2), filledStroked());
    dp.addLineTo(new Point(10, 2));
    dp.moveTo(new Point(5, 5));
    dp.addLineTo(new Point(10, 10));
    dp.closePath();
    dp.endDrawing();
    expect(log).toEqual([
      'beginPath',
      'moveTo 1 2',
      'lineTo 10 2',
      'moveTo 5 5',
      'lineTo 10 10',
      'closePath',
      'save',
      'fill rgba(255, 0, 0, 1)',
      'setLineDash []',
      'stroke rgba(0, 0, 255, 1) w=2 cap=round join=round',
      'restore',
    ]);
  });

  it('no fill for NoPaint, no stroke for width 0 or a NoPaint stroke', () => {
    for (const set of [
      (s: Style) => {
        s.setStrokeWidth(0);
      },
      (s: Style) => {
        s.setStrokePaint(NO_PAINT);
      },
    ]) {
      const s = filledStroked();
      s.setFillPaint(NO_PAINT);
      set(s);
      const { ctx, log } = recordingCanvas();
      const dp = new Canvas2DDrawingPlatform(ctx);
      dp.startDrawing(new Point(), s);
      dp.addLineTo(new Point(1, 1));
      dp.endDrawing();
      expect(log.filter((l) => l.startsWith('fill') || l.startsWith('stroke'))).toEqual([]);
    }
  });

  it('draws no shadow (owner decision): a shadow with no border strokes nothing', () => {
    const s = filledStroked();
    s.setStrokeWidth(0);
    s.setShadow(new Shadow(2, 2, 5, RED));
    const { ctx, log } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.startDrawing(new Point(), s);
    dp.addLineTo(new Point(1, 1));
    dp.endDrawing();
    expect(log.some((l) => l.startsWith('stroke'))).toBe(false);
    expect(Object.keys(ctx).some((k) => k.startsWith('shadow'))).toBe(false);
  });

  it('disabled styles paint 60 % towards white', () => {
    const s = filledStroked();
    s.setDisabled(1);
    const { ctx, log } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.startDrawing(new Point(), s);
    dp.endDrawing();
    expect(log).toContain(`fill ${RED.disabled().toCss()}`);
    expect(log.find((l) => l.startsWith('stroke'))).toContain(BLUE.disabled().toCss());
    expect(cssColor(RED, true)).toBe('rgba(255, 153, 153, 1)');
  });

  it('join and cap come from the effective style (a parent join applies to the child)', () => {
    const parent = new Style();
    parent.setJoinStyle(JoinStyle.Miter);
    parent.setCapStyle(CapStyle.Square);
    const child = filledStroked();
    child.setParent(parent);
    const { ctx, log } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.startDrawing(new Point(), child);
    dp.endDrawing();
    expect(log.find((l) => l.startsWith('stroke'))).toContain('cap=square join=miter');
  });

  it.each([
    [JoinStyle.Bevel, 'bevel'],
    [JoinStyle.Miter, 'miter'],
    [JoinStyle.Round, 'round'],
    [JoinStyle.Default, 'round'],
  ])('join %s → %s', (js, css) => {
    const s = filledStroked();
    s.setJoinStyle(js);
    const { ctx } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.startDrawing(new Point(), s);
    dp.endDrawing();
    expect(ctx.lineJoin).toBe(css);
  });

  it('a dash sets the dash and a butt cap unless the style names one', () => {
    const s = filledStroked();
    s.setDashArray([4, 2]);
    const { ctx, log } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.startDrawing(new Point(), s);
    dp.endDrawing();
    expect(log).toContain('setLineDash [4,2]');
    expect(log.find((l) => l.startsWith('stroke'))).toContain('cap=butt');
    s.setCapStyle(CapStyle.Round);
    dp.startDrawing(new Point(), s);
    dp.endDrawing();
    expect(log.filter((l) => l.startsWith('stroke')).at(-1)).toContain('cap=round');
  });

  it('circle, arc and ellipse replace the path; negative sizes clamp to 0', () => {
    const { ctx, log } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.startDrawing(new Point(9, 9), filledStroked());
    dp.addCircle(new Point(5, 6), -1);
    dp.addArc(new Point(1, 1), 3, 0, 1);
    dp.addEllipse(new Point(2, 3), 10, -4, 0.5);
    expect(log).toEqual([
      'beginPath',
      'moveTo 9 9',
      'beginPath',
      'ellipse 5 6 0 0 0 0 6.3',
      'beginPath',
      'arc 1 1 3 0 1 false',
      'beginPath',
      'ellipse 2 3 5 0 0.5 0 6.3',
    ]);
  });

  it('a 3-point curve is quadratic, anything else cubic', () => {
    const { ctx, log } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    const [a, b, c, d] = [new Point(0, 0), new Point(1, 2), new Point(3, 4), new Point(5, 6)];
    dp.addCurve(new BezierCurve(a, b, c, d, 3));
    dp.addCurve(new BezierCurve(a, b, c, d, 4));
    expect(log).toEqual(['quadraticCurveTo 1 2 3 4', 'bezierCurveTo 1 2 3 4 5 6']);
  });

  it('a rounded rect has corners of min(w, h)/5 and ignores the angle', () => {
    const { ctx, log } = recordingCanvas();
    const dp: DrawingPlatform = new Canvas2DDrawingPlatform(ctx);
    dp.addRoundedRect(new Rect(0, 0, 100, 50), 1.2);
    expect(log[0]).toBe('beginPath');
    expect(log[1]).toBe('moveTo 10 0');
    expect(log[2]).toBe('lineTo 90 0');
    expect(log[3]).toMatch(/^bezierCurveTo .* 100 10$/);
    expect(log.at(-1)).toBe('closePath');
    expect(log.filter((l) => l.startsWith('bezierCurveTo'))).toHaveLength(4);
  });
});

describe('Canvas2DDrawingPlatform gradients', () => {
  const stops = [
    { offset: 0, color: RED },
    { offset: 0.5, color: new Color(0, 255, 0) },
    { offset: 1, color: BLUE },
  ];
  const s = new Style();
  s.setFillPaint(
    new Paint({
      type: PaintType.LinearGradient,
      linearGradient: Gradient.linear({ x1: 0, y1: 0, x2: 100, y2: 0, stops }),
    }),
  );

  it('paints the passed gradient from the first to the last stop', () => {
    const { ctx, gradients } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    const g = computeGradient(s.effectiveFillPaint(), { cx: 50, cy: 50, width: 100, height: 100 });
    dp.startDrawing(new Point(), s, { fillGradient: g });
    dp.endDrawing();
    expect(gradients).toEqual([
      {
        kind: 'linear',
        args: [0, 0, 100, 0],
        stops: [
          [0, RED.toCss()],
          [1, BLUE.toCss()],
        ],
      },
    ]);
  });

  it('without computed coordinates it paints the solid colour (web/kashi behaviour)', () => {
    const { ctx, log, gradients } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.startDrawing(new Point(), s);
    dp.endDrawing();
    expect(gradients).toEqual([]);
    expect(log).toContain(`fill ${s.effectiveFillPaint().solidColor.toCss()}`);
  });

  it('radial: focal circle to centre circle', () => {
    const { ctx, gradients } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.startDrawing(new Point(), s, {
      fillGradient: { type: 'radial', cx: 1, cy: 2, r: 3, fx: 4, fy: 5, fr: 6, stops },
    });
    dp.endDrawing();
    expect(gradients[0]?.args).toEqual([4, 5, 6, 1, 2, 3]);
  });
});

describe('Canvas2DDrawingPlatform clip, images, text, state', () => {
  it('clip: move, line, quad, cubic (as a cubic), close; arc skipped; empty clips nothing', () => {
    const { ctx, log } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.clip([]);
    expect(log).toEqual([]);
    const cubic = pathStep(PathStepType.Cubic, new Point(1, 1));
    cubic.p2 = new Point(2, 2);
    cubic.p3 = new Point(3, 3);
    const quad = pathStep(PathStepType.Quad, new Point(4, 4));
    quad.p2 = new Point(5, 5);
    dp.clip([
      pathStep(PathStepType.Move, new Point(0, 0)),
      pathStep(PathStepType.Line, new Point(9, 0)),
      quad,
      cubic,
      pathStep(PathStepType.Arc, new Point(7, 7)),
      pathStep(PathStepType.Close),
    ]);
    expect(log).toEqual([
      'beginPath',
      'moveTo 0 0',
      'lineTo 9 0',
      'quadraticCurveTo 4 4 5 5',
      'bezierCurveTo 1 1 2 2 3 3',
      'closePath',
      'clip',
    ]);
  });

  it('drawImage centres and rotates; null draws nothing; a throwing drawImage is swallowed', () => {
    const { ctx, log } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.drawImage(new Point(50, 60), new Size(20, 10), 0.5, { width: 2, height: 1, source: 'IMG' });
    dp.drawImage(new Point(), new Size(1, 1), 0, null);
    expect(log).toEqual(['save', 'translate 50 60', 'rotate 0.5', 'drawImage IMG -10 -5 20 10', 'restore']);
    const bad = {
      ...ctx,
      drawImage: () => {
        throw new Error('closed');
      },
    };
    const dp2 = new Canvas2DDrawingPlatform(bad);
    expect(() => {
      dp2.drawImage(new Point(), new Size(1, 1), 0, { width: 1, height: 1, source: null });
    }).not.toThrow();
  });

  it('drawText paints through TextPainter in the text fill, with the view scale for decorations', () => {
    const stack = createTestTextStack({ measurer: fixedMeasurer(10) });
    const style = new Style();
    style.setTextFill(Paint.solid(new Color(10, 20, 30)));
    const t = stack.layout.layout({
      text: 'ab\ncd',
      style: textStyleSnapshot(style, stack.resolver),
      box: new Rect(0, 0, 100, 50),
      wrapWidth: 100,
      angle: 0,
    });
    const { ctx, log } = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.setView(new ViewTransform({ zoom: 2, dpr: 2 }));
    expect(dp.viewScale).toBe(4);
    dp.drawText(t, style);
    expect(log.filter((l) => l.startsWith('fillText')).map((l) => l.split(' ')[1])).toEqual(['ab', 'cd']);
    expect(ctx.fillStyle).toBe('rgba(10, 20, 30, 1)');
  });

  it('save, restore, translate pass through; setContext retargets', () => {
    const a = recordingCanvas();
    const b = recordingCanvas();
    const dp = new Canvas2DDrawingPlatform(a.ctx);
    dp.saveContext();
    dp.translate(3, 4);
    dp.restoreContext();
    dp.setContext(b.ctx);
    dp.saveContext();
    expect(a.log).toEqual(['save', 'translate 3 4', 'restore']);
    expect(b.log).toEqual(['save']);
    expect(dp.context).toBe(b.ctx);
  });

  it('endDrawing without startDrawing does nothing', () => {
    const { ctx, log } = recordingCanvas();
    new Canvas2DDrawingPlatform(ctx).endDrawing();
    expect(log).toEqual([]);
  });
});

describe('Canvas2DDrawingPlatform on @napi-rs/canvas', () => {
  it('zoom is the canvas transform: a 10×10 square at (5, 5) under zoom 2 fills device px 10-29', () => {
    const canvas = createCanvas(40, 40);
    const ctx = canvas.getContext('2d');
    const dp = new Canvas2DDrawingPlatform(ctx);
    dp.setView(new ViewTransform({ zoom: 2, canvasW: 40, canvasH: 40 }));
    const s = new Style();
    s.setFillColor(RED);
    s.setStrokeWidth(0);
    dp.startDrawing(new Point(5, 5), s);
    dp.addLineTo(new Point(15, 5));
    dp.addLineTo(new Point(15, 15));
    dp.addLineTo(new Point(5, 15));
    dp.closePath();
    dp.endDrawing();
    const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    expect(px(20, 20)).toEqual([255, 0, 0, 255]);
    expect(px(11, 11)).toEqual([255, 0, 0, 255]);
    expect(px(8, 8)).toEqual([0, 0, 0, 0]);
    expect(px(31, 31)).toEqual([0, 0, 0, 0]);
  });
});
