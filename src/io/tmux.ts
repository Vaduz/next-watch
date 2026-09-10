/** Talking to **tmux**. The decisions all live in `core/tmuxPanes.ts`; this only runs the
 *  commands.
 *
 *  Reading the pane list is synchronous because it is called from the once-a-second look at the
 *  machine; typing into a pane is asynchronous because it is called from the screen, which must
 *  not stop while a key is being sent.
 *
 *  ⚠️ **tmux not being there is an ordinary situation.** Most people run the watcher in a plain
 *  terminal, so a failure returns an empty list without a word. It also stops asking for a
 *  while (`FAILURE_TTL_MS`): retrying every second would spawn a process a second, forever, on
 *  a machine that has no tmux at all.
 *
 *  ⚠️ The watcher does **not** have to be inside tmux itself. `-t %3` names a pane by id, so
 *  reaching the same user's default server is enough; `$TMUX` is not needed. */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { parseTmuxPanes, TMUX_PANE_FORMAT, type TmuxPane } from '../core/tmuxPanes.js';

const execFileAsync = promisify(execFile);

/** How long to stay quiet after a failure before asking tmux again. */
const FAILURE_TTL_MS = 60_000;

/** tmux is a local process, so a short wait is enough: not answering is the same as absent. */
const TMUX_TIMEOUT_MS = 2_000;

let quietUntilMs = 0;

/** Every pane there is, or none when tmux is not answering (see the file's note). */
export function tmuxPanes(nowMs: number = Date.now()): TmuxPane[] {
  if (nowMs < quietUntilMs) return [];
  try {
    const stdout = execFileSync('tmux', ['list-panes', '-a', '-F', TMUX_PANE_FORMAT], {
      encoding: 'utf-8',
      timeout: TMUX_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseTmuxPanes(stdout);
  } catch {
    quietUntilMs = nowMs + FAILURE_TTL_MS;
    return [];
  }
}

/** One pane as it is now, or null when it is gone. */
export async function tmuxPane(paneId: string): Promise<TmuxPane | null> {
  try {
    const { stdout } = await execFileAsync('tmux', ['display-message', '-p', '-t', paneId, TMUX_PANE_FORMAT], {
      timeout: TMUX_TIMEOUT_MS,
    });
    return parseTmuxPanes(stdout)[0] ?? null;
  } catch {
    return null;
  }
}

/** **Type** one line into a pane, the way a person at that keyboard would.
 *
 *  The text goes with `-l` (literal). `send-keys` reads names like `Enter` and `C-c`, so a
 *  command sent plainly would have parts of itself eaten as key names. The newline is sent
 *  separately.
 *
 *  ⚠️ **Not typing into a pane with something running in the foreground** is the caller's
 *  responsibility (check `paneIsIdle` first). */
export async function tmuxTypeLine(paneId: string, line: string): Promise<void> {
  await execFileAsync('tmux', ['send-keys', '-t', paneId, '-l', line], { timeout: TMUX_TIMEOUT_MS });
  await execFileAsync('tmux', ['send-keys', '-t', paneId, 'Enter'], { timeout: TMUX_TIMEOUT_MS });
}
