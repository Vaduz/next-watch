/** **A live `claude` that wrote no session record.** Pure.
 *
 *  The rows in the session table are built from `~/.claude/sessions/<pid>.json`, which the CLI
 *  writes for a session it considers its own. It does not always write one: a session started
 *  **by another Claude Code session** inherits `CLAUDE_CODE_CHILD_SESSION`, and then transcript
 *  saving is off and no record appears. The process is running, is answering prompts, and is
 *  spending the same quota as any other — and until now the panel said nothing about it at all.
 *
 *  ⚠️ **Under-reporting is the worse failure here.** The section promises "the live Claude and
 *  Codex sessions on this machine", and a machine where agents start agents is exactly the one
 *  where that promise matters. So such a process gets a row, with **empty cells rather than
 *  invented ones**: without the record there is no model, no context figure, no idle time and no
 *  version, and a dash would read as "there is none" rather than "this is not knowable from
 *  here". */
import type { AgentSessionRow } from '../types.js';

/** What the row says instead of a state. Short enough for the column, and it names the reason
 *  rather than the symptom. */
export const NO_RECORD_STATUS = 'no record';

/** The subcommands and flags that make a `claude` process **not an interactive session**.
 *
 *  ⚠️ The two that matter are the ones **next-watch runs itself**: `claude -p "hi"` opens a quota
 *  window and `claude update` installs a release. Counting either as an agent session would put
 *  the watcher's own work in the table as somebody's session. The rest are listed because they
 *  are the same kind of thing — a command that runs and exits, not a session someone is in. */
const NOT_A_SESSION = new Set([
  'update',
  'mcp',
  'doctor',
  'config',
  'install',
  'plugin',
  'setup-token',
  'migrate-installer',
]);
const PRINT_FLAGS = new Set(['-p', '--print']);

/** Whether a command line is an interactive `claude` session rather than a one-shot command.
 *
 *  The basename decides which program it is, so a full path works. Everything after it is read
 *  as words: a print flag anywhere, or a known subcommand **as the first of them**, means no. */
export function isInteractiveClaudeCommand(command: string): boolean {
  const words = command
    .trim()
    .split(/\s+/u)
    .filter(w => w !== '');
  const head = words[0] ?? '';
  if (head.slice(head.lastIndexOf('/') + 1) !== 'claude') return false;
  const rest = words.slice(1);
  if (rest.some(w => PRINT_FLAGS.has(w) || w.startsWith('--print='))) return false;
  // ⚠️ **The first word after the program**, not the first word that is not a flag. A
  // subcommand comes first or not at all, so `claude --model update` is a session that chose a
  // model, and only `claude update` is the updater.
  return !NOT_A_SESSION.has(rest[0] ?? '');
}

/** The working tree's name: the last segment of the cwd, the same unit every other row uses. */
export function treeOfCwd(cwd: string | null): string {
  if (cwd === null) return '-';
  const parts = cwd.split('/').filter(p => p.length > 0);
  return parts[parts.length - 1] ?? cwd;
}

/** The row for one such process. Everything the record would have carried is left null, and
 *  `unrecorded` is what tells the renderer to leave those cells **empty** rather than dashed. */
export function unrecordedSessionRow(o: {
  pid: number;
  cwd: string | null;
  startedSecondsAgo: number | null;
  self: boolean;
}): AgentSessionRow {
  return {
    pid: o.pid,
    agent: 'claude',
    name: `(no record) pid ${String(o.pid)}`,
    tree: treeOfCwd(o.cwd),
    status: NO_RECORD_STATUS,
    model: null,
    contextTokens: null,
    idleSeconds: null,
    statusAtMs: null,
    version: null,
    self: o.self,
    // No record means no session id, so there is nothing to type back into a pane: the restart
    // verb is unavailable wherever this process runs, tmux or not.
    pane: null,
    resume: null,
    unrecorded: true,
    startedSecondsAgo: o.startedSecondsAgo,
  };
}
