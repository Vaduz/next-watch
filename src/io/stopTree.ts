/** **The pids to stop with a server**, and the event lines that say what was spared. The one
 *  place both server kinds ask, so both of them behave the same way.
 *
 *  The decision itself is pure and lives in `core/killSet.ts`; this reads `ps` and writes to the
 *  event log, which is why it is here and not there. */
import { serverKillSet } from '../core/killSet.js';
import { psSnapshot } from './processes.js';
import type { Emit } from '../config.js';

/** How much of a left-behind command line to print. A job's arguments can be a whole prompt,
 *  and the event log is read at terminal width. */
const COMMAND_WIDTH = 60;

/** The pids to signal when stopping `pid`, with anything left running named in the log.
 *
 *  A process in a session of its own is a job the server *started*, not part of the server; see
 *  `core/killSet.ts` for why the session is what says so. */
export function stopSet(id: string, pid: number, emit: Emit): number[] {
  const { pids, leaving, by } = serverKillSet(psSnapshot().procs, pid);
  for (const left of leaving) {
    const command = left.command.length > COMMAND_WIDTH ? `${left.command.slice(0, COMMAND_WIDTH - 1)}…` : left.command;
    emit('info', `${id}: leaving pid ${left.pid} (own session: ${command})`);
  }
  // Only worth saying when something might have been spared: a lone pid has no tree to narrow.
  if (by === null && pids.length > 1) {
    emit('warn', `${id}: could not read process sessions, stopping the whole tree`);
  }
  return pids;
}
