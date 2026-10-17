// Per-session undo and redo (port of C++ `UndoManager`, `L/UndoManager.{h,cpp}`; spec 03 §11.5).
// The static singleton becomes one instance per board session. The stack holds at most
// `UNDO_STACK_SIZE` commands; the oldest goes first. A command that fails on undo or redo (its
// objects are gone, e.g. a peer deleted them) is dropped, as C++ deleted it. Remote changes never
// enter the stack. The multi-stroke recognizer hook and the session-stats counter of C++ are not
// here (multi-stroke is not ported; usage counting is the session's, through `onUndo`).
import type { UserAction } from './user-action';

/** C++ `UNDO_STACK_SIZE`. */
export const UNDO_STACK_SIZE = 200;

export interface UndoManagerOptions {
  /** C++ `setStateChangeHandler`: called when `canUndo` or `canRedo` changes. */
  readonly onStateChange?: () => void;
  /** Called on each undo request that has something to undo (C++ `SessionStats::onUndo`). */
  readonly onUndo?: () => void;
}

/** What `UndoManager.checkpoint` captured. */
export interface UndoCheckpoint {
  readonly undo: readonly UserAction[];
  readonly redo: readonly UserAction[];
  /** The held-back steps while deferring (`beginDefer`), else null. */
  readonly deferred: readonly UserAction[] | null;
}

export class UndoManager {
  private undoStack_: UserAction[] = [];
  private redoStack_: UserAction[] = [];
  private readonly opts_: UndoManagerOptions;
  /** Steps held back during a recognition hold (spec 07 §6.5), pushed on top when it ends. */
  private deferred_: UserAction[] | null = null;
  private undeferred_ = 0;

  constructor(opts: UndoManagerOptions = {}) {
    this.opts_ = opts;
  }

  canUndo(): boolean {
    return this.undoStack_.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack_.length > 0;
  }

  get undoDepth(): number {
    return this.undoStack_.length;
  }

  get redoDepth(): number {
    return this.redoStack_.length;
  }

  /** C++ `topUndo`. */
  topUndo(): UserAction | null {
    return this.undoStack_[this.undoStack_.length - 1] ?? null;
  }

  /** C++ `popAction`. */
  popAction(): void {
    this.undoStack_.pop();
    this.opts_.onStateChange?.();
  }

  /** C++ `reset` (a reload or a new board). */
  reset(): void {
    const had = this.canUndo() || this.canRedo();
    this.undoStack_ = [];
    this.redoStack_ = [];
    if (had) this.opts_.onStateChange?.();
  }

  /**
   * The stacks as they are now, for `restore`: a session takes one before a command and restores
   * it when the command throws, so a failed command leaves the undo and redo stacks as they were
   * (spec 03 §14, E-52). Not a C++ member.
   */
  checkpoint(): UndoCheckpoint {
    return Object.freeze({
      undo: this.undoStack_.slice(),
      redo: this.redoStack_.slice(),
      deferred: this.deferred_ === null ? null : this.deferred_.slice(),
    });
  }

  /** Puts the stacks back as `cp` captured them. */
  restore(cp: UndoCheckpoint): void {
    const undoFlag = this.canUndo();
    const redoFlag = this.canRedo();
    this.undoStack_ = cp.undo.slice();
    this.redoStack_ = cp.redo.slice();
    if (this.deferred_ !== null && cp.deferred !== null) this.deferred_ = cp.deferred.slice();
    this.raiseStateChange(undoFlag, this.canUndo(), redoFlag, this.canRedo());
  }

  /** C++ `undo`. */
  undo(): void {
    const act = this.undoStack_.pop();
    if (act === undefined) return;
    const redoFlag = this.canRedo();
    this.opts_.onUndo?.();
    if (act.undo()) this.redoStack_.push(act);
    this.raiseStateChange(true, this.canUndo(), redoFlag, this.canRedo());
  }

  /** C++ `redo`. */
  redo(): void {
    const act = this.redoStack_.pop();
    if (act === undefined) return;
    const undoFlag = this.canUndo();
    if (act.perform()) this.undoStack_.push(act);
    this.raiseStateChange(undoFlag, this.canUndo(), true, this.canRedo());
  }

  /**
   * C++ `addAction(act, raise)`: pushes a command whose change is already made; with `raise`, its
   * update is sent first (the change happened live, e.g. during a drag). The redo stack is cleared.
   */
  addAction(act: UserAction, raise = false): void {
    const undoFlag = this.canUndo();
    const redoFlag = this.canRedo();
    if (raise) act.raise();
    if (this.deferred_ !== null && this.undeferred_ === 0) {
      this.deferred_.push(act);
      this.redoStack_ = [];
      this.raiseStateChange(undoFlag, this.canUndo(), redoFlag, this.canRedo());
      return;
    }
    this.undoStack_.push(act);
    this.redoStack_ = [];
    if (this.undoStack_.length > UNDO_STACK_SIZE) this.undoStack_.shift();
    this.raiseStateChange(undoFlag, this.canUndo(), redoFlag, this.canRedo());
  }

  // ---- the recognition hold (spec 07 §6.5; not a C++ member) ----

  /**
   * From now on, steps added go to a held-back list instead of the stack (a local edit that ran
   * live while a recognition job was in flight, e.g. a selection drag): the recognised result,
   * applied later through `undeferred`, goes on the stack first, and `endDefer` puts the held-back
   * steps on top of it, so undo order is the order a synchronous recognizer gives.
   */
  beginDefer(): void {
    this.deferred_ ??= [];
  }

  get deferring(): boolean {
    return this.deferred_ !== null;
  }

  /** Runs `fn` with steps going straight on the stack (the recognition result). */
  undeferred<T>(fn: () => T): T {
    this.undeferred_++;
    try {
      return fn();
    } finally {
      this.undeferred_--;
    }
  }

  /** Ends deferring: the held-back steps go on top of the stack, in order. */
  endDefer(): void {
    const held = this.deferred_;
    this.deferred_ = null;
    if (held === null || held.length === 0) return;
    const undoFlag = this.canUndo();
    for (const act of held) {
      this.undoStack_.push(act);
      if (this.undoStack_.length > UNDO_STACK_SIZE) this.undoStack_.shift();
    }
    this.raiseStateChange(undoFlag, this.canUndo(), this.canRedo(), this.canRedo());
  }

  private raiseStateChange(undoBefore: boolean, undoAfter: boolean, redoBefore: boolean, redoAfter: boolean): void {
    if (undoBefore !== undoAfter || redoBefore !== redoAfter) this.opts_.onStateChange?.();
  }
}
