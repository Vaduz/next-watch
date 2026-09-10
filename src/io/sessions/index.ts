/** Every live agent session on this machine, as one table.
 *
 *  The two CLIs are **found differently** (one writes a json per session, the other holds a
 *  rollout open), so the finding lives in a file each. All this does is prepare what both need,
 *  once, and fold the two results into one list:
 *
 *   - `ps -A` once. It is called every second, and its buffer is not small.
 *   - The pids of this process's ancestors once, to mark the session the watcher runs under.
 *   - The tmux panes once — which pane a session is in is what decides whether it can be
 *     restarted. */
import { psSnapshot } from '../processes.js';
import { tmuxPanes } from '../tmux.js';
import { ancestorChain } from '../../core/ps.js';
import { sortSessionRows } from '../../core/sessions/claude.js';
import { liveClaudeSessions } from './claude.js';
import { liveCodexSessions } from './codex.js';
import type { AgentSessionRow } from '../../core/types.js';

/** The live interactive sessions, busy ones first. */
export function liveAgentSessions(nowMs: number, selfPid: number = process.pid): AgentSessionRow[] {
  const { procs } = psSnapshot();
  const own = new Set(ancestorChain(procs, selfPid));
  // With no tmux this is empty, which only costs those rows their restart verb.
  const panes = tmuxPanes(nowMs);
  return sortSessionRows([
    ...liveClaudeSessions(nowMs, procs, own, panes),
    ...liveCodexSessions(nowMs, procs, own, panes),
  ]);
}
