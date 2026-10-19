// The opt-in input trace (Work 01M4X7TCHFB862XGT68GPY071C, IN1): a sink the host sets to log the
// recogniser's state changes, the router's gestures and drag-handler ownership, resets and their
// reason, and the draggers' drop decisions. Off (no sink) by default; with no sink `emit` does
// nothing and callers check `on` before building their data, so the trace costs one branch.
// No DOM, no module state: one `InputTrace` hangs off each `SessionBoard`.

/** One trace record: a short kind (`rec.state`, `router.drag`, `connect.drop`, …) and its fields. */
export type InputTraceSink = (kind: string, data: Readonly<Record<string, unknown>>) => void;

export class InputTrace {
  sink: InputTraceSink | null = null;

  get on(): boolean {
    return this.sink !== null;
  }

  emit(kind: string, data: Readonly<Record<string, unknown>> = {}): void {
    const s = this.sink;
    if (s === null) return;
    try {
      s(kind, data);
    } catch {
      // A failing log sink never breaks input.
    }
  }
}
