/** **Opening a closed five-hour quota window**, and saying who will open the next one.
 *
 *  A window opens with its first message and closes five hours later, so time spent with it
 *  closed comes straight off the number of windows a day holds. Two ways of dealing with that,
 *  chosen per CLI:
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
 *  Whether to open one is decided in `core/quota/`, which is pure and takes the window's state
 *  as an argument, so the same decision serves both CLIs. This reads the clock and the quota,
 *  and sends.
 *
 *  ⚠️ **This runs every second**, not once per git interval: `--interval` is how often the
 *  remote is checked, and a schedule whose resolution depended on it would fire an hour late on
 *  a watch with a long interval. Reading the quota costs nothing at that rate — it goes through
 *  the same one-minute cache the panel reads. */
import { quotaSessionOpen, quotaSessionToStart, sessionWindowOf } from '../core/quota/session.js';
import { armSchedule, formatScheduleTime, nextScheduleTime, scheduleTick } from '../core/quota/schedule.js';
import {
  QUOTA_SESSION_CLIS,
  QUOTA_SESSION_LABELS,
  type QuotaSessionCli,
  type QuotaSessionPlan,
} from '../core/quota/sessionConfig.js';
import { quotaSessionModeRow } from '../core/quota/sessionMode.js';
import { minuteOfDayAt } from '../core/term/index.js';
import type { QuotaCard, QuotaSessionModeRow } from '../core/types.js';
import type { QuotaSessionState, WatchState } from '../core/watchState.js';
import { quotaSessionCommand, startQuotaSession } from './actions/quota.js';
import { commandInstalled } from '../io/installed.js';
import type { Emit } from './actions/stream.js';
import type { Mark } from '../core/term/index.js';
import type { WatchClock } from '../core/view/index.js';
import type { ResolvedConfig } from '../config.js';

/** Only what this needs of the screen: a row in the log, and the watch's clock. `WatchScreen`
 *  satisfies it, and a test can watch what was said without owning a terminal. */
export interface QuotaSessionScreen {
  event: (atMs: number, mark: Mark, text: string) => void;
  clock: WatchClock;
}

/** How a session is actually started. The real one is `startQuotaSession`; a test passes its
 *  own, because nothing in a test run may reach the network or spend a message. */
export type SendQuotaSession = (cli: QuotaSessionCli, cwd: string, emit: Emit) => void;

/** The knobs that are not the watcher's own state: `--dry-run`, the clock, the sender, and
 *  whether a CLI is installed. All of them have the answer the watch itself gives. */
export interface QuotaSessionOptions {
  dryRun?: boolean;
  nowMs?: number;
  send?: SendQuotaSession;
  installed?: (command: string) => boolean;
}

/** Return a fallback rather than throwing: an unreadable quota must not stop the watch. */
async function safely<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

/** What has been done about this CLI so far, created on the first look at it. */
function stateFor(state: WatchState, cli: QuotaSessionCli): QuotaSessionState {
  const found = state.quotaSessions[cli];
  if (found !== undefined) return found;
  const fresh: QuotaSessionState = { probe: null, fired: null, sentAtMs: null, window: null, installed: null };
  state.quotaSessions[cli] = fresh;
  return fresh;
}

/** Everything one look at one CLI needs. */
interface Look {
  state: WatchState;
  screen: QuotaSessionScreen;
  emit: Emit;
  cards: readonly QuotaCard[];
  nowMs: number;
  offsetMinutes: number;
  dryRun: boolean;
  send: SendQuotaSession;
  installed: (command: string) => boolean;
  cwd: string;
}

/** Look at the quota and act on it, for every CLI the switch is on for. Does nothing at all
 *  when it is off for all of them. */
export async function maybeStartQuotaSession(
  config: ResolvedConfig,
  state: WatchState,
  screen: QuotaSessionScreen,
  emit: Emit,
  options: QuotaSessionOptions = {},
): Promise<void> {
  const session = config.providers.quotaSession;
  if (session === null) return;
  // ⚠️ The send is not awaited. Waiting for a message to come back would stop the git watch for
  // as long as it took, and the whole point is that this happens in the background.
  const {
    dryRun = false,
    nowMs = Date.now(),
    send = (cli: QuotaSessionCli, cwd: string, e: Emit) => void startQuotaSession(cli, cwd, e),
    installed = commandInstalled,
  } = options;
  // Not being able to read the quota is the same as any other section failing: carry on.
  const cards = await safely<QuotaCard[] | null>(() => session.read(), null);
  if (cards === null) return;
  const look: Look = {
    state,
    screen,
    emit,
    cards,
    nowMs,
    offsetMinutes: config.timezoneOffsetMinutes,
    dryRun,
    send,
    installed,
    cwd: session.cwd,
  };
  for (const plan of session.plans) lookAt(plan, look);
}

/** One CLI, one look. */
function lookAt(plan: QuotaSessionPlan, o: Look): void {
  const own = stateFor(o.state, plan.cli);
  const window = sessionWindowOf(o.cards, QUOTA_SESSION_LABELS[plan.cli]);
  // Null stays null: a card that could not be read and a window that is shut look the same to
  // the reader, and the line under the service row says nothing rather than something wrong.
  own.window = window === null ? null : { open: quotaSessionOpen(window, o.nowMs), closesAtMs: window.resetsAtMs };
  if (own.installed === null) {
    own.installed = o.installed(plan.cli);
    // ⚠️ Said once and then let go. A machine with only one of the two CLIs is ordinary, and a
    // line about it every second would bury everything else.
    if (!own.installed) o.screen.event(o.nowMs, 'info', `quota: ${plan.cli} not installed, no session for it`);
  }
  if (!own.installed) return;
  if (plan.at === null) automatic(plan.cli, own, o);
  else scheduled(plan.cli, plan.at, own, o);
}

/** Open it whenever it is closed. Two never run at once because the window it sent to is
 *  remembered **before** sending, and the decision refuses a window twice. */
function automatic(cli: QuotaSessionCli, own: QuotaSessionState, o: Look): void {
  const start = quotaSessionToStart(o.cards, own.probe, o.nowMs, QUOTA_SESSION_LABELS[cli]);
  if (start === null) return;
  // ⚠️ `--dry-run` is the promise that this run changes nothing, and a message that opens a
  // usage window is the one thing here that spends something. The probe is still written, so
  // the line is not repeated every second for as long as the window stays shut.
  if (o.dryRun) {
    if (own.probe === null) o.screen.event(o.nowMs, 'info', `(dry-run) would open the ${cli} quota window`);
    own.probe = start.probe;
    return;
  }
  const said = quotaSessionCommand(cli);
  const label = QUOTA_SESSION_LABELS[cli];
  o.screen.event(o.nowMs, 'prompt', `${label} quota session is closed (${start.why}), opening it with ${said} ...`);
  own.probe = start.probe;
  own.sentAtMs = o.nowMs;
  o.send(cli, o.cwd, o.emit);
}

/** Open one only at the listed times. */
function scheduled(cli: QuotaSessionCli, at: readonly number[], own: QuotaSessionState, o: Look): void {
  const arming = own.fired === null;
  own.fired ??= armSchedule(at, o.nowMs, o.offsetMinutes);
  // With no window to read, the listed time still fires: a schedule is an instruction, and the
  // cost of being wrong is one message, where the cost of skipping is the day's window.
  const action = scheduleTick({
    at,
    fired: own.fired,
    nowMs: o.nowMs,
    offsetMinutes: o.offsetMinutes,
    windowOpen: own.window?.open ?? false,
  });
  // Said once at startup, and again after each firing, so the log always holds the answer to
  // "when will it next send something" — but not twice for a startup that fires straight away.
  if (action.kind === 'idle') {
    if (arming) sayNext(cli, at, o);
    return;
  }
  own.fired = action.fired;
  const when = formatScheduleTime(action.at);
  if (action.kind === 'skip') {
    // A message cannot reset an open window, so sending one would only spend it.
    const closes = own.window?.closesAtMs ?? null;
    const until = closes === null ? '' : ` until ${o.screen.clock.hourMinute(closes)}`;
    o.screen.event(o.nowMs, 'info', `quota: ${cli} ${when} — window already open${until}, nothing sent`);
  } else if (o.dryRun) {
    o.screen.event(o.nowMs, 'info', `(dry-run) would open the ${cli} quota window for ${when}`);
  } else {
    o.screen.event(
      o.nowMs,
      'prompt',
      `quota: ${cli} ${when} — opening the window with ${quotaSessionCommand(cli)} ...`,
    );
    own.sentAtMs = o.nowMs;
    o.send(cli, o.cwd, o.emit);
  }
  sayNext(cli, at, o);
}

/** Say when the next one is due.
 *
 *  A time that is not still ahead today is tomorrow's, and the line says so: with one time a day
 *  listed, firing at 11:56 and then reading "next scheduled session 11:56" looks like a mistake
 *  rather than like tomorrow. */
function sayNext(cli: QuotaSessionCli, at: readonly number[], o: Look): void {
  const next = nextScheduleTime(at, o.nowMs, o.offsetMinutes);
  if (next === null) return;
  const day = next <= minuteOfDayAt(o.nowMs, o.offsetMinutes) ? ' (tomorrow)' : '';
  o.screen.event(o.nowMs, 'info', `quota: ${cli} next scheduled session ${formatScheduleTime(next)}${day}`);
}

/** The rows drawn under the service section: **one per CLI, always**, because a setting that
 *  spends something is worth knowing about even where it is off. */
export function quotaSessionRows(config: ResolvedConfig, state: WatchState, nowMs: number): QuotaSessionModeRow[] {
  const session = config.providers.quotaSession;
  return QUOTA_SESSION_CLIS.map(cli => {
    const plan = session?.plans.find(p => p.cli === cli) ?? null;
    const own = state.quotaSessions[cli];
    return quotaSessionModeRow({
      cli,
      at: plan?.at ?? null,
      on: plan !== null,
      // Not looked at yet is not the same as missing, so nothing is said until it has been.
      installed: own?.installed ?? true,
      window: own?.window ?? null,
      sentAtMs: own?.sentAtMs ?? null,
      nowMs,
      offsetMinutes: config.timezoneOffsetMinutes,
    });
  });
}
