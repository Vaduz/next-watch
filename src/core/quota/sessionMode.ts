/** **The line under a service row** saying how this machine opens that CLI's five-hour window.
 *  Pure formatting: the clock arrives as an argument.
 *
 *  It goes under the service rather than next to the quota figures because the Claude row is
 *  where a person looks for Claude. The quota section answers "how much is left"; this answers
 *  "and who opens the next window", which is a property of this watcher, not of the usage. */
import { QUOTA_SESSION_RETRY_MS } from './session.js';
import { formatScheduleTime, nextScheduleTime, type ScheduledTime } from './schedule.js';
import type { QuotaSessionModeRow } from '../types.js';
import type { WatchClock } from '../view/index.js';

/** Which CLI each built-in service row stands for: a person looks at the Claude row for Claude
 *  and at the OpenAI row for Codex. A `services` entry a host wrote itself has no CLI behind it
 *  and gets no session line. */
const SERVICE_CLI: Readonly<Record<string, string | undefined>> = { Claude: 'claude', OpenAI: 'codex' };

/** The session row belonging to a service row, or null when that service has none. */
export function quotaSessionUnder(
  serviceName: string,
  rows: readonly QuotaSessionModeRow[],
): QuotaSessionModeRow | null {
  const cli = SERVICE_CLI[serviceName];
  if (cli === undefined) return null;
  return rows.find(r => r.cli === cli) ?? null;
}

/** How much of a failure's own words fit. The line has sixty-four columns for everything, and
 *  the verbatim reason is in the event log either way. */
const DETAIL_WIDTH = 12;

/** A failure in as few columns as it can be said in. The two that actually happen get a name;
 *  anything else is cut, because an unknown reason must not decide the width of the line. */
function shortDetail(detail: string): string {
  const exited = /exited with (-?\d+)/.exec(detail);
  if (exited !== null) return `exit ${exited[1]}`;
  if (detail.includes('timed out')) return 'timed out';
  return detail.length <= DETAIL_WIDTH ? detail : `${detail.slice(0, DETAIL_WIDTH - 1)}…`;
}

/** What went wrong last, for either mode.
 *
 *  ⚠️ **This is the difference between a watcher that is working and one that is not.** Before
 *  it, a CLI that failed every attempt showed `sending` for ever, and the only sign of trouble
 *  was in the event log, scrolled away minutes later.
 *
 *  Having given up, the reason is dropped: what the reader needs then is that nothing more will
 *  be tried, and the reason is in the log in full. */
function failureDetail(row: QuotaSessionModeRow, clock: WatchClock): string[] {
  const failure = row.lastFailure ?? null;
  if (failure === null) return [];
  const when = clock.hourMinute(failure.atMs);
  if (row.gaveUp === true) return [`failed ${when}`, 'no more this window'];
  const next = row.retryAtMs == null ? 'retrying' : `retry ${clock.hourMinute(row.retryAtMs)}`;
  return [`failed ${when} (${shortDetail(failure.detail)})`, next];
}

/** What the automatic mode is waiting for. An open window is waiting for it to close, and a
 *  closed one is being opened right now — that is what automatic means. */
function autoDetail(row: QuotaSessionModeRow, clock: WatchClock): string[] {
  if (row.window === null) return [];
  if (row.window.open) {
    const closes = row.window.closesAtMs;
    return [`next refresh when the window closes${closes === null ? '' : ` (${clock.hourMinute(closes)})`}`];
  }
  if (row.sending === true) return ['next refresh now (window closed, sending)'];
  const failed = failureDetail(row, clock);
  return failed.length > 0 ? failed : ['next refresh now (window closed)'];
}

/** What the scheduled mode is waiting for: the next listed time, and for a few minutes after a
 *  firing, the time it sent at.
 *
 *  ⚠️ The `sent` tail is **only** shown here, not in the automatic mode. There, a message is
 *  followed immediately by the window opening, and the new closing time on this same line is a
 *  better report of it; here nothing else on the screen would change, and a line that reads
 *  `next refresh 14:00` alone gives no sign that 09:00 happened. */
function manualDetail(row: QuotaSessionModeRow, nowMs: number, clock: WatchClock): string[] {
  const next = row.nextAtMinutes === null ? [] : [`next refresh ${formatScheduleTime(row.nextAtMinutes)}`];
  // ⚠️ A pending failure **replaces** the next listed time rather than joining it: three facts
  // do not fit in sixty-four columns, and a firing that did not open the window is the more
  // urgent of the two. The next time is written to the event log after every firing anyway.
  const failed = failureDetail(row, clock);
  if (failed.length > 0) return failed;
  const recent = row.sentAtMs !== null && nowMs - row.sentAtMs < QUOTA_SESSION_RETRY_MS;
  return recent && row.sentAtMs !== null ? [...next, `sent ${clock.hourMinute(row.sentAtMs)}`] : next;
}

/** The whole line (`session: manual · next refresh 14:00`). Kept short enough that it fits an
 *  eighty-column terminal once the service section's indent is added. */
export function quotaSessionLine(row: QuotaSessionModeRow, nowMs: number, clock: WatchClock): string {
  const detail =
    row.mode === 'auto' ? autoDetail(row, clock) : row.mode === 'manual' ? manualDetail(row, nowMs, clock) : [];
  const why = row.note === null || row.note === undefined ? '' : ` (${row.note})`;
  return [`session: ${row.mode}${why}`, ...detail].join(' · ');
}

/** Fold what the watcher knows into the row the screen draws. Pure, so the wording and the
 *  arithmetic behind it can both be pinned down as a table. */
export function quotaSessionModeRow(o: {
  cli: string;
  /** The listed times, null for the automatic mode, and the whole thing off when `on` is false. */
  at: readonly ScheduledTime[] | null;
  on: boolean;
  /** Whether the CLI can be run here. A switch that is on for a CLI that is not installed is
   *  off in practice, and the line says which of the two it is. */
  installed?: boolean;
  window: { open: boolean; closesAtMs: number | null } | null;
  sentAtMs: number | null;
  /** True while an attempt is in flight. */
  sending?: boolean;
  lastFailure?: { atMs: number; detail: string } | null;
  retryAtMs?: number | null;
  gaveUp?: boolean;
  nowMs: number;
  offsetMinutes: number;
}): QuotaSessionModeRow {
  const missing = o.installed === false;
  const mode = !o.on || missing ? 'off' : o.at === null ? 'auto' : 'manual';
  return {
    cli: o.cli,
    mode,
    note: missing ? 'not installed' : null,
    nextAtMinutes: mode === 'manual' && o.at !== null ? nextScheduleTime(o.at, o.nowMs, o.offsetMinutes) : null,
    // A switch that is off carries none of it: the line says `session: off` and nothing else,
    // and a stale window or a failure from before it was turned off would read as current.
    ...(mode === 'off' ? OFF : attempt(o)),
  };
}

/** What an `off` row carries, which is nothing at all. */
const OFF = {
  window: null,
  sentAtMs: null,
  sending: false,
  lastFailure: null,
  retryAtMs: null,
  gaveUp: false,
} as const;

/** What a row that is on carries about the window and the last attempt at opening it. */
function attempt(o: {
  window: { open: boolean; closesAtMs: number | null } | null;
  sentAtMs: number | null;
  sending?: boolean;
  lastFailure?: { atMs: number; detail: string } | null;
  retryAtMs?: number | null;
  gaveUp?: boolean;
}): Pick<QuotaSessionModeRow, 'window' | 'sentAtMs' | 'sending' | 'lastFailure' | 'retryAtMs' | 'gaveUp'> {
  return {
    window: o.window,
    sentAtMs: o.sentAtMs,
    sending: o.sending === true,
    lastFailure: o.lastFailure ?? null,
    retryAtMs: o.retryAtMs ?? null,
    gaveUp: o.gaveUp === true,
  };
}
