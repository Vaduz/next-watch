/** Reading the **live Claude Code sessions**. Pure functions: no filesystem, no processes.
 *
 *  Claude Code writes `~/.claude/sessions/<pid>.json` per session and rewrites it whenever the
 *  state changes. Reading those files says who is doing what on this machine right now.
 *
 *  **A file existing does not mean the session is alive.** The json of a session that died
 *  stays behind — dozens of them accumulate, some without a `status` at all. Whether a session
 *  is alive is decided by the caller, from the pid.
 *
 *  What lives here is **the reading and the folding**: one json into one row, the ordering,
 *  the caps. */
import type { AgentSessionRow } from '../types.js';

/** The fields read out of one session file. */
export interface AgentSessionRecord {
  pid: number;
  sessionId: string;
  cwd: string;
  /** The session's name, which a title hook may rewrite. */
  name: string | null;
  /** busy / idle / shell / waiting, and sometimes absent. */
  status: string | null;
  startedAtMs: number | null;
  /** When the status last changed. */
  statusUpdatedAtMs: number | null;
  /** How it was started. The non-interactive entrypoint is filtered out below. */
  kind: string | null;
  entrypoint: string | null;
  /** The version it started with. Older files do not have it, so this can be null. */
  version: string | null;
  /** The `starttime` of the process, which the CLI records **so that a reused pid can be told
   *  apart from the original**. Digits as written, not a date. */
  procStart: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A clock-tick count as written. The CLI writes it as a string; a number is accepted too, so
 *  that the comparison does not silently start failing if that ever changes. */
const ticks = (v: unknown): string | null => {
  if (typeof v === 'string') return /^\d+$/.test(v) ? v : null;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return String(v);
  return null;
};

/** Read one file. Without a readable pid it is **not a session** and returns null. */
export function parseAgentSession(raw: string): AgentSessionRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  const pid = num(o.pid);
  const sessionId = str(o.sessionId);
  if (pid === null || sessionId === null) return null;
  return {
    pid,
    sessionId,
    cwd: str(o.cwd) ?? '',
    name: str(o.name),
    status: str(o.status),
    startedAtMs: num(o.startedAt),
    statusUpdatedAtMs: num(o.statusUpdatedAt) ?? num(o.updatedAt),
    kind: str(o.kind),
    entrypoint: str(o.entrypoint),
    version: str(o.version),
    procStart: ticks(o.procStart),
  };
}

/** Whether a `ps` command column is the CLI itself.
 *
 *  Two shapes run side by side on one machine: `claude …`, and the versioned binary a
 *  background session execs, `~/.local/share/claude/versions/2.1.267 --session-id …`, whose
 *  **last path segment is the version, not a name**. So what counts is a path segment `claude`
 *  anywhere in the command — a strict widening of matching only the argv[0] basename, so no
 *  shape that used to be found is lost.
 *
 *  `@anthropic-ai/claude-code/cli.js` is not a match: its segment is `claude-code`. */
const CLAUDE_COMMAND = /(^|\/)claude(\/|\s|$)/;

export const isClaudeCommand = (command: string): boolean => CLAUDE_COMMAND.test(command);

/** What the OS says about one session's pid, gathered by `io/`.
 *
 *  ⚠️ **`undefined` and `null` carry meaning here.** A `command` of `undefined` is "`ps` had no
 *  row", not "the row was empty", and a `procStartTicks` of null is "`/proc` could not be
 *  read", not "it started at tick zero". `isLiveSession` turns on both. */
export interface PidEvidence {
  /** `kill(pid, 0)` succeeded outright. **EPERM is false** — see `isLiveSession`. */
  signalable: boolean;
  /** `starttime` from `/proc/<pid>/stat`, or null where `/proc` could not be read. */
  procStartTicks: string | null;
  /** The `ps` row's command, or undefined when `ps` had no row for this pid. */
  command: string | undefined;
  /** Whether `ps` failed as a whole. A property of the snapshot rather than of the pid, carried
   *  here so that the decision reads as one table. */
  psFailed: boolean;
}

/** Whether the session this record describes is the process still running at its pid.
 *
 *  Three separate ways a dead session used to be shown as live, and all three were seen on one
 *  machine — a session that died in June sat in the panel in September, because its pid had
 *  been taken over by a thread of a root daemon. */
export function isLiveSession(r: AgentSessionRecord, e: PidEvidence): boolean {
  // 1. The signal. The CLI runs as the user watching it, so a pid this process may not signal
  //    is not one of its sessions. EPERM used to count as alive, which is right when the
  //    question is "is something still holding that port" and wrong when it is "is this mine".
  if (!e.signalable) return false;
  // 2. The start time. Over a watch lasting days, pids come round again; the record carries the
  //    process's `starttime` for exactly this comparison. Where either side is missing (no
  //    `/proc`, or a record written before the field existed) the question is left to the
  //    others rather than answered by a guess.
  if (r.procStart !== null && e.procStartTicks !== null && r.procStart !== e.procStartTicks) return false;
  // 3. The command. A pid with no `ps` row is running nothing this can recognise — a thread of
  //    another user's process has no row of its own, yet `/proc/<tid>/stat` still reads. Only a
  //    `ps` that failed outright is worth waiving the check for, because then no pid has a row.
  if (e.command === undefined) return e.psFailed;
  return isClaudeCommand(e.command);
}

/** Whether a session belongs in the list.
 *
 *  The `sdk-cli` entrypoint is a **programmatic** invocation, not a person at a terminal.
 *  Dozens of those accumulate, and mixing them in makes "how many conversations are running on
 *  this machine" unreadable, so they are dropped. */
export function isInteractiveSession(r: AgentSessionRecord): boolean {
  return r.entrypoint !== 'sdk-cli';
}

/** The working tree's name: the last segment of the cwd. That is the unit that tells several
 *  checkouts apart, and the other CLI's rows use the same one. */
export function treeLabel(cwd: string): string {
  const parts = cwd.split('/').filter(p => p.length > 0);
  return parts[parts.length - 1] ?? cwd;
}

/** Drop the tree-name prefix from a session name, since the table has a TREE column already. */
export function shortSessionName(name: string | null, tree: string): string {
  if (name === null) return '(unnamed)';
  return name.startsWith(`${tree} `) ? name.slice(tree.length + 1) : name;
}

/** Shorten a model id for display (`claude-opus-5[1m]` becomes `opus-5[1m]`). */
export function shortModelName(model: string | null): string | null {
  if (model === null) return null;
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

/** **The line typed to restart** a session.
 *
 *  `--resume <id>` names the conversation by id. `--continue` would take the newest one in the
 *  cwd, which brings up the wrong session whenever two are open in the same checkout. */
export const claudeResumeCommand = (sessionId: string): string => `claude --resume ${sessionId}`;

/** Fold into one row. `extra` is what the transcript yielded, and null is fine throughout. */
export function toSessionRow(
  r: AgentSessionRecord,
  nowMs: number,
  extra: {
    model: string | null;
    contextTokens: number | null;
    self: boolean;
    /** The tmux pane it runs in, or null outside tmux. */
    pane?: string | null;
    /** The line to type to restart it, or null when it cannot be resumed. */
    resume?: string | null;
  },
): AgentSessionRow {
  const tree = treeLabel(r.cwd);
  return {
    pid: r.pid,
    agent: 'claude',
    name: shortSessionName(r.name, tree),
    tree,
    status: r.status ?? '?',
    model: shortModelName(extra.model),
    contextTokens: extra.contextTokens,
    idleSeconds: r.statusUpdatedAtMs === null ? null : Math.max(0, Math.round((nowMs - r.statusUpdatedAtMs) / 1000)),
    statusAtMs: r.statusUpdatedAtMs,
    version: r.version,
    self: extra.self,
    pane: extra.pane ?? null,
    resume: extra.resume ?? null,
  };
}

/** The order: busy first, and within that, whatever moved most recently. */
export function sortSessionRows(rows: readonly AgentSessionRow[]): AgentSessionRow[] {
  const rank = (s: string): number => (s === 'busy' ? 0 : s === 'waiting' ? 1 : s === 'shell' ? 2 : 3);
  return [...rows].sort(
    (a, b) => rank(a.status) - rank(b.status) || (a.idleSeconds ?? Infinity) - (b.idleSeconds ?? Infinity),
  );
}
