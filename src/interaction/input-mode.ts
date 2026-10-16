// The input mode as observable state (port of C++ `ToolMenu::InputMode`, `L/app/ToolMenu.cpp:268-280`;
// spec 02 `InputModeState`). The default is Select on a desktop host and SmartDraw otherwise.
import type { HostEnvironment } from './env';

export const InputMode = Object.freeze({
  None: 'none',
  Select: 'select',
  Scroll: 'scroll',
  Draw: 'draw',
  SmartDraw: 'smartDraw',
  Erase: 'erase',
  Laser: 'laser',
  Shape: 'shape',
  Text: 'text',
} as const);
export type InputMode = (typeof InputMode)[keyof typeof InputMode];

export function defaultInputMode(env: Pick<HostEnvironment, 'isDesktop'>): InputMode {
  return env.isDesktop ? InputMode.Select : InputMode.SmartDraw;
}

export class InputModeState {
  private mode_: InputMode;
  private readonly listeners_ = new Set<(m: InputMode) => void>();

  constructor(initial: InputMode) {
    this.mode_ = initial;
  }

  get(): InputMode {
    return this.mode_;
  }

  set(m: InputMode): void {
    if (m === this.mode_) return;
    this.mode_ = m;
    for (const l of [...this.listeners_]) l(m);
  }

  /** Returns the unsubscribe. */
  subscribe(fn: (m: InputMode) => void): () => void {
    this.listeners_.add(fn);
    return () => {
      this.listeners_.delete(fn);
    };
  }

  get listenerCount(): number {
    return this.listeners_.size;
  }

  dispose(): void {
    this.listeners_.clear();
  }
}
