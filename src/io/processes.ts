/** Looking at and stopping OS processes. A thin layer over `ps` and `kill`.
 *
 *  ⚠️ **Which processes may be stopped is the caller's decision.** This only stops them.
 *
 *  A failure to read `ps` is returned rather than logged: a package does not own the host's
 *  logger, and the caller decides whether a missing column is worth a row on screen. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { sleep } from '../core/util.js';
import { parseEtimeTable, parseProcStartTicks, parsePsTable, type ProcInfo } from '../core/ps.js';

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

/** Whether a pid exists **and belongs to this user**: the stricter twin of `isAlive`.
 *
 *  ⚠️ **EPERM is dead here**, which is the whole difference. `isAlive` is asked whether
 *  something is still holding a port, where another user's process counts. This is asked
 *  whether a pid is one of *ours* — a CLI session, a server this watch started — and there the
 *  answer for a process we may not signal is no. */
export function isSignalable(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The `starttime` a pid was recorded with, or null where it cannot be read.
 *
 *  ⚠️ **Linux only.** There is no `/proc/<pid>/stat` elsewhere, and null there means the caller
 *  falls back to whatever else it has for telling a reused pid from the original.
 *
 *  ⚠️ Readable **for a thread id too**, and threads do not appear in `ps -A`. That is what makes
 *  this worth reading: a dead session's pid reused by a thread of a root daemon answers `/proc`
 *  but with a different `starttime`. */
export function procStartTicks(pid: number): string | null {
  if (!pid || pid <= 0) return null;
  try {
    return parseProcStartTicks(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return null;
  }
}

/** The `-o` formats to try, widest first. `sid` is what tells a server's own children from a job
 *  it started in a session of its own, and `pgid` is the next best thing where a `ps` does not
 *  print sessions; the three-column form is what every `ps` prints and always works. */
const PS_FORMATS = [
  { arg: 'pid=,ppid=,pgid=,sid=,command=', extra: 2 },
  { arg: 'pid=,ppid=,pgid=,command=', extra: 1 },
  { arg: 'pid=,ppid=,command=', extra: 0 },
] as const;

/** Which format this host answered to. **Remembered**, because `psSnapshot` runs once a second:
 *  a `ps` that refuses `sid` would otherwise be asked, and refuse, every second for the life of
 *  the watch. */
let psFormat = 0;

/** Every process (pid, ppid, command, and the group and session where `ps` prints them), plus
 *  the reason when it could not be read.
 *
 *  ⚠️ Failing here **is not fatal**: only the parent-child walk is lost, and anything done by
 *  pid alone still works. So the failure comes back as a value rather than throwing. */
export function psSnapshot(): { procs: ProcInfo[]; error: string | null } {
  let last = 'ps: no format accepted';
  for (const [at, format] of PS_FORMATS.entries()) {
    if (at < psFormat) continue;
    try {
      const stdout = execFileSync('ps', ['-A', '-o', format.arg], {
        encoding: 'utf-8',
        maxBuffer: 16 * 1024 * 1024,
      });
      // Only a format that worked is remembered. A `ps` that failed for some passing reason
      // leaves the pointer where it was, so the next second asks for the columns again.
      psFormat = at;
      return { procs: parsePsTable(stdout, format.extra), error: null };
    } catch (e) {
      last = String(e);
    }
  }
  return { procs: [], error: last };
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
