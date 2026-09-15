/** **The note a detached server leaves behind**, so the next watch can find it.
 *
 *  A detached server outlives the watch that started it. The only thing connecting the two is
 *  this file, and the only question it has to answer is *is the process it names still the
 *  process I started* — because a pid on its own cannot answer that. Pids are reused, and the
 *  one in a file written three days ago may belong to somebody's editor now.
 *
 *  So the file records more than the pid:
 *
 *   - `script` is checked against the command line, because a pid that is not running what we
 *     started is not ours however alive it is.
 *   - `startTicks` is the `starttime` from `/proc/<pid>/stat`, which **changes when a pid is
 *     reused** and is the only field that closes that hole outright. It is Linux-only, and null
 *     elsewhere; there the two checks above are what there is.
 *
 *  ⚠️ **A file that cannot be read or parsed is treated as no file at all.** It is a hint about
 *  the world, not a record to be trusted: acting on half of one would mean signalling a pid
 *  nobody vouched for. */
import fs from 'node:fs';
import path from 'node:path';
import { asRecord } from '../core/util.js';

export interface ServerPidFile {
  pid: number;
  /** The npm script the process was started with, for matching its command line. */
  script: string;
  /** When it was started, in epoch milliseconds. Shown, not checked. */
  startedAt: number;
  /** `/proc/<pid>/stat` field 22 as it was at the start, or null off Linux. */
  startTicks: string | null;
}

/** Where one server's note lives. They are gathered under `servers/` so a person looking at a
 *  log directory can tell the watcher's bookkeeping from the servers' own output. */
export function pidFilePath(logDir: string, id: string): string {
  return path.join(logDir, 'servers', `${id}.pid`);
}

/** The note, or null when there is none worth trusting. */
export function readPidFile(file: string): ServerPidFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
  const shape = asRecord(parsed);
  if (shape === null) return null;
  const { pid, script, startedAt, startTicks } = shape;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  if (typeof script !== 'string') return null;
  return {
    pid,
    script,
    startedAt: typeof startedAt === 'number' ? startedAt : 0,
    startTicks: typeof startTicks === 'string' ? startTicks : null,
  };
}

/** Leave the note. Failing to write it is **not** fatal: the server is running either way, and
 *  what is lost is only the next watch's chance to adopt it rather than find the port taken. */
export function writePidFile(file: string, note: ServerPidFile): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(note, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Take the note away. A file that was already gone is the ordinary case. */
export function removePidFile(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* already gone, or a directory nobody may write */
  }
}
