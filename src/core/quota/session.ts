/** Whether the **five-hour session window is open**. Pure.
 *
 *  The window opens with the first message and closes five hours later. While nobody sends
 *  anything it stays shut, and the next one opens it — so time spent with it closed is
 *  **windows lost from the day's allowance**. A watcher that runs for half a day or more can
 *  notice it is shut and send one message to open it.
 *
 *  ⚠️ No filesystem, no process, no clock. The current time is passed in. */
import type { QuotaCard, QuotaWindowView } from '../types.js';
import type { QuotaSessionProbe } from './view.js';

/** Which backend has the session window. */
const CLAUDE_LABEL = 'Claude';

/** The name of the session window, kept as a copy so this module needs no io import. */
const SESSION_WINDOW_NAME = '5h';

/** The shortest gap before trying again after a message sent without a key to remember it by. */
export const QUOTA_SESSION_RETRY_MS = 10 * 60_000;

/** The **shape** in which it looked closed, which becomes the reason in the event. */
type ClosedShape = 'missing' | 'no-reset' | 'reset-passed' | 'unused';

/** The shape in which a window looks closed, or null when it is open.
 *
 *  `unused` — a reset time in the future with nothing used — counts as closed because a closed
 *  window can come back **already reporting the next boundary**. Leaving it out would mean
 *  never sending anything in that case. The cap instead is **never twice for the same window**
 *  (the key in `quotaSessionToStart`), so a percentage that stays rounded to zero cannot cause
 *  a repeat. */
function closedShape(window: QuotaWindowView | null, nowMs: number): ClosedShape | null {
  if (window === null) return 'missing';
  if (window.resetsAtMs === null) return 'no-reset';
  if (window.resetsAtMs <= nowMs) return 'reset-passed';
  return window.usedPercent > 0 ? null : 'unused';
}

/** Whether the window is open, meaning none of the closed shapes matched. */
export function quotaSessionOpen(window: QuotaWindowView | null, nowMs: number): boolean {
  return closedShape(window, nowMs) === null;
}

/** The session window of a card, or null when it has none. */
function sessionWindow(card: QuotaCard): QuotaWindowView | null {
  return card.windows.find(w => w.name === SESSION_WINDOW_NAME) ?? null;
}

/** The five-hour window of one backend among the cards, or null when it has none — the shape
 *  every decision about opening a window starts from, whichever CLI it is about. */
export function sessionWindowOf(cards: readonly QuotaCard[], label: string): QuotaWindowView | null {
  const card = cards.find(c => c.label === label);
  if (card === undefined || card.windows.length === 0) return null;
  return sessionWindow(card);
}

/** The label of the backend whose window `claude -p` opens. */
export { CLAUDE_LABEL };

/** One line of **evidence** for reading it as closed.
 *
 *  How a closed window actually looks in the API has not been observed directly — that would
 *  take being at the terminal at the moment it shut — so the observed values go into the event
 *  as they are. They are kept in the event log, so the first occurrence settles it. */
function whyClosed(shape: ClosedShape, window: QuotaWindowView | null, nowMs: number): string {
  if (window === null) return `no ${SESSION_WINDOW_NAME} window in the quota`;
  const used = `${Math.round(window.usedPercent)}% used`;
  if (shape === 'no-reset') return `${SESSION_WINDOW_NAME} window has no reset time, ${used}`;
  if (shape === 'unused') return `${SESSION_WINDOW_NAME} window is ${used}`;
  const minutes = Math.round((nowMs - (window.resetsAtMs ?? nowMs)) / 60_000);
  return `${SESSION_WINDOW_NAME} window reset ${minutes}min ago, ${used}`;
}

/** Whether an earlier attempt is reason enough to skip this one. */
function alreadyProbed(
  probe: QuotaSessionProbe,
  card: QuotaCard,
  window: QuotaWindowView | null,
  shape: ClosedShape,
  nowMs: number,
): boolean {
  // Once per window, keyed by its reset time.
  if (window?.resetsAtMs != null && probe.resetsAtMs === window.resetsAtMs) return true;
  // After a message sent with no key, a window that may be the one it opened is not read as
  // closed on a zero percentage alone.
  if (probe.resetsAtMs === null && shape === 'unused') return true;
  if (nowMs - probe.atMs < QUOTA_SESSION_RETRY_MS) return true;
  // A read from before the message could have shown up decides nothing; the cache can be
  // half an hour old.
  return card.fetchedAtMs === null || card.fetchedAtMs <= probe.atMs;
}

/** What comes back when the answer is yes. */
export interface QuotaSessionStart {
  /** The line of evidence to put in the event. */
  why: string;
  /** The record of having sent it, passed straight into the next decision. */
  probe: QuotaSessionProbe;
}

/** Whether to open the session window now, or null for no.
 *
 *  With no card, or a card whose windows could not be read at all, nothing is decided: an
 *  unreadable window and a closed one are indistinguishable, and **the answer when it is
 *  unknown is no**. */
export function quotaSessionToStart(
  cards: readonly QuotaCard[],
  probe: QuotaSessionProbe | null,
  nowMs: number,
): QuotaSessionStart | null {
  const card = cards.find(c => c.label === CLAUDE_LABEL);
  if (card === undefined || card.windows.length === 0) return null;
  const window = sessionWindow(card);
  const shape = closedShape(window, nowMs);
  if (shape === null) return null;
  if (probe !== null && alreadyProbed(probe, card, window, shape, nowMs)) return null;
  return { why: whyClosed(shape, window, nowMs), probe: { resetsAtMs: window?.resetsAtMs ?? null, atMs: nowMs } };
}
