// Shared helpers for the render suites: a recording Canvas2DLike, a recording DrawingPlatform,
// and a manual clock + scheduler.
import type { Canvas2DLike, GradientLike, Handle, Scheduler } from '../../src/base';
import type { BezierCurve, Point } from '../../src/geometry';
import type { DrawingPlatform, PathPaint } from '../../src/render';
import type { Style } from '../../src/style';

const r = (n: number) => String(Math.round(n * 1000) / 1000);

/** A Canvas2DLike that logs every call (numbers rounded to 3 places) and keeps its state fields. */
export function recordingCanvas() {
  const log: string[] = [];
  const gradients: { kind: string; args: number[]; stops: [number, string][] }[] = [];
  const snap = (name: string) => () => log.push(name);
  const call =
    (name: string) =>
    (...args: (number | boolean | undefined)[]) =>
      log.push([name, ...args.filter((a) => typeof a === 'number').map(r)].join(' '));
  const ctx = {
    fillStyle: '#000' as unknown,
    strokeStyle: '#000' as unknown,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save: snap('save'),
    restore: snap('restore'),
    setTransform: call('setTransform'),
    transform: call('transform'),
    translate: call('translate'),
    scale: call('scale'),
    rotate: call('rotate'),
    beginPath: snap('beginPath'),
    closePath: snap('closePath'),
    moveTo: call('moveTo'),
    lineTo: call('lineTo'),
    bezierCurveTo: call('bezierCurveTo'),
    quadraticCurveTo: call('quadraticCurveTo'),
    arc: (x: number, y: number, rad: number, s: number, e: number, ccw?: boolean) =>
      log.push(['arc', x, y, rad, s, e].map((v) => (typeof v === 'number' ? r(v) : v)).join(' ') + ` ${String(ccw)}`),
    ellipse: call('ellipse'),
    rect: call('rect'),
    fill(): void {
      log.push(`fill ${String(this.fillStyle)}`);
    },
    stroke(): void {
      log.push(`stroke ${String(this.strokeStyle)} w=${r(this.lineWidth)} cap=${this.lineCap} join=${this.lineJoin}`);
    },
    clip: snap('clip'),
    fillRect: call('fillRect'),
    clearRect: call('clearRect'),
    fillText: (t: string, x: number, y: number) => log.push(`fillText ${t} ${r(x)} ${r(y)}`),
    measureText: (t: string) => ({ width: t.length * 10 }),
    drawImage: (img: unknown, x: number, y: number, w: number, h: number) =>
      log.push(`drawImage ${String(img)} ${r(x)} ${r(y)} ${r(w)} ${r(h)}`),
    setLineDash: (d: number[]) => log.push(`setLineDash [${d.join(',')}]`),
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): GradientLike {
      const g = { kind: 'linear', args: [x0, y0, x1, y1], stops: [] as [number, string][] };
      gradients.push(g);
      return { addColorStop: (o: number, c: string) => g.stops.push([o, c]) };
    },
    createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): GradientLike {
      const g = { kind: 'radial', args: [x0, y0, r0, x1, y1, r1], stops: [] as [number, string][] };
      gradients.push(g);
      return { addColorStop: (o: number, c: string) => g.stops.push([o, c]) };
    },
  };
  return { ctx: ctx satisfies Canvas2DLike, log, gradients };
}

export interface RecordedPath {
  start: Point;
  style: Style;
  paint: PathPaint | undefined;
  ops: string[];
}

/** A DrawingPlatform that records each path with its style, and every other call by name. */
export class RecordingPlatform implements DrawingPlatform {
  readonly paths: RecordedPath[] = [];
  readonly calls: string[] = [];
  private cur: RecordedPath | null = null;

  startDrawing(pt: Point, style: Style, paint?: PathPaint): void {
    this.cur = { start: pt, style, paint, ops: [] };
  }
  endDrawing(): void {
    if (this.cur) this.paths.push(this.cur);
    this.cur = null;
  }
  closePath(): void {
    this.cur?.ops.push('Z');
  }
  addLineTo(pt: Point): void {
    this.cur?.ops.push(`L ${r(pt.x)} ${r(pt.y)}`);
  }
  moveTo(pt: Point): void {
    this.cur?.ops.push(`M ${r(pt.x)} ${r(pt.y)}`);
  }
  addCircle(): void {
    this.calls.push('addCircle');
  }
  addArc(): void {
    this.calls.push('addArc');
  }
  addEllipse(): void {
    this.calls.push('addEllipse');
  }
  addCurve(c: BezierCurve): void {
    this.cur?.ops.push(`C ${r(c.point4.x)} ${r(c.point4.y)}`);
  }
  addRoundedRect(): void {
    this.calls.push('addRoundedRect');
  }
  drawText(): void {
    this.calls.push('drawText');
  }
  drawImage(): void {
    this.calls.push('drawImage');
  }
  saveContext(): void {
    this.calls.push('save');
  }
  restoreContext(): void {
    this.calls.push('restore');
  }
  translate(): void {
    this.calls.push('translate');
  }
  clip(): void {
    this.calls.push('clip');
  }
}

/** A manual clock and scheduler: `advance(ms)` runs every timer that falls due, in due order. */
export class ManualTime implements Scheduler {
  t = 0;
  private seq = 0;
  readonly timers = new Map<number, { due: number; fn: () => void }>();

  readonly clock = { now: () => this.t };

  setTimeout(fn: () => void, ms: number): Handle {
    const id = ++this.seq;
    this.timers.set(id, { due: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: Handle): void {
    this.timers.delete(h as number);
  }
  requestFrame(cb: (t: number) => void): Handle {
    return this.setTimeout(() => {
      cb(this.t);
    }, 0);
  }
  cancelFrame(h: Handle): void {
    this.clearTimeout(h);
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { due: number; fn: () => void }] | null = null;
      for (const e of this.timers) if (e[1].due <= end && (next === null || e[1].due < next[1].due)) next = e;
      if (next === null) break;
      this.timers.delete(next[0]);
      this.t = Math.max(this.t, next[1].due);
      next[1].fn();
    }
    this.t = end;
  }
}
