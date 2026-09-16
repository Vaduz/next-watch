/** **Opening a closed five-hour quota window**, and saying who will open the next one.
 *
 *  A window opens with its first message and closes five hours later, so time spent with it
 *  closed comes straight off the number of windows a day holds. Two ways of dealing with that:
 *
 *   - **automatic** (`quotaSession: true`) — open one whenever it is found closed, which keeps
 *     one running around the clock.
 *   - **scheduled** (`quotaSession: { at: [...] }`) — open one only at the listed times, and
 *     leave a closed window closed in between. A window opened at 04:00 is spent by the time
 *     the day starts, which is the whole reason the schedule exists.
 *
 *  ⚠️ **It does not wait** (that would stop the git watch for seconds), and it says what it is
 *  about to do first, so the log holds what it saw.
 *
 *  Whether to open one is decided in `core/quota/`, which is pure. This reads the clock and the
 *  quota, and sends.
 *
 *  ⚠️ **This runs every second**, not once per git interval: `--interval` is how often the
 *  remote is checked, and a schedule whose resolution depended on it would fire an hour late on
 *  a watch with a long interval. Reading the quota costs nothing at that rate — it goes through
 *  the same one-minute cache the panel reads. */
import { CLAUDE_LABEL, quotaSessionOpen, quotaSessionToStart, sessionWindowOf } from '../core/quota/session.js';
import { armSchedule, formatScheduleTime, nextScheduleTime, scheduleTick } from '../core/quota/schedule.js';
import { quotaSessionModeRow } from '../core/quota/sessionMode.js';
import { minuteOfDayAt } from '../core/term/index.js';
import type { QuotaCard, QuotaSessionModeRow } from '../core/types.js';
import type { WatchState } from '../core/watchState.js';
import { startQuotaSession } from './actions/quota.js';
import type { Emit } from './actions/stream.js';
import type { Mark } from '../core/term/index.js';
import type { WatchClock } from '../core/view/index.js';
import type { ResolvedConfig } from '../config.js';

/** The CLI whose window this opens. Codex has a five-hour window too, but nothing here sends to
 *  it yet; when it does, everything below takes the CLI as an argument. */
const CLI = 'claude';

/** Only what this needs of the screen: a row in the log, and the watch's clock. `WatchScreen`
 *  satisfies it, and a test can watch what was said without owning a terminal. */
export interface QuotaSessionScreen {
  event: (atMs: number, mark: Mark, text: string) => void;
  clock: WatchClock;
}

/** How a session is actually started. The real one is `startQuotaSession`; a test passes its
 *  own, because nothing in a test run may reach the network or spend a message. */
export type SendQuotaSession = (cwd: string, emit: Emit) => void;

/** The knobs that are not the watcher's own state: the two `--dry-run` and the clock, and the
 *  sender. All of them have the answer the watch itself gives. */
export interface QuotaSessionOptions {
  dryRun?: boolean;
  nowMs?: number;
  send?: SendQuotaSession;
}

/** Return a fallback rather than throwing: an unreadable quota must not stop the watch. */
async function safely<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

/** Look at the quota and act on it. Does nothing at all when the switch is off. */
export async function maybeStartQuotaSession(
  config: ResolvedConfig,
  state: WatchState,
  screen: QuotaSessionScreen,
  emit: Emit,
  options: QuotaSessionOptions = {},
): Promise<void> {
  const session = config.providers.quotaSession;
  if (session === null) return;
  // ⚠️ Not awaited. Waiting for a message to come back would stop the git watch for as long as
  // it took, and the whole point is that this happens in the background.
  const {
    dryRun = false,
    nowMs = Date.now(),
    send = (cwd: string, e: Emit) => void startQuotaSession(cwd, e),
  } = options;
  // Not being able to read the quota is the same as any other section failing: carry on.
  const cards = await safely<QuotaCard[] | null>(() => session.read(), null);
  if (cards === null) return;
  const window = sessionWindowOf(cards, CLAUDE_LABEL);
  // Null stays null: a card that could not be read and a window that is shut look the same to
  // the reader, and the line under the service row says nothing rather than something wrong.
  state.quotaSchedule.window =
    window === null ? null : { open: quotaSessionOpen(window, nowMs), closesAtMs: window.resetsAtMs };
  if (session.at === null) {
    automatic(state, screen, emit, { cards, nowMs, dryRun, send, cwd: session.cwd });
    return;
  }
  scheduled(config, state, screen, emit, { at: session.at, nowMs, dryRun, send, cwd: session.cwd });
}

/** Open it whenever it is closed. Two never run at once because the window it sent to is
 *  remembered **before** sending, and the decision refuses a window twice. */
function automatic(
  state: WatchState,
  screen: QuotaSessionScreen,
  emit: Emit,
  o: { cards: readonly QuotaCard[]; nowMs: number; dryRun: boolean; send: SendQuotaSession; cwd: string },
): void {
  const start = quotaSessionToStart(o.cards, state.quotaSession, o.nowMs);
  if (start === null) return;
  // ⚠️ `--dry-run` is the promise that this run changes nothing, and a message that opens a
  // usage window is the one thing here that spends something. The probe is still written, so
  // the line is not repeated every second for as long as the window stays shut.
  if (o.dryRun) {
    if (state.quotaSession === null) screen.event(o.nowMs, 'info', `(dry-run) would open the Claude quota window`);
    state.quotaSession = start.probe;
    return;
  }
  screen.event(o.nowMs, 'prompt', `Claude quota session is closed (${start.why}), opening it with claude -p "hi" ...`);
  state.quotaSession = start.probe;
  state.quotaSchedule.sentAtMs = o.nowMs;
  o.send(o.cwd, emit);
}

/** Open one only at the listed times. */
function scheduled(
  config: ResolvedConfig,
  state: WatchState,
  screen: QuotaSessionScreen,
  emit: Emit,
  o: { at: readonly number[]; nowMs: number; dryRun: boolean; send: SendQuotaSession; cwd: string },
): void {
  const offsetMinutes = config.timezoneOffsetMinutes;
  const arming = state.quotaSchedule.fired === null;
  state.quotaSchedule.fired ??= armSchedule(o.at, o.nowMs, offsetMinutes);
  // With no window to read, the listed time still fires: a schedule is an instruction, and the
  // cost of being wrong is one message, where the cost of skipping is the day's window.
  const action = scheduleTick({
    at: o.at,
    fired: state.quotaSchedule.fired,
    nowMs: o.nowMs,
    offsetMinutes,
    windowOpen: state.quotaSchedule.window?.open ?? false,
  });
  // Said once at startup, and again after each firing, so the log always holds the answer to
  // "when will it next send something" — but not twice for a startup that fires straight away.
  if (action.kind === 'idle') {
    if (arming) sayNext(screen, o.at, o.nowMs, offsetMinutes);
    return;
  }
  state.quotaSchedule.fired = action.fired;
  const at = formatScheduleTime(action.at);
  if (action.kind === 'skip') {
    // A message cannot reset an open window, so sending one would only spend it.
    const closes = state.quotaSchedule.window?.closesAtMs ?? null;
    const until = closes === null ? '' : ` until ${screen.clock.hourMinute(closes)}`;
    screen.event(o.nowMs, 'info', `quota: ${at} — window already open${until}, nothing sent`);
  } else if (o.dryRun) {
    screen.event(o.nowMs, 'info', `(dry-run) would open the Claude quota window for ${at}`);
  } else {
    screen.event(o.nowMs, 'prompt', `quota: ${at} — opening the window with claude -p "hi" ...`);
    state.quotaSchedule.sentAtMs = o.nowMs;
    o.send(o.cwd, emit);
  }
  sayNext(screen, o.at, o.nowMs, offsetMinutes);
}

/** Say when the next one is due.
 *
 *  A time that is not still ahead today is tomorrow's, and the line says so: with one time a day
 *  listed, firing at 11:56 and then reading "next scheduled session 11:56" looks like a mistake
 *  rather than like tomorrow. */
function sayNext(screen: QuotaSessionScreen, at: readonly number[], nowMs: number, offsetMinutes: number): void {
  const next = nextScheduleTime(at, nowMs, offsetMinutes);
  if (next === null) return;
  const when = next <= minuteOfDayAt(nowMs, offsetMinutes) ? ' (tomorrow)' : '';
  screen.event(nowMs, 'info', `quota: next scheduled session ${formatScheduleTime(next)}${when}`);
}

/** The rows drawn under the service section: one per CLI the watcher can open a window for. */
export function quotaSessionRows(config: ResolvedConfig, state: WatchState, nowMs: number): QuotaSessionModeRow[] {
  const session = config.providers.quotaSession;
  return [
    quotaSessionModeRow({
      cli: CLI,
      at: session?.at ?? null,
      on: session !== null,
      window: state.quotaSchedule.window,
      sentAtMs: state.quotaSchedule.sentAtMs,
      nowMs,
      offsetMinutes: config.timezoneOffsetMinutes,
    }),
  ];
}
