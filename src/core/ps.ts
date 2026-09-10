/** Reading the output of `ps`, and walking the process tree it describes. Pure functions;
 *  running `ps` belongs to `io/`. */

/** One process, with only what is needed to walk the tree. */
export interface ProcInfo {
  pid: number;
  ppid: number;
  command: string;
}

/** Parse `ps -A -o pid=,ppid=,command=`, which prints no header. */
export function parsePsTable(stdout: string): ProcInfo[] {
  const out: ProcInfo[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (!m) continue;
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] });
  }
  return out;
}

/** Parse `ps -o pid=,etime= -p <pids>` into pid -> seconds since it started.
 *
 *  `etime` is formatted `[[dd-]hh:]mm:ss`. The `etimes` field, which gives seconds directly,
 *  exists only in procps on Linux and not in the BSD `ps` on macOS, so **`etime` is parsed by
 *  hand and works on both**. An unreadable row is dropped: an uptime is one decorative column,
 *  and losing it changes nothing about the others. */
export function parseEtimeTable(stdout: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(line);
    if (!m) continue;
    // The omitted groups (the days and hours of `32:14`) are undefined at runtime. The
    // compiler shows them as `string` because `noUncheckedIndexedAccess` is off, which is a lie.
    const groups: (string | undefined)[] = [m[2], m[3], m[4], m[5]];
    const [days, hours, minutes, seconds] = groups.map(v => (v === undefined ? 0 : Number(v)));
    out.set(Number(m[1]), ((days * 24 + hours) * 60 + minutes) * 60 + seconds);
  }
  return out;
}

/** A pid and its ancestors up to the root, starting with the pid itself.
 *
 *  The `seen` set guards against a cycle: `ppid` comes from a snapshot that can be internally
 *  inconsistent when processes exit between rows. */
export function ancestorChain(procs: readonly ProcInfo[], pid: number): number[] {
  const byPid = new Map(procs.map(p => [p.pid, p]));
  const out: number[] = [];
  const seen = new Set<number>();
  let cur: number | undefined = pid;
  while (cur !== undefined && cur > 0 && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = byPid.get(cur)?.ppid;
  }
  return out;
}
