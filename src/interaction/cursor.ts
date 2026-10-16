// The pointer cursor per mode and hover (spec 05 §3.5; C++ `PointerIconType`, `L/Platform.h:215-217`,
// and `MiddleWidget::onPointerMove`). The host's `CursorSink` maps a `CursorKind` to CSS.
import type { CursorKind } from './shape-interaction';
import { InputMode } from './input-mode';

export type { CursorKind } from './shape-interaction';

/** C++ `MiddleWidget::onPointerMove`: the cursor of each input mode while hovering the board. */
export function cursorForMode(mode: InputMode): CursorKind {
  switch (mode) {
    case InputMode.Select:
      return 'select';
    case InputMode.Scroll:
      return 'scroll';
    case InputMode.Draw:
      return 'draw';
    case InputMode.SmartDraw:
      return 'smartDraw';
    case InputMode.Erase:
      return 'erase';
    case InputMode.Text:
      return 'text';
    case InputMode.Laser:
      return 'laser';
    default:
      return 'default';
  }
}

/** The current cursor, observable (spec 02 `CursorState`). */
export class CursorState {
  private kind_: CursorKind = 'default';
  private readonly listeners_ = new Set<(c: CursorKind) => void>();

  get(): CursorKind {
    return this.kind_;
  }

  set(c: CursorKind): void {
    if (c === this.kind_) return;
    this.kind_ = c;
    for (const l of [...this.listeners_]) l(c);
  }

  subscribe(fn: (c: CursorKind) => void): () => void {
    this.listeners_.add(fn);
    return () => {
      this.listeners_.delete(fn);
    };
  }

  dispose(): void {
    this.listeners_.clear();
  }
}
