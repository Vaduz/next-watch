/** **The line under each service row**: which mode is on for that CLI, and what it is waiting
 *  for. The drawing half of `quotaSession.ts`, which is the deciding half.
 *
 *  It is drawn for **every** CLI, off included, because a setting that spends something is worth
 *  knowing about even where it is off. */
import { QUOTA_SESSION_MAX_FAILURES } from '../core/quota/session.js';
import { QUOTA_SESSION_CLIS, type QuotaSessionCli, type QuotaSessionPlan } from '../core/quota/sessionConfig.js';
import { quotaSessionModeRow } from '../core/quota/sessionMode.js';
import type { QuotaSessionModeRow } from '../core/types.js';
import type { QuotaSessionState, WatchState } from '../core/watchState.js';
import type { ResolvedConfig } from '../config.js';

/** What a CLI nothing has been written down about yet looks like. Not looked at is not the same
 *  as missing, so it is installed until a look says otherwise. */
const UNSEEN: QuotaSessionState = {
  opened: null,
  failures: 0,
  retryAtMs: null,
  lastFailure: null,
  sending: false,
  fired: null,
  sentAtMs: null,
  window: null,
  installed: true,
  saidGaveUp: false,
};

/** The rows drawn under the service section: **one per CLI, always**, because a setting that
 *  spends something is worth knowing about even where it is off. */
export function quotaSessionRows(config: ResolvedConfig, state: WatchState, nowMs: number): QuotaSessionModeRow[] {
  const session = config.providers.quotaSession;
  return QUOTA_SESSION_CLIS.map(cli =>
    rowFor(cli, session?.plans.find(p => p.cli === cli) ?? null, state.quotaSessions[cli] ?? UNSEEN, {
      nowMs,
      offsetMinutes: config.timezoneOffsetMinutes,
    }),
  );
}

/** One CLI's row, from the plan and whatever the last look wrote down about it. */
function rowFor(
  cli: QuotaSessionCli,
  plan: QuotaSessionPlan | null,
  own: QuotaSessionState,
  o: { nowMs: number; offsetMinutes: number },
): QuotaSessionModeRow {
  return quotaSessionModeRow({
    cli,
    at: plan?.at ?? null,
    on: plan !== null,
    installed: own.installed ?? true,
    window: own.window,
    sentAtMs: own.sentAtMs,
    sending: own.sending,
    lastFailure: own.lastFailure,
    retryAtMs: own.retryAtMs,
    gaveUp: own.failures >= QUOTA_SESSION_MAX_FAILURES,
    nowMs: o.nowMs,
    offsetMinutes: o.offsetMinutes,
  });
}
