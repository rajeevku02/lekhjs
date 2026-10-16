// The transport port (spec 01 §4.2, spec 09 §7). lekhjs never opens a socket: the host's
// `WebSocketTransport` (lekhboard-capacitor, over the browser `WebSocket`) implements this, and
// tests use a fake. The session drives it; frames and state changes come back as the
// `remoteFrame` and `transportState` session events.

export type TransportStateName = 'connecting' | 'open' | 'closed';

export interface TransportState {
  readonly state: TransportStateName;
  readonly closeCode?: number;
  readonly closeReason?: string;
  /** When the state was observed (the session clock, ms). */
  readonly at: number;
}

export interface Transport {
  /** Opens the socket; `compat=5` and the `xc`/`xo` fallbacks go on the URL's query. */
  connect(url: string, q: { compat: 5; xc?: string; xo?: string }): void;
  /** False when not open: the frame is not queued. */
  send(frame: string): boolean;
  close(code?: number, reason?: string): void;
  readonly state: TransportStateName;
  /** Returns the unsubscribe function. */
  onState(cb: (s: TransportState) => void): () => void;
  onFrame(cb: (text: string) => void): () => void;
}
