/** **Which of a server's descendants may be stopped with it.** Pure.
 *
 *  Stopping a server means stopping the process tree it built, because a dev server that forks a
 *  compiler leaves the port held if the child outlives it. But a tree is not the same thing as a
 *  server's own work: a job the server *started* — `spawn(..., { detached: true })`, a task the
 *  user asked it to run — is a descendant by parentage and nothing else, and SIGTERM to it
 *  throws away however long it has been running.
 *
 *  ⚠️ **The discriminator is the session id, not the parent.** `detached: true` calls `setsid`,
 *  which gives the child a session of its own that its own children inherit; an ordinary child
 *  shares the server's session however deep it sits. So the tree is collected as before and then
 *  narrowed to the server's own session. Where `ps` prints no session the process group says
 *  almost the same thing, and where it prints neither the whole tree is stopped — which is what
 *  this did before, and holding the port is the worse failure of the two.
 *
 *  Named after what it answers, not where it is called: `scriptServer` and `detachedServer` both
 *  ask it, and the `(k)ill` task verb deliberately does not — killing a task means killing what
 *  that task started. */
import { processTree, type ProcInfo } from './ps.js';

/** A process being left running, for the event log. */
export interface LeftBehind {
  pid: number;
  command: string;
}

/** The decision: what to stop, what is being left, and what it was read from. */
export interface KillSet {
  /** The pids to signal, the server's own first. */
  pids: number[];
  /** The **roots** of the subtrees left alone — the ones whose parent is being stopped. Their
   *  own children are left too, and naming each of them would bury the one line that matters. */
  leaving: LeftBehind[];
  /** Which column the sessions were read from, or null when neither was there and the whole
   *  tree is being stopped. The caller warns on null. */
  by: 'sid' | 'pgid' | null;
}

/** The server's session, and which column it came from. */
function sessionOf(server: ProcInfo | undefined): { key: number; by: 'sid' | 'pgid' } | null {
  if (server === undefined) return null;
  if (server.sid !== undefined) return { key: server.sid, by: 'sid' };
  if (server.pgid !== undefined) return { key: server.pgid, by: 'pgid' };
  return null;
}

/** The pids to stop along with `pid`, and the ones deliberately left running.
 *
 *  ⚠️ **A process whose own session cannot be read is stopped.** Not knowing is not proof that
 *  it is somebody else's: a descendant left behind by mistake goes on holding the port, which is
 *  the failure this whole path exists to prevent. Only a session that is demonstrably different
 *  is spared. */
export function serverKillSet(procs: readonly ProcInfo[], pid: number): KillSet {
  const tree = processTree(procs, pid);
  const byPid = new Map(procs.map(p => [p.pid, p]));
  const session = sessionOf(byPid.get(pid));
  if (session === null) return { pids: tree, leaving: [], by: null };

  const pids: number[] = [];
  const dropped = new Set<number>();
  for (const member of tree) {
    const own = session.by === 'sid' ? byPid.get(member)?.sid : byPid.get(member)?.pgid;
    // The server itself is stopped whatever its row says, and so is anything the snapshot has
    // nothing to say about.
    if (member === pid || own === undefined || own === session.key) pids.push(member);
    else dropped.add(member);
  }

  return { pids, leaving: roots(tree, dropped, new Set(pids), byPid), by: session.by };
}

/** The tops of the left-behind subtrees, in tree order.
 *
 *  Only the top of each: its children are left with it, and one line per descendant would bury
 *  the one the reader needs. */
function roots(
  tree: readonly number[],
  dropped: ReadonlySet<number>,
  kept: ReadonlySet<number>,
  byPid: ReadonlyMap<number, ProcInfo>,
): LeftBehind[] {
  const leaving: LeftBehind[] = [];
  for (const member of tree) {
    const row = byPid.get(member);
    if (!dropped.has(member) || row === undefined || !kept.has(row.ppid)) continue;
    leaving.push({ pid: member, command: row.command });
  }
  return leaving;
}
