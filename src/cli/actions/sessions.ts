/** The verb that acts on an **agent session inside a tmux pane**. */
import { isAlive, psSnapshot, sendSignal } from '../../io/processes.js';
import { sleep } from '../../core/util.js';
import { tmuxPane, tmuxTypeLine } from '../../io/tmux.js';
import { paneIsIdle, restartablePane } from '../../core/tmuxPanes.js';
import type { WatchTarget } from '../../core/watchTargets.js';
import { type ActionContext } from './stream.js';

/** How long to wait for a session to finish after SIGTERM. If it will not, it is **left
 *  running**. Escalating to SIGKILL is wrong here: there is a person at that terminal, and a
 *  restart that failed leaving the session alive beats one that took their work with it. */
const SESSION_EXIT_TIMEOUT_MS = 20_000;

/** How long to wait afterwards for the pane to come back to a shell prompt. */
const PANE_IDLE_TIMEOUT_MS = 5_000;

const POLL_MS = 200;

/** Wait for a pid to go. The result says **whether it went**. */
async function waitGone(pid: number, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs && isAlive(pid); waited += POLL_MS) await sleep(POLL_MS);
  return !isAlive(pid);
}

/** Wait for the pane to fall back to its root process. The result is **the reason not to type**,
 *  or null when typing is safe.
 *
 *  ⚠️ This is the last gate before anything is typed. Typing into a pane with something still
 *  running in the foreground feeds the command into *that* program's input. */
async function waitPaneIdle(paneId: string, rootCommand: string): Promise<string | null> {
  let last = 'unknown';
  for (let waited = 0; waited < PANE_IDLE_TIMEOUT_MS; waited += POLL_MS) {
    const pane = await tmuxPane(paneId);
    if (pane === null) return `pane ${paneId} is gone`;
    if (paneIsIdle(pane, rootCommand)) return null;
    last = pane.command;
    await sleep(POLL_MS);
  }
  return `pane ${paneId} is still running "${last}" (nothing was typed)`;
}

/** What to check before stopping anything: the pane is still there, and it **survives** the
 *  session ending (if the session is the pane's root, the pane closes with it). The row was
 *  built with the same check, but the shape can change in between, so it is read again. */
async function paneToRestartIn(paneId: string, pid: number): Promise<{ rootCommand: string } | null> {
  const pane = await tmuxPane(paneId);
  if (pane === null) return null;
  return restartablePane([pane], psSnapshot().procs, pid);
}

/** Restart an agent session.
 *
 *  Stop it, wait for its pane to come back to a shell, then **type the resume command the way a
 *  person would**. The pane is not recreated: respawning it would take the shell with it, and
 *  the pane would then close the next time the CLI exited.
 *
 *  ⚠️ **Nothing is typed while it is still alive.** That it stopped is established from the pid,
 *  not from what the screen shows. */
export async function restartSession(target: WatchTarget, ctx: ActionContext): Promise<boolean> {
  const { pid, pane: paneId, resume } = target;
  if (pid === undefined || paneId === undefined || resume === undefined) {
    ctx.emit('warn', `session ${target.id}: no tmux pane or no conversation to resume (not restarting)`);
    return false;
  }
  const found = await paneToRestartIn(paneId, pid);
  if (found === null) {
    ctx.emit('error', `session ${pid}: tmux pane ${paneId} would not survive stopping it (not restarting)`);
    return false;
  }
  ctx.emit('step', `SIGTERM to session ${pid} in pane ${paneId}`);
  sendSignal(pid, 'SIGTERM');
  if (!(await waitGone(pid, SESSION_EXIT_TIMEOUT_MS))) {
    ctx.emit('error', `session ${pid} is still running after SIGTERM (nothing was typed)`);
    return false;
  }
  const blocked = await waitPaneIdle(paneId, found.rootCommand);
  if (blocked !== null) {
    ctx.emit('error', `session ${pid} stopped, but ${blocked}`);
    return false;
  }
  await tmuxTypeLine(paneId, resume);
  ctx.emit('step', `typed "${resume}" into pane ${paneId}`);
  return true;
}
