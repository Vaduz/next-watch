/** **Matching tmux panes to the processes running inside them.** Pure functions: nothing here
 *  touches the filesystem, a process or tmux. It reads the output of `tmux list-panes` and a
 *  snapshot of `ps`.
 *
 *  Restarting an agent session needs this. A restart is "stop it, then have the pane's shell
 *  type the command again", so what has to be known is **which pane** and **whether that pane
 *  has returned to its shell**.
 *
 *  ⚠️ `pane_pid` is **the pane's root process**, usually a shell, and the agent is a descendant
 *  of it. Measured: for `%3|3359|claude`, 3359 is the shell and the agent is its child.
 *  Matching pids directly finds nothing, so the ancestors are walked and the first pane that
 *  matches wins.
 */
import { ancestorChain, type ProcInfo } from './ps.js';

/** One pane. */
export interface TmuxPane {
  /** The id, of the form `%3`. Unique within tmux and stable for the pane's life. */
  id: string;
  /** The pane's root process (`pane_pid`). */
  pid: number;
  /** What the pane is **running in the foreground right now** (`pane_current_command`). */
  command: string;
}

/** The format passed to `tmux list-panes`. It pairs one-to-one with `parseTmuxPanes`, so it
 *  lives beside it. */
export const TMUX_PANE_FORMAT = '#{pane_id} #{pane_pid} #{pane_current_command}';

/** Read the output of `tmux list-panes -a -F ...`. An unreadable row is skipped: one broken
 *  line does not make the other panes unusable. */
export function parseTmuxPanes(stdout: string): TmuxPane[] {
  const out: TmuxPane[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^(%\d+)\s+(\d+)\s+(\S.*)$/.exec(line.trim());
    if (m === null) continue;
    out.push({ id: m[1], pid: Number(m[2]), command: m[3].trim() });
  }
  return out;
}

/** The pane a pid is in: walking the ancestors, **the first one that matches**, which is the
 *  innermost pane. Null when the process belongs to no pane, meaning it runs outside tmux. */
export function paneOfPid(panes: readonly TmuxPane[], procs: readonly ProcInfo[], pid: number): TmuxPane | null {
  if (!panes.length) return null;
  const byPid = new Map(panes.map(p => [p.pid, p]));
  for (const ancestor of ancestorChain(procs, pid)) {
    const hit = byPid.get(ancestor);
    if (hit !== undefined) return hit;
  }
  return null;
}

/** The name out of a command line (`/usr/bin/zsh -l` and a login shell's `-zsh` both give
 *  `zsh`). tmux normalises `pane_current_command` the same way, so the two can be compared. */
export function commandName(command: string): string {
  const head = command.trim().split(/\s+/)[0] ?? '';
  const base = head.slice(head.lastIndexOf('/') + 1);
  return base.startsWith('-') ? base.slice(1) : base;
}

/** A pane a restart can use, and the command line of its root process. */
export interface RestartPane {
  pane: TmuxPane;
  /** The root process's command line, which is what tells the pane has come back. */
  rootCommand: string;
}

/** Whether a session **can be restarted in its pane**, or null when it cannot.
 *
 *  Three things rule it out.
 *
 *  - It is in no pane at all, meaning it runs outside tmux.
 *  - The pane's root **is** the session, which happens when the agent was started as the pane's
 *    own command. Stopping it closes the pane, and there is nothing left to type into.
 *  - The root process cannot be read, or is the same CLI nested inside itself. Either way there
 *    is no way to tell that the pane has come back. */
export function restartablePane(
  panes: readonly TmuxPane[],
  procs: readonly ProcInfo[],
  pid: number,
): RestartPane | null {
  const pane = paneOfPid(panes, procs, pid);
  if (pane === null || pane.pid === pid) return null;
  const rootCommand = procs.find(p => p.pid === pane.pid)?.command ?? null;
  if (rootCommand === null) return null;
  const own = procs.find(p => p.pid === pid)?.command ?? null;
  if (own !== null && commandName(rootCommand) === commandName(own)) return null;
  return { pane, rootCommand };
}

/** Whether the pane has **returned to its root process**, its shell.
 *
 *  This is the last gate before a restart types anything. When `pane_current_command` has the
 *  same name as the pane's root, nothing is running in the foreground and the shell prompt is
 *  showing. While something else is still there — the old session, or whatever a person
 *  started — this is false and **nothing is typed**, so keystrokes cannot land in a running
 *  program's input. */
export function paneIsIdle(pane: TmuxPane, rootCommand: string | null): boolean {
  if (rootCommand === null) return false;
  return commandName(pane.command) === commandName(rootCommand);
}
