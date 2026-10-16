// `BoardSession.diagnostics` (spec 04 §7.4): what the engine reports about a board for the board UI
// and kashi, apart from the session notifications. Today: each unknown generator drawn as a
// placeholder (`unknown_generator`; kashi turns it into a `notes` entry, never a lint issue), and
// the usage event `unknown_generator_seen`, sent once per board open and only when at least one
// placeholder exists, with counts and reason codes only (no ids, no content). The host's
// `UsageReporter` posts the usage event.
import type { Logger } from '../base';
import type { UnknownGeneratorReason } from '../template';

export interface DiagnosticEvents {
  unknown_generator: {
    readonly templateId: string;
    readonly objectId?: string;
    readonly reason: UnknownGeneratorReason;
  };
  usage: {
    readonly name: 'unknown_generator_seen';
    readonly count: number;
    readonly reasons: readonly UnknownGeneratorReason[];
  };
}

type Listener<K extends keyof DiagnosticEvents> = (e: DiagnosticEvents[K]) => void;

export class SessionDiagnostics {
  private readonly listeners_ = new Map<keyof DiagnosticEvents, ((e: never) => void)[]>();
  private readonly logger_: Logger;

  constructor(logger: Logger) {
    this.logger_ = logger;
  }

  /** Subscribes; returns the unsubscribe. */
  on<K extends keyof DiagnosticEvents>(k: K, fn: Listener<K>): () => void {
    const list = this.listeners_.get(k) ?? [];
    list.push(fn);
    this.listeners_.set(k, list);
    return () => {
      const l = this.listeners_.get(k);
      if (l !== undefined) {
        this.listeners_.set(
          k,
          l.filter((f) => f !== (fn as unknown)),
        );
      }
    };
  }

  emit<K extends keyof DiagnosticEvents>(k: K, e: DiagnosticEvents[K]): void {
    for (const fn of [...(this.listeners_.get(k) ?? [])]) {
      try {
        (fn as Listener<K>)(e);
      } catch (err) {
        this.logger_.error('listener_error', { diagnostic: k, name: err instanceof Error ? err.name : typeof err });
      }
    }
  }

  clear(): void {
    this.listeners_.clear();
  }
}
