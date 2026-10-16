// The cooperative deadline of a headless session (spec 03 §12.4, spec 10 §4). lekhjs calls
// `check()` at safe points (each page of a load, a layout flush and a paint); once the clock has
// reached the deadline it throws `LekhError('budget_exceeded')`, which the session never catches,
// so the host's operation ends without a partial result. Client sessions carry no budget.
import { LekhError, type Clock } from '../base';
import type { Budget } from './ports';

export class DeadlineBudget implements Budget {
  readonly deadline: number;
  private readonly clock_: Clock;

  constructor(clock: Clock, deadline: number) {
    this.clock_ = clock;
    this.deadline = deadline;
  }

  /** A budget of `ms` from now. */
  static fromNow(clock: Clock, ms: number): DeadlineBudget {
    return new DeadlineBudget(clock, clock.now() + ms);
  }

  check(): void {
    if (this.clock_.now() >= this.deadline) throw new LekhError('budget_exceeded', 'operation budget exceeded');
  }
}
