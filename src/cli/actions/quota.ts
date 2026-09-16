/** The one thing the watcher does on its own initiative: **open a closed five-hour quota
 *  window**.
 *
 *  Whether to is decided in `core/quota/`, which is pure. This only sends it.
 *
 *  Both agent CLIs have such a window, and each has a way of being given one message without a
 *  terminal: `claude -p "hi"` and `codex exec "hi"`. */
import { mkdirSync } from 'node:fs';
import type { QuotaSessionCli } from '../../core/quota/sessionConfig.js';
import { streamCommand, type Emit } from './stream.js';

/** One message is all this is, so a short wait is enough. Giving up costs nothing — the quota is
 *  read again on the next pass. */
const QUOTA_SESSION_TIMEOUT_MS = 2 * 60_000;

/** What is sent. **The content is beside the point** — the window opening is the point — so it
 *  is the shortest thing there is. */
const PROMPT = 'hi';

/** How each CLI is given one message with nobody at a terminal. **The prompt stays last**:
 *  `quotaSessionCommand` quotes the final argument as the message.
 *
 *  ⚠️ `--skip-git-repo-check` is not optional for Codex 0.154.0. The sandbox is an empty
 *  directory under the temp directory — deliberately not a repository, so that no project's
 *  instructions are read into the context of a message whose only purpose is to exist — and
 *  Codex refuses to run outside a repository without it: `Not inside a trusted directory and
 *  --skip-git-repo-check was not specified.`, exit 1 in a tenth of a second. The alternative,
 *  `git init` in the sandbox, would make the directory a repository only to satisfy a check.
 *
 *  Neither CLI is given a stdin (`streamCommand` opens it on `'ignore'`), so the
 *  `Reading additional input from stdin...` Codex prints is it reaching end of file at once. */
const ARGUMENTS: Readonly<Record<QuotaSessionCli, readonly string[]>> = {
  claude: ['-p', PROMPT],
  codex: ['exec', '--skip-git-repo-check', PROMPT],
};

/** The command line as the log says it, built from the arguments that are actually used so the
 *  two cannot say different things. The prompt is quoted the way a person would type it. */
export function quotaSessionCommand(cli: QuotaSessionCli): string {
  const args = ARGUMENTS[cli];
  return [cli, ...args.slice(0, -1), `"${PROMPT}"`].join(' ');
}

/** Send one message to `cli`, and say **how it went**. **Does not throw**: a failure becomes an
 *  event and the watch carries on, and the caller decides whether another attempt is owed — a
 *  send that worked never is.
 *
 *  The `cwd` is an empty sandbox. Started inside a repository, the instructions that repository
 *  gives an agent would all be read into the context of a message whose only purpose is to
 *  exist, and one message meant to cost nothing would cost tens of thousands of tokens. */
export async function startQuotaSession(
  cli: QuotaSessionCli,
  cwd: string,
  emit: Emit,
): Promise<{ ok: boolean; detail: string | null }> {
  const startedAtMs = Date.now();
  const took = (): string => `${((Date.now() - startedAtMs) / 1000).toFixed(1)}s`;
  const said = quotaSessionCommand(cli);
  try {
    // The sandbox is made here rather than when the config is read: resolving a config should
    // not leave directories behind on a machine that never starts the watch.
    mkdirSync(cwd, { recursive: true });
    const result = await streamCommand({
      command: cli,
      args: [...ARGUMENTS[cli]],
      timeoutMs: QUOTA_SESSION_TIMEOUT_MS,
      emit,
      cwd,
    });
    if (result.ok) emit('step', `${said} done ${took()}`);
    else emit('error', `${said} failed ${took()}: ${result.detail ?? 'unknown error'}`);
    return result;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    emit('error', `${said} failed ${took()}: ${detail}`);
    return { ok: false, detail };
  }
}
