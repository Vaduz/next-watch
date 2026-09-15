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

/** Field 22 (`starttime`) of one `/proc/<pid>/stat` line, as the raw digits, or null when the
 *  line does not parse. Reading the file belongs to `io/`.
 *
 *  ⚠️ **The `comm` field is hostile to a naive split**: it is the executable's name inside
 *  parentheses and may itself hold spaces and parentheses (`(tmux: server)`). So the cut is at
 *  the **last** `") "`, not the first. What follows starts at field 3, which puts `starttime`
 *  at index 19.
 *
 *  The value stays a string because that is how the CLI records it in the session file, and the
 *  only thing done with it is comparing the two for equality. */
export function parseProcStartTicks(stat: string): string | null {
  const end = stat.lastIndexOf(') ');
  if (end === -1) return null;
  // As in `parseEtimeTable`: a short line makes this undefined at runtime, which the compiler
  // does not show because `noUncheckedIndexedAccess` is off.
  const fields: (string | undefined)[] = stat
    .slice(end + 2)
    .trim()
    .split(/\s+/);
  const ticks = fields[19];
  return ticks !== undefined && /^\d+$/.test(ticks) ? ticks : null;
}

/** A pid **and everything below it**, parents before their children.
 *
 *  ⚠️ This is what stopping a spawned server means. `npm run dev` is the parent of the process
 *  that actually listens (`next dev`), so signalling only the pid that was spawned leaves the
 *  grandchild holding the port, and the next start fails on an address already in use.
 *
 *  The pid itself is always the first element, even when the snapshot knows nothing about it:
 *  a `ps` that could not be read must not turn stopping one process into stopping none.
 *
 *  As in `ancestorChain`, `seen` guards against a cycle — the snapshot can be internally
 *  inconsistent when processes exit between rows. */
export function processTree(procs: readonly ProcInfo[], pid: number): number[] {
  const children = new Map<number, number[]>();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
  const out: number[] = [];
  const seen = new Set<number>();
  const queue = [pid];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined || cur <= 0 || seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    queue.push(...(children.get(cur) ?? []));
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
