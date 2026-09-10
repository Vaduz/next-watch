/** The durations of the usage windows, in minutes. Windows are classified by **how long they
 *  actually are**, not by their position in the provider's response. */
export const FIVE_HOUR_WINDOW_MINUTES = 5 * 60;
export const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
export const WEEKLY_WINDOW_MS = WEEKLY_WINDOW_MINUTES * 60 * 1000;

export interface QuotaWindowWithDuration {
  windowMinutes: number | null;
}

/** Classify only the windows whose duration is one of the two known ones. Anything else is
 *  ignored rather than shown under a label that might be wrong. */
export function classifyQuotaWindows<T extends QuotaWindowWithDuration>(
  windows: readonly (T | null)[],
): { fiveHour: T | null; weekly: T | null } {
  let fiveHour: T | null = null;
  let weekly: T | null = null;
  for (const window of windows) {
    if (window?.windowMinutes === FIVE_HOUR_WINDOW_MINUTES && fiveHour === null) fiveHour = window;
    if (window?.windowMinutes === WEEKLY_WINDOW_MINUTES && weekly === null) weekly = window;
  }
  return { fiveHour, weekly };
}
