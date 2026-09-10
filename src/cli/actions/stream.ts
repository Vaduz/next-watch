/** **Turn a child process's output into events.**
 *
 *  What can be selected and what can be typed is decided by `core/watchTargets/`, which is
 *  pure. This is the thin adapter that runs what was decided and reports the progress through
 *  `emit`, so it lands in the event pane and in the event log file.
 *
 *  ⚠️ **A child's output is never passed straight through.** Anything written directly to
 *  stdout breaks through the frame that is redrawn every second. `streamCommand` turns it into
 *  one event per line.
 *
 *  ⚠️ **A command that was typed always says when it started and when it ended.** A build
 *  takes tens of seconds and an update includes a download, so a stream of intermediate output
 *  does not say whether it has finished (`runWatchAction` puts a line on either side).
 *
 *  An adapter says what it is doing through `emit` rather than to a logger of its own. **The
 *  screen has a single outlet**, and anything printed around it is scrolled away by the next
 *  redraw.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { Mark, Tone } from '../../core/term/index.js';
import { OutputLineReader, splitOutputLines, tailOutputLines } from '../../core/commandOutput.js';
import type { WatchTarget } from '../../core/watchTargets.js';
import type { WatchServerAdapter } from '../../config.js';

export const execFileAsync = promisify(execFile);
export { spawn, splitOutputLines, tailOutputLines };

/** Updating a CLI can take tens of seconds, a download included. */
export const UPDATE_TIMEOUT_MS = 5 * 60_000;

/** An install's output reaches tens of kilobytes. */
export const INSTALL_MAX_BUFFER = 32 * 1024 * 1024;

/** Emit one event. A thin wrapper over the screen's own `event`. */
export type Emit = (mark: Mark, text: string, tone?: Tone) => void;

/** What one of the host's own handlers is given. */
export type ActionHandler = (target: WatchTarget, verb: string, ctx: ActionContext) => Promise<boolean>;

export interface ActionContext {
  root: string;
  emit: Emit;
  /** The servers, by id, for the verbs that act on one. */
  servers: ReadonlyMap<string, WatchServerAdapter>;
  /** The host's handlers for the kinds that belong to the optional providers. A kind with no
   *  handler says so rather than doing nothing. */
  handlers: Readonly<Partial<Record<WatchTarget['kind'], ActionHandler>>>;
  /** **Hand the terminal back to the person** for the duration of `body`, for a child that
   *  asks a question. Raw mode is released, redrawing stops, and both are restored afterwards.
   *  Without it the child simply runs, which is right where there is no terminal to hand over
   *  (a pipe, a single run). */
  withTerminalPaused?: <T>(body: () => Promise<T>) => Promise<T>;
  /** Read the CLI versions again, for an action that has just changed one. Without it the panel
   *  would go on showing the old version until the read interval came round. */
  refreshVersions?: () => Promise<void>;
}

/** The cap on how many rows of one command's output become events; the rest is announced in
 *  one line. The watcher runs for days and the events are appended to a file, so a runaway
 *  command must not go into it whole. */
const MAX_OUTPUT_LINES = 200;

/** How many rows of buffered output (from a failed build or install) are shown. **The end**,
 *  because that is where the cause is. */
const MAX_TAIL_LINES = 40;

/** One row of a command's output. **The glyph is the neutral one** — this is neither a step
 *  nor a warning, only a copy — and it is indented to hang under the line that said the
 *  command started. */
export const emitOutput = (emit: Emit, line: string): void => {
  emit('info', `  ${line}`, 'dim');
};

/** Turn buffered output, from a child that failed, into events. */
export function emitBuffered(emit: Emit, text: string): void {
  for (const line of tailOutputLines(splitOutputLines(text), MAX_TAIL_LINES)) emitOutput(emit, line);
}

/** Start a child process and turn **its output into one event per line, as it arrives**. This
 *  never throws.
 *
 *  It does not buffer and print at the end, because a command that includes a download takes
 *  tens of seconds and the screen would say nothing for all of it. */
export function streamCommand(o: {
  command: string;
  args: readonly string[];
  timeoutMs: number;
  emit: Emit;
  /** Where to start it. Defaults to the watcher's own directory. */
  cwd?: string;
}): Promise<{ ok: boolean; detail: string | null }> {
  return new Promise(resolve => {
    const child = spawn(o.command, [...o.args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: o.timeoutMs,
      cwd: o.cwd,
    });
    let shown = 0;
    let dropped = 0;
    const take = (lines: readonly string[]): void => {
      for (const line of lines) {
        if (shown >= MAX_OUTPUT_LINES) {
          dropped += 1;
          continue;
        }
        shown += 1;
        emitOutput(o.emit, line);
      }
    };
    // stdout and stderr are interleaved in arrival order, which is what a terminal shows.
    for (const stream of [child.stdout, child.stderr]) {
      const reader = new OutputLineReader();
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        take(reader.push(chunk));
      });
      stream.on('end', () => {
        take(reader.end());
      });
    }
    const finish = (result: { ok: boolean; detail: string | null }): void => {
      if (dropped > 0) emitOutput(o.emit, `... ${dropped} more line(s) not shown`);
      resolve(result);
    };
    child.on('error', err => {
      finish({ ok: false, detail: err.message });
    });
    child.on('close', (code, signal) => {
      if (signal !== null) finish({ ok: false, detail: `killed by ${signal} (timed out?)` });
      else if (code === 0) finish({ ok: true, detail: null });
      else finish({ ok: false, detail: `exited with ${String(code)}` });
    });
  });
}
