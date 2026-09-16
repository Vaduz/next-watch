/** **A server that outlives the watch.**
 *
 *  The ordinary child (`scriptServer.ts`) is stopped when the watcher exits, which is right for
 *  a dev server nobody wants left behind. A production server is the other case: closing the
 *  dashboard should not take the site down. So this one is spawned into **its own process
 *  group** with its output going straight to a file rather than through a pipe — a pipe dies
 *  with the parent — and it is `unref`'d, so node does not wait for it.
 *
 *  What replaces the child handle is a note on disk (`pidFile.ts`). The next watch reads it and
 *  **adopts** the process it names, rather than starting a second one onto a port that is
 *  already taken.
 *
 *  ⚠️ **Adoption has to be sure, not hopeful.** A pid alone proves nothing: pids are reused, and
 *  signalling the wrong one means killing a stranger's process — see `isOurs` for what is
 *  checked and why one check is enough where it is available. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { splitOutputLines } from '../core/commandOutput.js';
import { sleep } from '../core/util.js';
import { parseServerAddress, type ServerAddress } from '../core/scriptServer.js';
import { isSignalable, killAll, procStartTicks, psSnapshot } from './processes.js';
import { stopSet } from './stopTree.js';
import { readTail } from './fileWindow.js';
import { pidFilePath, readPidFile, removePidFile, writePidFile, type ServerPidFile } from './pidFile.js';
import type { WatchServerRow } from '../core/types.js';
import type { Emit } from '../config.js';

/** How much of the log is read looking for the address the server printed. A startup banner is
 *  at the top of a log that grows all day, so this reads the **tail** and accepts that a server
 *  which has since printed 64KB of requests shows no URL — better than reading a log whole once
 *  a second. */
const ADDRESS_TAIL_BYTES = 64 * 1024;

/** How long `start` waits before believing a detached server is up. Long enough for the common
 *  failure — a port already in use — to have happened, short enough not to be felt. */
const SETTLE_MS = 1_500;

export interface DetachedServerSpec {
  id: string;
  command: string;
  args: readonly string[];
  cwd: string;
  /** Where stdout and stderr are appended, absolute. */
  logFile: string;
  /** Where the pid files live, absolute. Normally the log directory. */
  logDir: string;
  /** The npm script name, recorded in the pid file and matched against the command line. */
  script: string;
  mode?: string | null;
}

export class DetachedServer {
  private readonly pidFile: string;

  constructor(private readonly spec: DetachedServerSpec) {
    this.pidFile = pidFilePath(spec.logDir, spec.id);
  }

  /** The note on disk, but **only if the process it names is still ours**. A note that has gone
   *  stale is removed as it is read: leaving it would make every later probe do this work again
   *  and report a server that is not there. */
  private live(): ServerPidFile | null {
    const note = readPidFile(this.pidFile);
    if (note === null) return null;
    if (isOurs(note)) return note;
    removePidFile(this.pidFile);
    return null;
  }

  /** Whether something of ours is running, which is the whole of what `probe` needs. */
  adopted(): boolean {
    return this.live() !== null;
  }

  /** The address the server printed into its own log, or null.
   *
   *  ⚠️ Read from the **file**, not from a stream. There is no stream: the process may have been
   *  started by a watch that ended days ago, and the log is the only thing that remembers. */
  private address(): ServerAddress | null {
    for (const line of splitOutputLines(readTail(this.spec.logFile, ADDRESS_TAIL_BYTES)).reverse()) {
      const found = parseServerAddress(line);
      if (found !== null) return found;
    }
    return null;
  }

  row(): WatchServerRow {
    const note = this.live();
    return {
      server: this.spec.id,
      state: note === null ? 'down' : 'up',
      url: (note === null ? null : this.address()?.url) ?? '-',
      mode: this.spec.mode ?? null,
      owner: note === null ? null : `pid ${note.pid}`,
      uptimeSeconds: note === null || note.startedAt === 0 ? null : Math.floor((Date.now() - note.startedAt) / 1000),
      // Kept when the server is down: the tail of the log is where the reason it is down is.
      logFiles: [this.spec.logFile],
    };
  }

  /** Start it, unless something of ours is already running — which after a restart of the watch
   *  is the ordinary case, and is why this says so rather than starting a second one. */
  async start(emit: Emit): Promise<boolean> {
    const note = this.live();
    if (note !== null) {
      emit('info', `${this.spec.id} is already running detached (pid ${note.pid}), adopted`);
      return true;
    }
    if (!this.spawnDetached(emit)) return false;
    // ⚠️ **Wait long enough to see it fail.** Unlike an ordinary child there is no handle to
    // hear an exit on, so without this a server that died on a taken port would be reported
    // started, and the row would quietly turn `down` a second later with nothing said.
    await sleep(SETTLE_MS);
    if (this.live() !== null) return true;
    emit('error', `${this.spec.id} exited right after starting - see ${this.spec.logFile}`);
    return false;
  }

  private spawnDetached(emit: Emit): boolean {
    let fd: number;
    try {
      fs.mkdirSync(path.dirname(this.spec.logFile), { recursive: true });
      fd = fs.openSync(this.spec.logFile, 'a');
    } catch (err) {
      // Unlike an ordinary child, the log is not optional here: it is where the address comes
      // from, and without it an adopted server could never show a URL again.
      emit('error', `${this.spec.id}: could not open ${this.spec.logFile}: ${String(err)}`);
      return false;
    }
    try {
      emit('step', `${this.spec.id}: ${this.spec.command} ${this.spec.args.join(' ')} (detached)`);
      const child = spawn(this.spec.command, [...this.spec.args], {
        cwd: this.spec.cwd,
        // Its own process group, so stopping it later can take the whole tree, and so a Ctrl-C
        // in this terminal does not reach it.
        detached: true,
        stdio: ['ignore', fd, fd],
      });
      child.unref();
      if (child.pid === undefined) {
        emit('error', `${this.spec.id} could not start`);
        return false;
      }
      writePidFile(this.pidFile, {
        pid: child.pid,
        script: this.spec.script,
        startedAt: Date.now(),
        startTicks: procStartTicks(child.pid),
      });
      emit('step', `${this.spec.id} started detached (pid ${child.pid}); it will outlive this watch`);
      return true;
    } finally {
      // The child holds its own copy of the descriptor; this one has done its job.
      fs.closeSync(fd);
    }
  }

  /** Stop it **and everything under it**, then take the note away. */
  async stop(emit: Emit): Promise<boolean> {
    const note = this.live();
    if (note === null) {
      removePidFile(this.pidFile);
      emit('info', `${this.spec.id} is not running`);
      return true;
    }
    const pids = stopSet(this.spec.id, note.pid, emit);
    emit('step', `${this.spec.id}: stopping pid ${pids.join(', ')}`);
    const survivors = await killAll(pids);
    removePidFile(this.pidFile);
    if (survivors.length > 0) {
      emit('error', `${this.spec.id}: ${survivors.join(', ')} would not stop, and may still hold the port`);
      return false;
    }
    emit('step', `${this.spec.id} stopped`);
    return true;
  }
}

/** Whether the process a note names is **the one that note was written about**.
 *
 *  All three have to agree:
 *
 *   - it is alive **and ours** — `isSignalable`, not `isAlive`: a process we may not signal is
 *     not one we started, whatever it is;
 *   - on Linux its `starttime` is the one recorded. That field changes when a pid is reused, so
 *     this is the check that closes the hole outright. Off Linux it cannot be read at all;
 *   - its command line still names the script. On Linux that is a second opinion; off it, it is
 *     the only one there is, which is why it is a plain substring rather than an exact shape —
 *     `bun run dev` and `npm run dev` and a path ending in the script's own name all have to
 *     pass, and a stranger's process that happens to contain the word is already excluded by
 *     being unsignalable or by its start time.
 */
function isOurs(note: ServerPidFile): boolean {
  if (!isSignalable(note.pid)) return false;
  if (note.startTicks !== null) {
    // ⚠️ **And then stop.** `ps -A` is a process spawn, and this runs once a second for every
    // detached server. Where the start time is readable it has already settled the question the
    // command line was only going to second, so paying for `ps` as well would be a spawn a
    // second for nothing.
    return procStartTicks(note.pid) === note.startTicks;
  }
  const command = psSnapshot().procs.find(p => p.pid === note.pid)?.command;
  // An unreadable `ps` leaves the liveness check standing rather than rejecting everything: on a
  // machine where `ps` fails, no detached server could ever be adopted again.
  return command === undefined || command.includes(note.script);
}
