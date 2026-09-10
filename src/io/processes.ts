/** Looking at and stopping OS processes. A thin layer over `ps` and `kill`.
 *
 *  ⚠️ **Which processes may be stopped is the caller's decision.** This only stops them.
 *
 *  A failure to read `ps` is returned rather than logged: a package does not own the host's
 *  logger, and the caller decides whether a missing column is worth a row on screen. */
import { execFileSync } from 'node:child_process';
import { sleep } from '../core/util.js';
import { parseEtimeTable, parsePsTable, type ProcInfo } from '../core/ps.js';

export type { ProcInfo };

/** Whether a pid is alive. Signal 0 checks for existence and sends nothing.
 *
 *  ⚠️ **EPERM means alive**: the process is there, and only the permission to signal it is
 *  missing. Treating that as dead would report another user's process as gone and miss one
 *  still holding a port. */
export function isAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Every process (pid, ppid, command), plus the reason when it could not be read.
 *
 *  ⚠️ Failing here **is not fatal**: only the parent-child walk is lost, and anything done by
 *  pid alone still works. So the failure comes back as a value rather than throwing. */
export function psSnapshot(): { procs: ProcInfo[]; error: string | null } {
  try {
    const stdout = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], {
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return { procs: parsePsTable(stdout), error: null };
  } catch (e) {
    return { procs: [], error: String(e) };
  }
}

/** pid -> seconds since it started. Empty when unreadable: an uptime is one column of a table,
 *  and the rest still reads without it. */
export function uptimeByPid(pids: readonly number[]): Map<number, number> {
  if (!pids.length) return new Map();
  try {
    const stdout = execFileSync('ps', ['-o', 'pid=,etime=', '-p', pids.join(',')], { encoding: 'utf-8' });
    return parseEtimeTable(stdout);
  } catch {
    return new Map();
  }
}

/** Send a signal. A process that is already gone is the ordinary case: if what you wanted
 *  stopped is not there, the goal is met. */
export function sendSignal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    /* already gone */
  }
}

/** SIGTERM, up to five seconds of waiting, then SIGKILL for whatever is left. **The return
 *  value is what survived even that**, so the caller can name it: a process left behind goes
 *  on holding its port. */
export async function killAll(pids: readonly number[]): Promise<number[]> {
  for (const p of pids) sendSignal(p, 'SIGTERM');
  for (let i = 0; i < 25 && pids.some(isAlive); i++) await sleep(200);
  const survivors = pids.filter(isAlive);
  for (const p of survivors) sendSignal(p, 'SIGKILL');
  if (survivors.length) await sleep(300);
  return pids.filter(isAlive);
}
