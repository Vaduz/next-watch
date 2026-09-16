/** **What `providers.quotaSession` says**, read into one answer per CLI. Pure.
 *
 *  Both agent CLIs have a five-hour window, and a machine running both wants to say different
 *  things about them — open Claude's on a schedule and leave Codex alone, say. So the switch
 *  takes a key per CLI as well as one setting for both:
 *
 *      quotaSession: true                                 // both, whenever closed
 *      quotaSession: { at: ['06:00', '11:00'] }           // both, on that schedule
 *      quotaSession: { claude: true, codex: false }       // one each
 *      quotaSession: { cwd: '...', claude: { at: [...] }, codex: true }
 *
 *  ⚠️ **A key names only that CLI.** `{ claude: false }` leaves Codex on what the outer setting
 *  says, because naming one CLI is a statement about that CLI and not about the other; turning
 *  the other off is what `codex: false` is for. */
import { parseScheduleTimes, type ScheduledTime } from './schedule.js';

/** The CLIs the watcher can open a window for. */
export const QUOTA_SESSION_CLIS = ['claude', 'codex'] as const;

export type QuotaSessionCli = (typeof QUOTA_SESSION_CLIS)[number];

/** The backend each CLI's usage is reported under, which is how its window is found among the
 *  quota cards. */
export const QUOTA_SESSION_LABELS: Readonly<Record<QuotaSessionCli, string>> = {
  claude: 'Claude',
  codex: 'Codex',
};

/** One CLI's own key: on with the automatic mode, off, or on at the listed times. */
export type QuotaSessionCliSwitch = boolean | { at?: readonly string[] };

/** The whole switch, as a config file writes it. */
export type QuotaSessionSwitch =
  | boolean
  | {
      /** Where the session runs. One sandbox for both CLIs. */
      cwd?: string;
      /** The times, for whichever CLI does not name its own. */
      at?: readonly string[];
      claude?: QuotaSessionCliSwitch;
      codex?: QuotaSessionCliSwitch;
    };

/** What one CLI ends up with: the listed times, or null for the automatic mode. Null for the
 *  whole thing means the watcher sends nothing for that CLI. */
export interface QuotaSessionPlan {
  cli: QuotaSessionCli;
  at: readonly ScheduledTime[] | null;
}

/** The times a switch names, already checked. Null when it names none. */
function timesIn(switched: { at?: readonly string[] }, where: string): readonly ScheduledTime[] | null {
  return switched.at === undefined ? null : parseScheduleTimes(switched.at, where);
}

/** What one CLI's setting comes to, or null when it is off.
 *
 *  `where` names the source (the config file's path, or the flag) so a mistyped time says which
 *  of the two the watcher actually read. */
export function quotaSessionPlanFor(
  switched: QuotaSessionSwitch | undefined,
  cli: QuotaSessionCli,
  where: string,
): QuotaSessionPlan | null {
  if (switched === undefined || switched === false) return null;
  if (switched === true) return { cli, at: null };
  const own = switched[cli];
  if (own === false) return null;
  // No key of its own, or one that only says "on": the outer setting decides the times.
  if (own === undefined || own === true) return { cli, at: timesIn(switched, `${where}.at`) };
  const at = timesIn(own, `${where}.${cli}.at`);
  return { cli, at: at ?? timesIn(switched, `${where}.at`) };
}

/** Every CLI that is on, in a fixed order so the screen and the log never reorder themselves. */
export function quotaSessionPlans(switched: QuotaSessionSwitch | undefined, where: string): QuotaSessionPlan[] {
  return QUOTA_SESSION_CLIS.map(cli => quotaSessionPlanFor(switched, cli, where)).filter(
    (p): p is QuotaSessionPlan => p !== null,
  );
}
