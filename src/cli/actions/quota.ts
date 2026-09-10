/** The one thing the watcher does on its own initiative: **open a closed five-hour quota
 *  window**.
 *
 *  Whether to is decided in `core/quota/session.ts`, which is pure. This only sends it. */
import { mkdirSync } from 'node:fs';
import { streamCommand, type Emit } from './stream.js';

/** One message is all this is, so a short wait is enough. Giving up costs nothing — the quota is
 *  read again on the next pass. */
const QUOTA_SESSION_TIMEOUT_MS = 2 * 60_000;

/** What is sent. **The content is beside the point** — the window opening is the point — so it
 *  is the shortest thing there is. */
const PROMPT = 'hi';

/** Send `claude -p "hi"` once. **Does not throw**: a failure becomes an event and the watch
 *  carries on.
 *
 *  The `cwd` is an empty sandbox. Started inside a repository, the instructions that repository
 *  gives an agent would all be read into the context of a message whose only purpose is to
 *  exist, and one message meant to cost nothing would cost tens of thousands of tokens. */
export async function startQuotaSession(cwd: string, emit: Emit): Promise<void> {
  const startedAtMs = Date.now();
  const took = (): string => `${((Date.now() - startedAtMs) / 1000).toFixed(1)}s`;
  try {
    // The sandbox is made here rather than when the config is read: resolving a config should
    // not leave directories behind on a machine that never starts the watch.
    mkdirSync(cwd, { recursive: true });
    const result = await streamCommand({
      command: 'claude',
      args: ['-p', PROMPT],
      timeoutMs: QUOTA_SESSION_TIMEOUT_MS,
      emit,
      cwd,
    });
    if (result.ok) emit('step', `claude -p "${PROMPT}" done ${took()}`);
    else emit('error', `claude -p "${PROMPT}" failed ${took()}: ${result.detail ?? 'unknown error'}`);
  } catch (err) {
    emit('error', `claude -p "${PROMPT}" failed ${took()}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
