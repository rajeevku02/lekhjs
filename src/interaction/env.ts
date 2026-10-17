// What the interaction layer knows about its host (spec 05 §1.1 `HostEnvInfo`, spec 02
// `HostEnvironment`; the predicates of C++ `L/app/HostEnv.cpp`). A plain value the host builds
// from `getSystemInfo()` / the user agent; nothing here reads a global.
export interface HostEnvironment {
  readonly host: 'web' | 'ios' | 'android' | 'mac';
  readonly idiom: 'phone' | 'tablet' | 'desktop';
  /** Cmd is `metaKey` on Apple hosts (web on macOS/iOS included), `ctrlKey` elsewhere. */
  readonly isApple: boolean;
  readonly isDesktop: boolean;
  /** Below 660 × 660 (`HostEnv.cpp:96-101`). */
  readonly isSmallScreen: boolean;
  readonly hasPencilSupport: boolean;
  readonly hasTouch: boolean;
  /**
   * A cloud board whose socket closes in the foreground is reopened (spec 09 §7). Off on Mac
   * (`HostEnv.cpp:48-50`: `idiom === 'mac'`); the session's `ReconnectPolicy` reads it through
   * `SessionOptions.autoReconnect`.
   */
  readonly autoReconnect: boolean;
  readonly androidApi?: number;
}

/** C++ `HostEnv` auto-reconnect: every host but Mac. */
export function autoReconnectFor(host: HostEnvironment['host']): boolean {
  return host !== 'mac';
}

export const DESKTOP_WEB: HostEnvironment = Object.freeze({
  host: 'web',
  idiom: 'desktop',
  isApple: false,
  isDesktop: true,
  isSmallScreen: false,
  hasPencilSupport: true,
  hasTouch: false,
  autoReconnect: true,
});

/** C++ `HostEnv::isSmallScreen`: either side below 660 view px. */
export function isSmallScreen(width: number, height: number): boolean {
  return width < 660 || height < 660;
}
