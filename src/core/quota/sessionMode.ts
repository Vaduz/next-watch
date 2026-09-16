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

/** What the automatic mode is waiting for. An open window is waiting for it to close, and a
 *  closed one is being opened right now — that is what automatic means. */
function autoDetail(row: QuotaSessionModeRow, clock: WatchClock): string[] {
  if (row.window === null) return [];
  if (!row.window.open) return ['next refresh now (window closed, sending)'];
  const closes = row.window.closesAtMs;
  return [`next refresh when the window closes${closes === null ? '' : ` (${clock.hourMinute(closes)})`}`];
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
  nowMs: number;
  offsetMinutes: number;
}): QuotaSessionModeRow {
  const missing = o.installed === false;
  const mode = !o.on || missing ? 'off' : o.at === null ? 'auto' : 'manual';
  return {
    cli: o.cli,
    mode,
    note: missing ? 'not installed' : null,
    window: mode === 'off' ? null : o.window,
    nextAtMinutes: mode === 'manual' && o.at !== null ? nextScheduleTime(o.at, o.nowMs, o.offsetMinutes) : null,
    sentAtMs: mode === 'off' ? null : o.sentAtMs,
  };
}
