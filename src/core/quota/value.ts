/** Reading the numbers out of a quota API's response. Pure. */
import { asRecord } from '../util.js';

/** A number from an external API. `null`, `undefined` and the empty string must not become
 *  zero through `Number()`. */
export function quotaNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** `Retry-After`, in seconds or as an HTTP date, as milliseconds to wait. */
export function retryAfterMs(value: string | null, nowMs: number, fallbackMs: number): number {
  if (value !== null && /^\d+$/.test(value.trim())) {
    const seconds = Number.parseInt(value, 10);
    if (seconds > 0) return seconds * 1000;
  }
  if (value !== null) {
    const retryAtMs = Date.parse(value);
    if (Number.isFinite(retryAtMs) && retryAtMs > nowMs) return retryAtMs - nowMs;
  }
  return fallbackMs;
}

export interface ClaudeScopedQuotaWindow {
  usedPercent: number;
  resetsAt: unknown;
}

/** Find a per-model weekly window in a `limits[]` array. Some models appear there as
 * `weekly_scoped` rather than at the top level.
 *
 * **A window with no `resets_at` is not a window.** An account that has no such limit still
 * gets a placeholder row (`{kind:'weekly_scoped', percent:0, resets_at:null, is_active:false,
 * scope:{model:{id:null, display_name:'...'}}}`), and taking it would put a permanent "0%, no
 * reset" bar on screen. The test is the presence of `resets_at`, because:
 * - `is_active` cannot be used: a real weekly limit is also `is_active:false` while the
 *   five-hour window is the binding one. It says "is this the constraint right now", not
 *   "does this limit exist".
 * - `scope.model.id` has only ever been observed on one account, so it is no basis for a rule.
 * A window with no reset time cannot say when it frees up, and is meaningless as a quota. */
export function findClaudeWeeklyModelLimit(value: unknown, modelName: string): ClaudeScopedQuotaWindow | null {
  if (!Array.isArray(value)) return null;
  const needle = modelName.toLowerCase();
  for (const item of value) {
    const win = scopedWindowFor(item, needle);
    if (win) return win;
  }
  return null;
}

/** One entry of `limits[]`, if it is the named model's weekly window. */
function scopedWindowFor(item: unknown, needle: string): ClaudeScopedQuotaWindow | null {
  const limit = asRecord(item);
  if (limit?.kind !== 'weekly_scoped') return null;
  if (!modelDisplayName(limit).toLowerCase().includes(needle)) return null;
  const usedPercent =
    quotaNumber(limit.percent) ?? quotaNumber(limit.utilization) ?? quotaNumber(limit.used_percentage);
  // Without a reset time it is a placeholder, not a window.
  if (usedPercent === null) return null;
  if (limit.resets_at === null || limit.resets_at === undefined) return null;
  return { usedPercent, resetsAt: limit.resets_at };
}

/** `limits[].scope.model.display_name`, or the empty string when any step is missing. */
function modelDisplayName(limit: Record<string, unknown>): string {
  const model = asRecord(asRecord(limit.scope)?.model);
  return typeof model?.display_name === 'string' ? model.display_name : '';
}
