// `LekhError`: an engine error with a stable `code` (spec 01 §2.1, spec 03 §14). Messages and
// fields carry codes and counts, never board content.

export class LekhError extends Error {
  /** A stable, snake_case code (e.g. `index_mismatch`, `budget_exceeded`). */
  readonly code: string;
  /** Content-free details: counts, kinds, query names. */
  readonly details: Readonly<Record<string, string | number | boolean>> | undefined;

  constructor(code: string, message?: string, details?: Record<string, string | number | boolean>) {
    super(message ?? code);
    this.name = 'LekhError';
    this.code = code;
    this.details = details === undefined ? undefined : Object.freeze({ ...details });
  }
}

/** `err` is a `LekhError`, optionally with `code`. */
export function isLekhError(err: unknown, code?: string): err is LekhError {
  return err instanceof LekhError && (code === undefined || err.code === code);
}
