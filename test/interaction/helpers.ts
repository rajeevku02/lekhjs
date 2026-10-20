// Shared helpers for the interaction suites: a `BoardView` over a real `BoardSession` (the
// C++-written connector fixture: shapes A "Start" at (150,150) 120×60 and B "End" at (450,300),
// connector C labelled "next" between them), a manual frame scheduler, and pointer/event builders.
import type { ConfigOverrides } from '../../src/base';
import { Point } from '../../src/geometry';
import {
  BoardView,
  DESKTOP_WEB,
  ManualFrameScheduler,
  MouseButton,
  NO_MODIFIERS,
  PointState,
  PointerEvent,
  PointerType,
  eventPoint,
  type HostEnvironment,
  type InputEvent,
  type Modifiers,
  type PointerKind,
  type ShapeInteractionRegistry,
} from '../../src/interaction';
import type { ConnectionObject, LekhObject, TemplatedObject } from '../../src/model';
import type { JsonObject, TemplateCatalog } from '../../src/template';
import type { FontHost, TextMeasurer } from '../../src/text';
import { A, B, C, harness, testRuntime, type Harness } from '../session/helpers';

export { A, B, C, P, fixtureJson } from '../session/helpers';

export interface ViewHarness extends Harness {
  readonly bv: BoardView;
  readonly frames: ManualFrameScheduler;
  /** Toggle to make the board read-only. */
  readOnly: boolean;
  obj(id: string): LekhObject;
  tobj(id: string): TemplatedObject;
  /** View point of a document point. */
  v(x: number, y: number): Point;
}

export interface ViewHarnessOptions {
  readonly config?: ConfigOverrides;
  readonly env?: HostEnvironment;
  readonly cloud?: boolean;
  readonly board?: JsonObject | string;
  readonly registry?: ShapeInteractionRegistry;
  readonly save?: () => void;
  /** The runtime's base catalog (default: the bundled one). */
  readonly catalog?: TemplateCatalog;
  readonly closeTopPopover?: () => boolean;
  /** The text measurer (default: the test runtime's 10 px per character in every font). */
  readonly measurer?: TextMeasurer;
  /** The runtime's font host (default: the test runtime's `backend`, whose default family is Noto Sans). */
  readonly host?: FontHost;
}

export function viewHarness(opts: ViewHarnessOptions = {}): ViewHarness {
  // The runtime clock follows the harness's fake scheduler (timers and `now()` agree).
  const clock = { sched: null as { now(): number } | null, now: (): number => clock.sched?.now() ?? 1000 };
  const runtime = testRuntime({
    clock,
    ...(opts.config !== undefined ? { config: opts.config } : {}),
    ...(opts.catalog !== undefined ? { catalog: opts.catalog } : {}),
    ...(opts.measurer !== undefined ? { measurer: opts.measurer } : {}),
    ...(opts.host !== undefined ? { host: opts.host } : {}),
  });
  const h = harness({
    runtime,
    ...(opts.cloud === true ? { cloud: true } : {}),
    ...(opts.board !== undefined ? { board: opts.board } : {}),
  });
  clock.sched = h.scheduler;
  if (opts.cloud === true) {
    h.dispatch({ type: 'transportState', state: { state: 'open', at: 0 } });
    h.transport.sent.length = 0;
  }
  const frames = new ManualFrameScheduler();
  const state = { readOnly: false };
  const bv = new BoardView({
    session: h.session,
    env: opts.env ?? DESKTOP_WEB,
    frames,
    readOnly: () => state.readOnly,
    ...(opts.registry !== undefined ? { registry: opts.registry } : {}),
    ...(opts.save !== undefined ? { save: opts.save } : {}),
    ...(opts.closeTopPopover !== undefined ? { closeTopPopover: opts.closeTopPopover } : {}),
  });
  bv.setViewportSize(800, 600, 1);
  const store = () => h.session.editor.doc.activePage().objectStore;
  const ext = Object.assign(h, {
    bv,
    frames,
    obj: (id: string) => {
      const o = store().getObject(id);
      if (o === null) throw new Error(`no object ${id}`);
      return o;
    },
    tobj: (id: string) => out.obj(id) as TemplatedObject,
    v: (x: number, y: number) => bv.view.toView(new Point(x, y)),
  });
  Object.defineProperty(ext, 'readOnly', {
    get: () => state.readOnly,
    set: (v: boolean) => {
      state.readOnly = v;
    },
  });
  const out = ext as unknown as ViewHarness;
  return out;
}

export interface PeOptions {
  readonly kind?: 'mouse' | 'finger' | 'pen' | 'eraser';
  readonly button?: 'left' | 'right' | 'none';
  readonly mods?: Partial<Modifiers>;
  readonly points?: number;
  readonly state?: 'down' | 'move' | 'up';
}

/** A recogniser `PointerEvent` at view (x, y). */
export function pe(x: number, y: number, o: PeOptions = {}): PointerEvent {
  const kind = o.kind ?? 'mouse';
  const type =
    kind === 'mouse'
      ? PointerType.Mouse
      : kind === 'pen'
        ? PointerType.Pen
        : kind === 'eraser'
          ? PointerType.Eraser
          : PointerType.Finger;
  const button =
    o.button === 'right'
      ? MouseButton.Right
      : o.button === 'none'
        ? MouseButton.None
        : kind === 'mouse'
          ? MouseButton.Left
          : MouseButton.None;
  const state = o.state === 'up' ? PointState.Up : o.state === 'move' ? PointState.Move : PointState.Down;
  const n = o.points ?? 1;
  const pts = Array.from({ length: n }, (_, i) =>
    eventPoint({ x: x + i * 40, y, pointerId: i + 1, state, pointerType: type, button }),
  );
  return new PointerEvent(pts, { ...NO_MODIFIERS, ...o.mods }, kind === 'mouse');
}

export interface PtrOptions {
  readonly kind?: PointerKind;
  readonly id?: number;
  readonly buttons?: number;
  readonly button?: number;
  readonly mods?: Partial<Modifiers>;
  readonly eraser?: boolean;
  readonly t?: number;
}

/** A host `pointer` InputEvent at view (x, y). */
export function ptr(phase: 'down' | 'move' | 'up' | 'cancel', x: number, y: number, o: PtrOptions = {}): InputEvent {
  const kind = o.kind ?? 'mouse';
  return {
    type: 'pointer',
    phase,
    id: o.id ?? 1,
    kind,
    eraser: o.eraser ?? false,
    buttons: o.buttons ?? (phase === 'up' ? 0 : 1),
    button: o.button ?? 0,
    samples: [{ x, y, t: o.t ?? 0, pressure: 0.5, tiltX: 0, tiltY: 0, twist: 0 }],
    mods: { ...NO_MODIFIERS, ...o.mods },
    hover: false,
  };
}

/** A press-drag-release through the router: down at `from`, moves to `to` in `steps`, up. */
export function drag(h: ViewHarness, from: Point, to: Point, o: PtrOptions = {}, steps = 4): void {
  h.bv.input(ptr('down', from.x, from.y, o));
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    h.bv.input(ptr('move', x, y, o));
  }
  h.bv.input(ptr('up', to.x, to.y, { ...o, buttons: 0 }));
}

/** A tap through the router; advances past the double-tap window. */
export function tap(h: ViewHarness, at: Point, o: PtrOptions = {}): void {
  h.bv.input(ptr('down', at.x, at.y, o));
  h.bv.input(ptr('up', at.x, at.y, { ...o, buttons: 0 }));
  h.scheduler.advance(300);
}

/** The view point of connector C's label "next". */
export function labelPoint(h: ViewHarness): Point {
  const con = h.obj(C) as ConnectionObject;
  const store = h.session.editor.doc.activePage().objectStore;
  const pts = con.routePoints();
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as Point;
    const b = pts[i + 1] as Point;
    for (let k = 0; k <= 20; k++) {
      const p = new Point(a.x + ((b.x - a.x) * k) / 20, a.y + ((b.y - a.y) * k) / 20);
      const mti = store.hit.movableTextNear(p);
      if (mti !== null) return h.bv.view.toView(mti.center);
    }
  }
  throw new Error('no label');
}

export { A as SHAPE_A, B as SHAPE_B };
