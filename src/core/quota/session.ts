/** Whether the **five-hour session window is open**, and whether to open it. Pure.
 *
 *  The window opens with the first message and closes five hours later. While nobody sends
 *  anything it stays shut, and the next one opens it — so time spent with it closed is
 *  **windows lost from the day's allowance**. A watcher that runs for half a day or more can
 *  notice it is shut and send one message to open it.
 *
 *  ⚠️ **The two backends report a shut window differently**, which is the whole difficulty.
 *  Measured on 2026-09-16 against both:
 *
 *   - **Claude** gives a fixed boundary. A closed window shows a reset time that has passed
 *     (`reset 0min ago`) — or none at all — and an open one shows the boundary it will end at.
 *   - **Codex** gives no boundary until a window is running. With nothing open it reports
 *     `0%` used and a reset time of **exactly five hours from now**, which moves with the clock:
 *     two readings 85 seconds apart came back 85 seconds apart. One message froze it.
 *
 *  So a reset time in the future does **not** mean the window is open, and the usage percentage
 *  says nothing either — one `hi` rounds to 0%. What separates the two is how far ahead the
 *  reset is: a running window ends less than five hours from now, and Codex's "nothing is
 *  running" shape is five hours to the second.
 *
 *  ⚠️ No filesystem, no process, no clock. The current time is passed in. */
import type { QuotaCard, QuotaWindowView } from '../types.js';

/** The name of the session window, kept as a copy so this module needs no io import. */
const SESSION_WINDOW_NAME = '5h';

/** How long a window lasts once it is open. The name of the window is the length. */
export const QUOTA_WINDOW_MS = 5 * 60 * 60_000;

/** How close to a full window a reset time may be and still count as "no window running".
 *
 *  ⚠️ Measured rather than guessed: Codex's reset came back 1.6 seconds short of five hours from
 *  the moment the answer was received, which is the round trip. Thirty seconds covers that and a
 *  clock that disagrees with the server's by a few, and is far short of anything a running
 *  window looks like — a window opened half a minute ago is the only thing this can mistake, and
 *  the record of what this watch opened covers exactly that case. */
const NOT_STARTED_TOLERANCE_MS = 30_000;

/** The shortest gap before trying again **after a send that failed**. A send that worked is
 *  never retried: the window it opened is remembered instead. */
export const QUOTA_SESSION_RETRY_MS = 10 * 60_000;

/** How many failures in a row before giving up until the window changes. Ten minutes apart, so
 *  this is half an hour of trying; a CLI that has failed three times is not going to work on the
 *  fourth, and the log would fill with it for the rest of the day. */
export const QUOTA_SESSION_MAX_FAILURES = 3;

/** The **shape** in which it looked closed, which becomes the reason in the event. */
export type ClosedShape = 'missing' | 'no-reset' | 'reset-passed' | 'not-started';

/** The record of a window **this watch opened**.
 *
 *  ⚠️ It does not wait for the quota to agree. The figures are cached for up to a minute and the
 *  endpoint itself lags, so for a while after a message the window still reads as shut; sending
 *  again then is exactly the bug this exists to prevent. `resetsAtMs` starts as the clock says —
 *  five hours from the send — and a reading is believed over it only once one shows a window
 *  that is genuinely running. */
export interface OpenedWindow {
  /** When the message that opened it was sent. */
  atMs: number;
  /** When that window ends. */
  resetsAtMs: number;
}

/** The shape in which a window looks closed, or null when it is open.
 *
 *  `fetchedAtMs` is when the figures were read, which is what the reset time is relative to.
 *  Passing `nowMs` for it would read a minute-old cache as a window that has already run for a
 *  minute. */
export function closedShape(
  window: QuotaWindowView | null,
  nowMs: number,
  fetchedAtMs: number | null,
): ClosedShape | null {
  if (window === null) return 'missing';
  if (window.resetsAtMs === null) return 'no-reset';
  if (window.resetsAtMs <= nowMs) return 'reset-passed';
  // Five hours to the second ahead of the moment it was read: nothing is running yet.
  if (window.resetsAtMs - (fetchedAtMs ?? nowMs) >= QUOTA_WINDOW_MS - NOT_STARTED_TOLERANCE_MS) return 'not-started';
  return null;
}

/** Whether the window is open: the figures say so, **or** this watch opened one that has not
 *  ended yet and the figures have not caught up. */
export function quotaSessionOpen(o: {
  window: QuotaWindowView | null;
  nowMs: number;
  fetchedAtMs: number | null;
  opened: OpenedWindow | null;
}): boolean {
  if (closedShape(o.window, o.nowMs, o.fetchedAtMs) === null) return true;
  return o.opened !== null && o.opened.resetsAtMs > o.nowMs;
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

/** When the figures behind a backend's card were read, or null where it has no card. */
export function sessionFetchedAt(cards: readonly QuotaCard[], label: string): number | null {
  return cards.find(c => c.label === label)?.fetchedAtMs ?? null;
}

/** One line of **evidence** for reading it as closed, kept in the event log so that a decision
 *  nobody was there to watch can be checked afterwards. */
function whyClosed(shape: ClosedShape, window: QuotaWindowView | null, nowMs: number): string {
  if (window === null) return `no ${SESSION_WINDOW_NAME} window in the quota`;
  const used = `${Math.round(window.usedPercent)}% used`;
  if (shape === 'no-reset') return `${SESSION_WINDOW_NAME} window has no reset time, ${used}`;
  if (shape === 'not-started') return `${SESSION_WINDOW_NAME} window has not started, ${used}`;
  const minutes = Math.round((nowMs - (window.resetsAtMs ?? nowMs)) / 60_000);
  return `${SESSION_WINDOW_NAME} window reset ${minutes}min ago, ${used}`;
}

/** What the watcher has done about one CLI so far, as the decision needs it. */
export interface QuotaSessionHistory {
  /** The window this watch opened, or null when it has opened none that is still running. */
  opened: OpenedWindow | null;
  /** Failures in a row. Reset by a window that reads open, whoever opened it. */
  failures: number;
  /** When the next attempt after a failure is due, or null when none is owed. */
  retryAtMs: number | null;
  /** True while an attempt is in flight. Nothing is decided while one is. */
  sending: boolean;
}

/** What comes back when the answer is yes. */
export interface QuotaSessionStart {
  /** The line of evidence to put in the event. */
  why: string;
  /** What to remember **if the send works**, so the same window is never opened twice. */
  opened: OpenedWindow;
}

/** Whether to open the session window now, or null for no. `label` is the backend whose window
 *  it is (`Claude`, `Codex`), so one decision serves both CLIs.
 *
 *  With no card, or a card whose windows could not be read at all, nothing is decided: an
 *  unreadable window and a closed one are indistinguishable, and **the answer when it is
 *  unknown is no**. */
export function quotaSessionToStart(o: {
  cards: readonly QuotaCard[];
  label: string;
  nowMs: number;
  history: QuotaSessionHistory;
}): QuotaSessionStart | null {
  const card = o.cards.find(c => c.label === o.label);
  if (card === undefined || card.windows.length === 0) return null;
  const { history } = o;
  if (history.sending) return null;
  const window = sessionWindow(card);
  const shape = closedShape(window, o.nowMs, card.fetchedAtMs);
  if (shape === null) return null;
  // One send per window, by construction: what this watch opened is believed before the figures.
  if (history.opened !== null && history.opened.resetsAtMs > o.nowMs) return null;
  if (history.failures >= QUOTA_SESSION_MAX_FAILURES) return null;
  if (history.retryAtMs !== null && o.nowMs < history.retryAtMs) return null;
  return { why: whyClosed(shape, window, o.nowMs), opened: { atMs: o.nowMs, resetsAtMs: o.nowMs + QUOTA_WINDOW_MS } };
}
