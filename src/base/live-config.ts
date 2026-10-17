// The runtime's configuration as the user changes it (C++ `Config::instance()` was a mutable
// singleton that the settings screens wrote to; spec 05 §6.3 `SettingsApi`). Each value is still an
// immutable `EngineConfig`; `LiveConfig` holds the current one and is itself a `Config` whose fields
// read the current value, so every holder of `runtime.config` (sessions, object stores, connection
// end points) sees a setting change at its next read, as the C++ code read the singleton.
import type { EngineConfig } from './config';
import { CONFIG_KEYS, type Config, type ConfigOverrides, type ConfigValues } from './config';

export class LiveConfig {
  private current_: EngineConfig;
  private readonly listeners_ = new Set<(c: EngineConfig) => void>();

  constructor(initial: EngineConfig) {
    this.current_ = initial;
  }

  /** The current immutable value. */
  get current(): EngineConfig {
    return this.current_;
  }

  /** This holder as a `Config` (its fields read the current value). */
  asConfig(): Config {
    return this as unknown as Config;
  }

  /**
   * Applies `overrides` (a settings change, or the settings file read after start-up); listeners
   * run when a value changed. Returns whether one did.
   */
  update(overrides: ConfigOverrides): boolean {
    const next = this.current_.withOverrides(overrides);
    const a = this.current_.toValues() as unknown as Record<string, unknown>;
    const b = next.toValues() as unknown as Record<string, unknown>;
    const changed = CONFIG_KEYS.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    if (!changed) return false;
    this.current_ = next;
    for (const l of [...this.listeners_]) l(next);
    return true;
  }

  /** Subscribes to changes; returns the unsubscribe. */
  onChange(fn: (c: EngineConfig) => void): () => void {
    this.listeners_.add(fn);
    return () => {
      this.listeners_.delete(fn);
    };
  }

  withOverrides(overrides: ConfigOverrides): EngineConfig {
    return this.current_.withOverrides(overrides);
  }

  toValues(): ConfigValues {
    return this.current_.toValues();
  }
}

// Every config field reads through to the current value.
for (const k of CONFIG_KEYS) {
  Object.defineProperty(LiveConfig.prototype, k, {
    get(this: LiveConfig) {
      return (this.current as unknown as Record<string, unknown>)[k];
    },
    enumerable: true,
    configurable: false,
  });
}
