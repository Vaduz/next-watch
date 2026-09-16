/** **Sending the message, and remembering how it went.** The bookkeeping half of
 *  `quotaSession.ts`, which is the deciding half.
 *
 *  Why it is worth any bookkeeping at all: a send that **works** must never be repeated — four
 *  messages went into one window overnight before this — and a send that **fails** must be tried
 *  again, but not for ever. The two are told apart by the sender's own answer, so the decision
 *  never has to guess from the quota figures, which are cached and lag behind. */
import { QUOTA_SESSION_MAX_FAILURES, QUOTA_SESSION_RETRY_MS, QUOTA_WINDOW_MS } from '../core/quota/session.js';
import type { QuotaSessionCli } from '../core/quota/sessionConfig.js';
import type { QuotaSessionState } from '../core/watchState.js';
import type { SendQuotaSession } from './quotaSession.js';
import type { Emit } from './actions/stream.js';
import type { Mark } from '../core/term/index.js';

/** What sending needs of the look it happens inside. */
export interface QuotaSendLook {
  screen: { event: (atMs: number, mark: Mark, text: string) => void };
  emit: Emit;
  nowMs: number;
  send: SendQuotaSession;
  cwd: string;
}

/** Forget a run of failures. Called when a window reads open: whatever was wrong, something
 *  opened one, and the count exists to stop a broken CLI being run once a second, not to
 *  remember it for the rest of the day. */
export function forgetFailures(own: QuotaSessionState): void {
  own.failures = 0;
  own.retryAtMs = null;
  own.saidGaveUp = false;
}

/** Send, and write down how it went.
 *
 *  ⚠️ **Not awaited by the caller.** Waiting for a message to come back would stop the git watch
 *  for as long as it took. `sending` is what keeps a second attempt from starting in the
 *  meantime, and it is also the only thing that puts `sending` on the screen. */
export function sendAndRecord(cli: QuotaSessionCli, own: QuotaSessionState, o: QuotaSendLook): void {
  own.sending = true;
  own.sentAtMs = o.nowMs;
  void o.send(cli, o.cwd, o.emit).then(
    result => {
      own.sending = false;
      if (result.ok) {
        // The window is believed from the clock, not from the figures: those are cached for up
        // to a minute and the endpoint lags, and sending again in that gap is the whole bug.
        own.opened = { atMs: o.nowMs, resetsAtMs: o.nowMs + QUOTA_WINDOW_MS };
        forgetFailures(own);
        own.lastFailure = null;
        return;
      }
      noteFailure(cli, own, result.detail, o);
    },
    (err: unknown) => {
      own.sending = false;
      noteFailure(cli, own, err instanceof Error ? err.message : String(err), o);
    },
  );
}

/** Write down a failed attempt, and say once when there will be no more of them.
 *
 *  Timed from **when the attempt started**, not from when its answer came back: the watch's
 *  clock is passed in everywhere else, and reading the real one here would put a row in the
 *  event log that disagrees with the one above it. */
function noteFailure(cli: QuotaSessionCli, own: QuotaSessionState, detail: string | null, o: QuotaSendLook): void {
  const atMs = o.nowMs;
  own.failures += 1;
  own.lastFailure = { atMs, detail: detail ?? 'unknown error' };
  const capped = own.failures >= QUOTA_SESSION_MAX_FAILURES;
  own.retryAtMs = capped ? null : atMs + QUOTA_SESSION_RETRY_MS;
  // ⚠️ Said once. The failure itself is already one line per attempt; this is the line that
  // explains the silence that follows it.
  if (capped && !own.saidGaveUp) {
    own.saidGaveUp = true;
    o.screen.event(
      atMs,
      'warn',
      `quota: ${cli} failed ${String(own.failures)} times, nothing more until a window opens`,
    );
  }
}
