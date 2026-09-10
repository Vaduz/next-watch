/** **How a quota looks.** Pure formatting: no filesystem, no process, no clock.
 *
 *  Where the values come from, how they are cached and how a 429 is backed off from all belong
 *  to the io layer. This only folds a card that has already been read.
 *
 *  ⚠️ **No Node import may appear here.** This module is exported as `next-watch/quota` for a
 *  browser component to import, so `fs`, `child_process` and `os` are all out. */
import type { Tone } from '../term/index.js';

/** The name of the session window, which the io layer gives to every backend's five-hour
 *  window. */
const SESSION_WINDOW_NAME = '5h';

/** The colour for a usage percentage. Bold red from ninety, red above eighty, yellow above
 *  fifty. Ninety gets its own colour because that is where the answer stops being "carry on". */
export function quotaTone(percent: number): Tone {
  if (percent >= 90) return 'crit';
  if (percent > 80) return 'bad';
  if (percent > 50) return 'warn';
  return 'ok';
}

/** One session window, folded to what a single section shows. */
export interface SessionQuota {
  /** The backend's name. */
  label: string;
  usedPercent: number;
  /** True when the value is the last successful one rather than a fresh read. */
  stale: boolean;
}

/** The least `sessionQuotas` needs, which a full card satisfies. */
interface QuotaCardLike {
  label: string;
  stale: boolean;
  windows: readonly { name: string; usedPercent: number }[];
}

/** Take **only the session windows** from a set of cards.
 *
 *  The weekly and per-model windows are dropped. What a compact display answers is "can this
 *  run finish", and the current session window is what decides that. A backend with no session
 *  window is left out entirely rather than shown empty; the full panel is where every window
 *  can be seen. */
export function sessionQuotas(cards: readonly QuotaCardLike[]): SessionQuota[] {
  return cards.flatMap(c => {
    const window = c.windows.find(w => w.name === SESSION_WINDOW_NAME);
    if (window === undefined) return [];
    return [{ label: c.label, usedPercent: window.usedPercent, stale: c.stale }];
  });
}

/** One section as text (`Claude 5h 42%`), saying so when only the previous value is known. */
export function sessionQuotaText(q: SessionQuota): string {
  return `${q.label} ${SESSION_WINDOW_NAME} ${Math.round(q.usedPercent)}%${q.stale ? ' (stale)' : ''}`;
}

/** The **level** of a usage percentage. Returning a level rather than a colour lets a terminal
 *  and a web page share one set of thresholds while each picks its own colours.
 *
 *  The boundaries are 80 and 50, matching `quotaTone`; the separate treatment of ninety exists
 *  only on the terminal. */
export type QuotaLevel = 'error' | 'warning' | 'success';
export function quotaLevel(percent: number): QuotaLevel {
  if (percent > 80) return 'error';
  if (percent > 50) return 'warning';
  return 'success';
}

/** The record of the last time a usage window was opened. **The key is the window's reset
 *  time**, so the same window is never opened twice; the timestamp only matters when the reset
 *  time could not be read. */
export interface QuotaSessionProbe {
  /** The reset time of the window that was opened, or null when unreadable. */
  resetsAtMs: number | null;
  atMs: number;
}
