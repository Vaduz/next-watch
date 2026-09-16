/** **One child process held open, with its output on disk.**
 *
 *  This is what `--start <script>` needs and what a config file's own adapter writes by hand:
 *  spawn a command, keep the handle, say whether it is still there, and stop it without leaving
 *  anything behind. It knows nothing about npm or Next.js — what to run arrives as a command
 *  and arguments, which is also what lets the test drive it with a one-line node server instead
 *  of a framework.
 *
 *  ⚠️ **Stopping means the whole tree.** `npm run dev` is the parent of the process that holds
 *  the port (`next dev`): signalling only the pid that was spawned leaves the grandchild
 *  listening, and the next start fails on an address already in use.
 *
 *  ⚠️ **Output is written as cleaned lines, not as raw chunks.** The access pane parses the log
 *  file, and a progress display redrawn with `\r` or wrapped in ANSI escapes does not parse. */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { OutputLineReader } from '../core/commandOutput.js';
import { parseServerAddress, type ServerAddress } from '../core/scriptServer.js';
import { killAll, sendSignal } from './processes.js';
import { stopSet } from './stopTree.js';
import type { WatchServerRow } from '../core/types.js';
import type { Emit } from '../config.js';

/** How long `start` waits for the child to announce an address before reporting it up anyway.
 *  A server that prints nothing is still a running server, and a dev server that has not
 *  finished compiling is not a failure either. */
const READY_TIMEOUT_MS = 20_000;

export interface ChildServerSpec {
  /** The pane name and the target key; the script name, for `--start`. */
  id: string;
  command: string;
  args: readonly string[];
  cwd: string;
  /** Where stdout and stderr are appended, absolute. The access pane reads this same file, so
   *  nothing about that pane has to know a child was spawned rather than found. */
  logFile: string;
  /** What the panel's `mode` column shows. */
  mode?: string | null;
  /** Overridden only by the test, which must not wait twenty seconds to learn nothing. */
  readyTimeoutMs?: number;
}

/** Every child this process started and has not stopped. Read by the exit hook below. */
const running = new Set<ChildServer>();
let hookInstalled = false;

/** Stop what we started when this process goes away.
 *
 *  ⚠️ **Synchronous, and it does not wait.** `process.on('exit')` runs no asynchronous work,
 *  and the watcher's own quit path ends in `process.exit(0)`. SIGTERM delivered to the tree is
 *  what fits there; a child that ignores it would have ignored a longer wait too. Without this
 *  a piped `next dev` outlives the watcher and goes on holding its port, and the next run of
 *  next-watch cannot start the server it was asked to start. */
function installExitHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  process.on('exit', () => {
    // Nothing to emit to: the screen is being torn down, and what this leaves running it leaves
    // running whether or not anybody reads a line about it.
    for (const server of running) server.signalTree('SIGTERM', () => undefined);
  });
}

export class ChildServer {
  private child: ChildProcess | null = null;
  private log: fs.WriteStream | null = null;
  private address: ServerAddress | null = null;
  private startedAtMs: number | null = null;
  /** Set while `stop` is running, so a close that we asked for is not reported as a crash. */
  private stopping = false;

  constructor(private readonly spec: ChildServerSpec) {}

  /** Whether the child is there. A handle whose process has exited is not. */
  private alive(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null;
  }

  /** The panel row. **Reads nothing** — it is called every second, and the answer is already
   *  held here. */
  row(): WatchServerRow {
    const up = this.alive();
    const pid = this.child?.pid;
    return {
      server: this.spec.id,
      state: up ? 'up' : 'down',
      // The convention the panel already uses for an address that is not known.
      url: this.address?.url ?? '-',
      mode: this.spec.mode ?? null,
      owner: up && pid !== undefined ? `pid ${pid}` : null,
      uptimeSeconds: up && this.startedAtMs !== null ? Math.floor((Date.now() - this.startedAtMs) / 1000) : null,
      // **Kept when the server is down**, unlike an adapter that discovers its logs from a
      // running process: the tail of the log is where the reason it is down is written.
      logFiles: [this.spec.logFile],
    };
  }

  /** Spawn, and resolve once there is an answer: an address printed, an exit, or the timeout.
   *
   *  It resolves on the **address** rather than on the spawn, because a caller restarting a
   *  server wants the next event to be true. It never throws: a command that is not installed
   *  is an ordinary mistake and belongs in the event log, not in a stack trace. */
  start(emit: Emit): Promise<boolean> {
    if (this.alive()) {
      emit('info', `${this.spec.id} is already running`);
      return Promise.resolve(true);
    }
    this.address = null;
    const log = this.openLog(emit);
    emit('step', `${this.spec.id}: ${this.spec.command} ${this.spec.args.join(' ')}`);
    const child = spawn(this.spec.command, [...this.spec.args], {
      cwd: this.spec.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.log = log;
    this.startedAtMs = Date.now();
    installExitHook();
    running.add(this);
    return this.settleOnReady(child, emit);
  }

  /** Stop the child **and everything under it**, and say whether the port was actually given
   *  up. A process left behind is named, because it goes on holding what it holds. */
  async stop(emit: Emit): Promise<boolean> {
    const pid = this.child?.pid;
    if (!this.alive() || pid === undefined) {
      this.forget();
      emit('info', `${this.spec.id} is not running`);
      return true;
    }
    this.stopping = true;
    const pids = stopSet(this.spec.id, pid, emit);
    emit('step', `${this.spec.id}: stopping pid ${pids.join(', ')}`);
    const survivors = await killAll(pids);
    this.stopping = false;
    this.forget();
    if (survivors.length > 0) {
      emit('error', `${this.spec.id}: ${survivors.join(', ')} would not stop, and may still hold the port`);
      return false;
    }
    emit('step', `${this.spec.id} stopped`);
    return true;
  }

  /** Signal the tree without waiting for it, for the exit hook. A job the server started in a
   *  session of its own outlives the watch too — the contract is the same as `stop`'s. */
  signalTree(sig: NodeJS.Signals, emit: Emit): void {
    const pid = this.child?.pid;
    if (!this.alive() || pid === undefined) return;
    for (const p of stopSet(this.spec.id, pid, emit)) sendSignal(p, sig);
  }

  /** Forget the child. The handle is dropped **before** anything else can read a pid that the
   *  operating system is free to hand to somebody else. */
  private forget(): void {
    running.delete(this);
    this.child = null;
    this.address = null;
    this.startedAtMs = null;
    this.log?.end();
    this.log = null;
  }

  private openLog(emit: Emit): fs.WriteStream | null {
    try {
      fs.mkdirSync(path.dirname(this.spec.logFile), { recursive: true });
      return fs.createWriteStream(this.spec.logFile, { flags: 'a' });
    } catch (err) {
      // A log that cannot be opened costs the pane its rows. It does not cost the server its
      // start: the whole point of the flag is that the server runs.
      emit('warn', `${this.spec.id}: could not open ${this.spec.logFile}: ${String(err)}`);
      return null;
    }
  }

  /** Resolve on the first of: an address printed, the child going away, the timeout. */
  private settleOnReady(child: ChildProcess, emit: Emit): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      let settled = false;
      const settle = (up: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(up);
      };
      // Unreferenced: a timer still armed would keep node alive after everything else is done.
      const timer = setTimeout(() => {
        settle(this.alive());
      }, this.spec.readyTimeoutMs ?? READY_TIMEOUT_MS);
      timer.unref();
      this.collect(child, emit, () => {
        settle(true);
      });
      child.on('error', err => {
        emit('error', `${this.spec.id} could not start: ${err.message}`);
        this.forget();
        settle(false);
      });
      child.on('close', (code, signal) => {
        this.onClose(child, emit, code, signal);
        settle(false);
      });
    });
  }

  /** Read both streams into the log file, watching for the line that names the address. */
  private collect(child: ChildProcess, emit: Emit, onAddress: () => void): void {
    for (const stream of [child.stdout, child.stderr]) {
      if (stream === null) continue;
      const reader = new OutputLineReader();
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        for (const line of reader.push(chunk)) this.take(line, emit, onAddress);
      });
      stream.on('end', () => {
        for (const line of reader.end()) this.take(line, emit, onAddress);
      });
    }
  }

  /** One line of the child's output: on disk for the pane, and read once for an address.
   *
   *  Only the **first** address is kept. A dev server reprints its banner on every recompile,
   *  and the event log would then repeat a line saying nothing new. */
  private take(line: string, emit: Emit, onAddress: () => void): void {
    this.log?.write(`${line}\n`);
    if (this.address !== null) return;
    const found = parseServerAddress(line);
    if (found === null) return;
    this.address = found;
    emit('step', `${this.spec.id} is listening on ${found.url}`);
    onAddress();
  }

  /** The child went away. **Said out loud when we did not ask for it**: a server that died on
   *  its own is exactly what a watcher exists to notice, and silence there is the failure.
   *
   *  ⚠️ The close is ignored when it belongs to a child this object has already let go of.
   *  `stop` returns once the pids it knew about are gone, but a grandchild missing from the
   *  `ps` snapshot can hold the pipes open past that, and the late `close` would then be
   *  reported as a crash of whatever is running by then. */
  private onClose(child: ChildProcess, emit: Emit, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return;
    const why = signal !== null ? `killed by ${signal}` : `exited with ${String(code)}`;
    if (!this.stopping) emit('error', `${this.spec.id} ${why}`);
    this.forget();
  }
}
