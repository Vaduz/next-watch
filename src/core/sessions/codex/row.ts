/** Fold the pieces that were read — the metadata from `rollout.ts` and the tail from `tip.ts`
 *  — into one row of the dashboard's table. */
import { treeLabel } from '../claude.js';
import type { AgentSessionRow } from '../../types.js';
import type { CodexSessionMeta } from './rollout.js';
import type { CodexTip } from './tip.js';

/** **The line typed to restart** a thread.
 *
 *  `resume <id>` names the thread by id. With no argument a picker opens, and `--last` takes
 *  whichever thread was written to most recently — either can bring up the wrong one. */
const codexResumeCommand = (threadId: string): string => `codex resume ${threadId}`;

/** Fold into one row. Without a name, the head of the thread id is used: unnamed rows cannot
 *  be told apart. */
export function toCodexSessionRow(
  m: CodexSessionMeta,
  pid: number,
  tip: CodexTip,
  nowMs: number,
  extra: {
    name: string | null;
    self: boolean;
    /** The tmux pane it runs in, or null outside tmux. */
    pane?: string | null;
  },
): AgentSessionRow {
  const changedAtMs = tip.statusAtMs ?? m.startedAtMs;
  return {
    pid,
    agent: 'codex',
    name: extra.name ?? `(${m.threadId.slice(0, 8)})`,
    tree: treeLabel(m.cwd),
    status: tip.status,
    model: tip.model,
    contextTokens: tip.contextTokens,
    idleSeconds: changedAtMs === null ? null : Math.max(0, Math.round((nowMs - changedAtMs) / 1000)),
    statusAtMs: changedAtMs,
    version: m.cliVersion,
    self: extra.self,
    pane: extra.pane ?? null,
    // The rollout is the file the process currently has open, so having read it is proof
    // enough that there is something to resume.
    resume: codexResumeCommand(m.threadId),
  };
}
