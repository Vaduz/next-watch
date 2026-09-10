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
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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
  };
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
