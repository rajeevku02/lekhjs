// AC-UI-03: the recorded C++ gesture traces (tap, double-tap, long-press, pan, pinch, rotate,
// two-finger pan, cancel, and a few edges) give the same listener call sequence in the TS
// `GestureRecognizer`: same calls, same times, coordinates within 1e-9. The golden is written by
// parity/tools/capture-gesture-traces/regen.mjs from the C++ recogniser.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point } from '../../src/geometry';
import {
  EventName,
  GestureRecognizer,
  Movement,
  MouseButton,
  PointState,
  PointerEvent,
  PointerType,
  check,
  eventPoint,
  type EventCheck,
  type GestureListener,
  type GestureTimers,
} from '../../src/interaction';

interface Call {
  call: string;
  t: number;
  x: number;
  y: number;
  n: number;
  value: number;
  m: string;
}
interface TracePoint {
  id: number;
  x: number;
  y: number;
  state: 'down' | 'move' | 'up';
  kind: 'mouse' | 'finger' | 'pen';
  button?: 'left' | 'right';
}
interface Step {
  t?: number;
  advance?: number;
  reset?: boolean;
  points?: TracePoint[];
}
interface Trace {
  name: string;
  canDoubleClick: boolean;
  canLongPress: boolean;
  canRotate?: boolean;
  drawOnly?: boolean;
  longPressMs?: number;
  steps: Step[];
  calls: Call[];
}

const GOLDEN = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '../fixtures/golden/gesture-traces/traces.json'), 'utf8'),
) as { traces: Trace[] };

class FakeTimers implements GestureTimers {
  now = 0;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void; seq: number }>();
  setTimer(ms: number, fn: () => void): number {
    const id = ++this.seq;
    this.timers.set(id, { at: this.now + ms, fn, seq: id });
    return id;
  }
  clearTimer(id: number): void {
    this.timers.delete(id);
  }
  /** Fires due timers in time order (insertion order on ties, as a C++ multimap). */
  runUntil(t: number): void {
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, x]) => x.at <= t)
        .sort((a, b) => a[1].at - b[1].at || a[1].seq - b[1].seq)[0];
      if (due === undefined) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = t;
  }
}

function replay(tr: Trace): Call[] {
  const timers = new FakeTimers();
  const calls: Call[] = [];
  const out = (call: string, at: Point, ev: PointerEvent | null, value: number, m: string): void => {
    calls.push({ call, t: timers.now, x: at.x, y: at.y, n: ev === null ? -1 : ev.points.length, value, m });
  };
  const mv = (m: Movement): string => (m === Movement.Start ? 'start' : m === Movement.Move ? 'move' : 'end');
  const listener: GestureListener = {
    canDoAt(name: EventName, at: Point, ev: PointerEvent): EventCheck {
      const r = check(false, false);
      if (name === EventName.DoubleClick) r.canHandle = tr.canDoubleClick;
      if (name === EventName.LongPress) {
        r.canHandle = tr.canLongPress;
        r.param = tr.longPressMs ?? 0;
      }
      if (name === EventName.Rotate) r.canHandle = tr.canRotate === true;
      const n =
        name === EventName.DoubleClick ? 'canDoubleClick' : name === EventName.LongPress ? 'canLongPress' : 'canRotate';
      out(n, at, ev, r.canHandle ? 1 : 0, '');
      return r;
    },
    isDrawOnlyMode: () => tr.drawOnly === true,
    onDown: (at, ev) => (out('down', at, ev, 0, ''), true),
    onUp: (at, ev) => (out('up', at, ev, 0, ''), true),
    onClick: (at, ev) => (out('click', at, ev, 0, ''), true),
    onDoubleClick: (at, ev) => (out('doubleClick', at, ev, 0, ''), true),
    onPan: (at, ev, m) => (out('pan', at, ev, 0, mv(m)), true),
    onScale: (at, ev, v, m) => (out('scale', at, ev, v, mv(m)), true),
    onRotate: (at, ev, v, m) => (out('rotate', at, ev, v, mv(m)), true),
    onLongPress: (at, ev, m) => (out('longPress', at, ev, 0, mv(m)), true),
    cancelDrag: () => {
      out('cancelDrag', { x: 0, y: 0 } as Point, null, 0, '');
    },
  };
  const gr = new GestureRecognizer(listener, timers);
  for (const st of tr.steps) {
    if (st.advance !== undefined) {
      timers.runUntil(timers.now + st.advance);
    } else if (st.reset === true) {
      timers.runUntil(st.t ?? 0);
      gr.reset();
    } else {
      timers.runUntil(st.t ?? 0);
      const pts = (st.points ?? []).map((p) =>
        eventPoint({
          x: p.x,
          y: p.y,
          pointerId: p.id,
          state: p.state === 'down' ? PointState.Down : p.state === 'move' ? PointState.Move : PointState.Up,
          timestamp: st.t ?? 0,
          pointerType: p.kind === 'mouse' ? PointerType.Mouse : p.kind === 'pen' ? PointerType.Pen : PointerType.Finger,
          button: p.button === 'left' ? MouseButton.Left : p.button === 'right' ? MouseButton.Right : MouseButton.None,
        }),
      );
      gr.onPointerEvent(new PointerEvent(pts));
    }
  }
  return calls;
}

describe('GestureRecognizer parity with C++ (AC-UI-03)', () => {
  it('has the eight required traces', () => {
    const names = GOLDEN.traces.map((t) => t.name);
    for (const n of ['tap', 'double-tap', 'long-press', 'pan', 'pinch', 'rotate', 'two-finger-pan', 'cancel']) {
      expect(names).toContain(n);
    }
  });

  for (const tr of GOLDEN.traces) {
    it(`trace ${tr.name}`, () => {
      const got = replay(tr);
      expect(got.map((c) => `${c.call}:${c.m}@${String(c.t)}#${String(c.n)}`)).toEqual(
        tr.calls.map((c) => `${c.call}:${c.m}@${String(c.t)}#${String(c.n)}`),
      );
      got.forEach((c, i) => {
        const e = tr.calls[i] as Call;
        expect(Math.abs(c.x - e.x)).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(c.y - e.y)).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(c.value - e.value)).toBeLessThanOrEqual(1e-9);
      });
    });
  }
});
