// Owner round UI3 #1 and #2: a finite page's canvas follows C++ `CanvasWidget::computeSize`.
// - #2: on a board's first open (C++ `computeSize(true)`, `handleFirstTimeLayout`) a fixed or
//   auto-size page smaller than the view is centred on that axis, else placed at the edge.
// - #1: an auto-size page is resized after every add, delete, move, undo, redo and remote update
//   (C++ `LekhUtil::updateCanvas(true)`, `Command::undo/redo`, `CoreIO` after an update): it grows
//   and shrinks with its content (`Page::getCanvasSize`: the content's right/bottom + 64, at least
//   612 × 792), the grid layer (the page rectangle and its border) is repainted, and the offset is
//   re-clamped so a quarter of the canvas stays in view.
import { describe, expect, it } from 'vitest';
import { updatetypes } from '../../src/sync';
import type { JsonObject } from '../../src/template';
import { recordingCanvas } from '../render/helpers';
import { frame } from '../sync/helpers';
import { A, B, C, P, fixtureJson, viewHarness, type ViewHarness } from './helpers';

/** The connector fixture with its page made auto-size (or fixed, `size` in points). */
function board(type: 'auto' | 'fixed', size?: { width: number; height: number }): JsonObject {
  const j = fixtureJson('format/03-connector.lekh') as { pages: Record<string, Record<string, unknown>> };
  const page = j.pages[P] as Record<string, unknown>;
  page.canvassizetype = type;
  page.canvasname = type === 'auto' ? 'Auto' : 'Custom';
  if (size !== undefined) page.size = { width: size.width, height: size.height, unit: 'point' };
  return j as unknown as JsonObject;
}

interface Painted {
  readonly h: ViewHarness;
  readonly grid: ReturnType<typeof recordingCanvas>;
  /** Runs the session's paint requests and the view's frames until both are idle. */
  readonly settle: () => void;
}

function painted(b: JsonObject, w = 800, ht = 600, cloud = false): Painted {
  const h = viewHarness({ board: b, cloud });
  h.bv.setViewportSize(w, ht, 1);
  const grid = recordingCanvas();
  h.bv.attach('grid', grid.ctx);
  h.bv.attach('drawing', recordingCanvas().ctx);
  h.bv.attach('middle', recordingCanvas().ctx);
  const settle = (): void => {
    for (let i = 0; i < 10 && (h.frames.pending > 0 || h.scheduler.pendingFrames > 0); i++) {
      h.scheduler.advance(0);
      h.scheduler.frame();
      h.frames.tick();
    }
  };
  settle();
  return { h, grid, settle };
}

/** The page's size, as drawn: the canvas in view px. */
function canvas(h: ViewHarness) {
  return h.bv.view.canvasRect();
}

/** The grid layer's page rectangle: the `rect` of its border (C++ the grid canvas's frame). */
function gridRects(log: readonly string[]): string[] {
  return log.filter((l) => l.startsWith('rect '));
}

describe('first open places a finite page as C++ computeSize(true) (UI3 #2)', () => {
  it('auto size, narrower than the view: centred horizontally; taller: at the top', () => {
    const { h } = painted(board('auto'));
    // Content right edge 510 < 612 - 64: the minimum 612 × 792.
    expect(h.session.document.activePage().getCanvasSize(false)).toMatchObject({ width: 612, height: 792 });
    const c = canvas(h);
    expect(c.x).toBeCloseTo((800 - 612) / 2, 6);
    expect(c.y).toBe(0);
  });

  it('fixed size smaller than the view on both axes: centred', () => {
    const { h } = painted(board('fixed', { width: 400, height: 300 }));
    const c = canvas(h);
    expect(c.x).toBeCloseTo(200, 6);
    expect(c.y).toBeCloseTo(150, 6);
  });

  it('a page larger than the view: at the origin', () => {
    const { h } = painted(board('fixed', { width: 2000, height: 1500 }));
    expect(canvas(h).x).toBe(0);
    expect(canvas(h).y).toBe(0);
  });

  it('only on the open: a later scroll stays', () => {
    const { h, settle } = painted(board('fixed', { width: 400, height: 300 }));
    h.bv.view.scrollDelta(-50, 0);
    settle();
    expect(canvas(h).x).toBeCloseTo(150, 6);
    h.dispatch({ type: 'command', origin: 'ui', command: { kind: 'move', ids: [A], dx: 10, dy: 0 } });
    settle();
    expect(canvas(h).x).toBeCloseTo(150, 6);
  });

  it('an infinite page keeps its view', () => {
    const { h } = painted(fixtureJson('format/03-connector.lekh'));
    expect(h.session.viewTransform.scrollX).toBe(0);
    expect(h.session.viewTransform.scrollY).toBe(0);
  });

  it('Move to begining on a finite page: 100 % and placed as on the open', () => {
    const { h, settle } = painted(board('fixed', { width: 400, height: 300 }));
    h.bv.board.setView({ zoom: 2, tx: -300, ty: -200 });
    settle();
    h.bv.commands.goToBeginning(false);
    settle();
    expect(h.session.view.zoom).toBe(1);
    expect(canvas(h).x).toBeCloseTo(200, 6);
    expect(canvas(h).y).toBeCloseTo(150, 6);
  });
});

describe('an auto-size canvas follows its content (UI3 #1)', () => {
  const width = (h: ViewHarness) => h.session.document.activePage().getCanvasSize(false).width;

  it('grows on a move, shrinks back on undo, grows again on redo; the grid layer repaints each time', () => {
    const { h, grid, settle } = painted(board('auto'));
    const before = gridRects(grid.log).at(-1);
    expect(before).toBeDefined();
    grid.log.length = 0;
    // B (cx 450, 120 wide) moved 1000 right: right edge 1510 (+ half its stroke) + 64.
    h.dispatch({ type: 'command', origin: 'ui', command: { kind: 'move', ids: [B], dx: 1000, dy: 0 } });
    settle();
    const grown = width(h);
    expect(grown).toBeCloseTo(1510 + 0.5 + 64, 6);
    const after = gridRects(grid.log).at(-1);
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    grid.log.length = 0;
    h.dispatch({ type: 'command', origin: 'ui', command: { kind: 'undo' } });
    settle();
    expect(width(h)).toBe(612);
    expect(gridRects(grid.log).at(-1)).toBe(before);
    grid.log.length = 0;
    h.dispatch({ type: 'command', origin: 'ui', command: { kind: 'redo' } });
    settle();
    expect(width(h)).toBe(grown);
    expect(gridRects(grid.log).at(-1)).toBe(after);
  });

  it('a delete shrinks it, and the offset is re-clamped so a quarter stays in view', () => {
    const { h, settle } = painted(board('auto'));
    h.dispatch({ type: 'command', origin: 'ui', command: { kind: 'move', ids: [B], dx: 3000, dy: 0 } });
    settle();
    // Scroll far right: the wide canvas starts well left of the view.
    h.bv.view.scrollDelta(-3000, 0);
    settle();
    expect(canvas(h).x).toBeLessThan(-2500);
    h.dispatch({ type: 'command', origin: 'ui', command: { kind: 'delete', ids: [B, C] } });
    settle();
    expect(width(h)).toBe(612);
    // C++ clamp: offsetX >= minVisibleWidth - canvasWidth (min(612, 800) / 4 = 153).
    expect(canvas(h).x).toBeCloseTo(153 - 612, 6);
  });

  it('follows a collaborator (remote) change the same way', () => {
    const { h, grid, settle } = painted(board('auto'), 800, 600, true);
    grid.log.length = 0;
    h.dispatch({
      type: 'remoteFrame',
      text: frame(updatetypes.changeAttr, { [`doc.pages.${P}.objects.${B}.params.cx`]: 2500 }, 8),
    });
    settle();
    expect(width(h)).toBeCloseTo(2500 + 60 + 0.5 + 64, 6);
    expect(gridRects(grid.log).length).toBeGreaterThan(0);
  });
});
