// `ExportPolicy` (spec 08 §3, §4, §9): the free-cap check and the usage-event payloads. It never
// counts or emits; the host's delivery (`deliver.ts`) increments `num_offline_export_done` and
// calls `env.report` at hand-off (KB usage-reporting page of the C++ engine, C++
// `ExportInputBuilder::restrictExportForFreeUser`, `Reporter::reportExport`).
import type { ExportError, ExportOptions, ExportUsageEvent } from './types';

/** C++ `restrictExportForFreeUser`: at 5 done exports the 6th is refused. */
export const FREE_EXPORT_LIMIT = 5;
/** The persisted counter (setting, as today). */
export const EXPORT_COUNTER_SETTING = 'num_offline_export_done';

/** The cap applies to local boards of capped users only (AC-EXP-24). */
export function exportLimitReached(policy: { readonly capped: boolean; readonly isLocal: boolean }): boolean {
  return policy.capped && policy.isLocal;
}

/**
 * The host's policy from what it knows: `cappedUser` (no active subscription, on a host with the
 * cap — the web has none today), the board's storage and the counter.
 */
export function exportPolicy(o: { cappedUser: boolean; isLocal: boolean; exportsDone: number }): {
  capped: boolean;
  isLocal: boolean;
} {
  return { capped: o.cappedUser && o.exportsDone >= FREE_EXPORT_LIMIT, isLocal: o.isLocal };
}

export const LIMIT_REACHED_ERROR: ExportError = Object.freeze({
  code: 'export_limit_reached',
  message: 'Export limit reached',
});

/**
 * The event of a completed hand-off (`Reporter::reportExport`): Save to gallery →
 * `board_copied_out{kind: gallery}`; otherwise `board_exported{format, capped_user}` with
 * `exports_used` (the counter after this export) only for a capped user.
 */
export function exportUsageEvent(
  opts: Pick<ExportOptions, 'format' | 'destination'>,
  cappedUser: boolean,
  exportsUsed: number,
): ExportUsageEvent {
  if (opts.destination === 'gallery') return { name: 'board_copied_out', kind: 'gallery' };
  return cappedUser
    ? { name: 'board_exported', format: opts.format, capped_user: true, exports_used: exportsUsed }
    : { name: 'board_exported', format: opts.format, capped_user: false };
}
