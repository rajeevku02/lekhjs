// What a closed socket means for a cloud board (spec 09 §7; spec 02 `ReconnectPolicy`). Pure
// logic inside the session; its outputs are decisions the session turns into notifications.
//
// The rule is C++ `CoreIO::onWebSocketDisconnect` (`L/app/CoreIO.cpp:657-668`): on a disconnect,
// if the app is in the foreground and auto-reconnect is on, reopen the board; otherwise show
// "Disconnected from server" with Reload. Auto-reconnect is off on Mac (`HostEnv.cpp:48-50`) and
// on the web (`LekhCore::initForWeb`, LekhCore.cpp:125). A board that is not remote takes no
// decision (`!isRemote_ || remoteDoc_.docid.empty()`; `SyncSession` checks its docid).
//
// Kept although JS may only see the close after resume (WKWebView suspends JS soon after
// backgrounding; owner, OQ-58): a close observed while the last `hostLifecycle` was `background`,
// or a socket that is not open when `foreground` arrives, is a background disconnect — the
// dialog, and no reconnect. The same holds on the web, where `hostLifecycle` comes from
// `document.visibilitychange` (a hidden tab is "background", as `Initializer.js` calls
// `appGoesToBackground`). Each disconnect yields at most one decision; a deliberate close
// (`stop()`, leaving the board) yields none.
import type { TransportState } from './transport';

export type ReconnectDecision =
  | { readonly kind: 'dialog'; readonly dialog: { readonly kind: 'disconnected' } }
  | { readonly kind: 'reopen'; readonly reason: 'auto_reconnect' };

export interface ReconnectPolicyOptions {
  /** `env.autoReconnect`: false on Mac (`idiom === 'mac'`) and the web (`LekhCore::initForWeb`). */
  readonly autoReconnect: boolean;
  /** The lifecycle at start (a board opens in the foreground). */
  readonly lifecycle?: 'foreground' | 'background';
}

const DIALOG: ReconnectDecision = Object.freeze({ kind: 'dialog', dialog: Object.freeze({ kind: 'disconnected' }) });
const REOPEN: ReconnectDecision = Object.freeze({ kind: 'reopen', reason: 'auto_reconnect' });

export class ReconnectPolicy {
  private readonly autoReconnect_: boolean;
  private lifecycle_: 'foreground' | 'background';
  /** The socket was open at least once since the last (re)start. */
  private opened_ = false;
  /** The last transport state seen. */
  private state_: TransportState['state'] = 'connecting';
  /** A decision was already taken for the current disconnect. */
  private decided_ = false;
  private stopped_ = false;

  constructor(opts: ReconnectPolicyOptions) {
    this.autoReconnect_ = opts.autoReconnect;
    this.lifecycle_ = opts.lifecycle ?? 'foreground';
  }

  get lifecycle(): 'foreground' | 'background' {
    return this.lifecycle_;
  }

  /** A `transportState` event. */
  onTransportState(s: TransportState): ReconnectDecision | null {
    if (this.stopped_) return null;
    this.state_ = s.state;
    if (s.state === 'open') {
      this.opened_ = true;
      this.decided_ = false;
      return null;
    }
    if (s.state !== 'closed' || this.decided_) return null;
    this.decided_ = true;
    if (this.lifecycle_ === 'foreground' && this.autoReconnect_) return REOPEN;
    return DIALOG;
  }

  /**
   * A `hostLifecycle` event. `live` is the transport's own state at that moment (`Transport.state`),
   * which may already be `closed` before its close event reaches JS.
   */
  onHostLifecycle(state: 'foreground' | 'background', live?: TransportState['state']): ReconnectDecision | null {
    const was = this.lifecycle_;
    this.lifecycle_ = state;
    if (live !== undefined && !this.stopped_) this.state_ = live;
    if (this.stopped_ || state !== 'foreground' || was === 'foreground') return null;
    // Back in the foreground with a socket that is not open: a background disconnect, even when
    // its close has not been observed yet.
    const down = this.state_ === 'closed' || (this.opened_ && this.state_ !== 'open');
    if (down && !this.decided_) {
      this.decided_ = true;
      return DIALOG;
    }
    return null;
  }

  /** The board is reopened (Reload or an auto-reconnect): a fresh socket follows. */
  restart(): void {
    this.opened_ = false;
    this.decided_ = false;
    this.stopped_ = false;
    this.state_ = 'connecting';
  }

  /** The board is being left: closes from now on are deliberate. */
  stop(): void {
    this.stopped_ = true;
  }
}
