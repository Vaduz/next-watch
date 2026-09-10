/** **Follow** a dev server's log file. The files come from the server adapter's `probe()`.
 *
 *  This holds the I/O and the memory of how far each file has been read; how a line is read is
 *  `core/accessLog.ts`.
 *
 *  **The reader attaches the time.** Neither the lines a dev server writes
 *  (` GET /easy/ 200 in 741ms`) nor the ones an application writes itself carry one, so a line
 *  that has newly appeared is stamped with when it was seen. The watcher reads every second,
 *  so that is accurate to a second.
 *
 *  There are two modes, differing in how the time is attached:
 *
 *   - **Catching up** (the first read after startup) — there is no way to know when the
 *     backlog happened, so those rows carry no time and show a blank column. The **last row**
 *     is the exception: the file's mtime is exactly when it was written (`stampFinalLine`).
 *   - **Following** (every read after that) — a newly appeared row is stamped with now.
 *
 *  The stamps are handed to the next watch through `accessState.ts`; without that, the panel's
 *  time column would go blank at every restart.
 *
 *  ⚠️ The file is never read whole. A dev server's log reaches tens of megabytes over a few
 *  hours. The first read takes a fixed amount from the end, and later reads start from the
 *  byte offset left by the last one.
 *
 *  The state directory is a parameter rather than a repository root. */
import fs from 'node:fs';
import { accessRows, parseAccessLine, stampFinalLine, type AccessRow } from '../core/accessLog.js';
import { loadAccessState, saveAccessState, type AccessTailState } from './accessState.js';

/** How much of the end the first read takes. A line is around 200 bytes, so this is reliably
 *  a few dozen of them. */
const FIRST_TAIL_BYTES = 32 * 1024;
/** The cap on one follow-up read, so a burst of writes is not read in full. */
const MAX_CHUNK_BYTES = 512 * 1024;

/** The file as it is right now, read once per pass. */
interface FileStat {
  ino: number;
  size: number;
  mtimeMs: number;
}

function statOf(file: string): FileStat | null {
  try {
    const s = fs.statSync(file);
    return { ino: s.ino, size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

/** Follows one file. **It lives as long as the watcher does**, because it remembers where it
 *  had read to. */
export class AccessLogTail {
  private offset: number | null = null;
  private rows: AccessRow[] = [];
  /** What the previous watch handed over. Consumed by the first `read`, and discarded if it
   *  does not match. */
  private saved: AccessTailState | null;
  /** Whether the catch-up read has happened. */
  private caughtUp = false;
  /** Increments whenever the offset moves. **This is the signal to rewrite the state**; while
   *  it stands still, nothing is written. */
  private revisionCount = 0;
  private ino: number | null = null;

  constructor(
    readonly file: string,
    private readonly keep: number,
    saved: AccessTailState | null = null,
  ) {
    this.saved = saved;
  }

  get revision(): number {
    return this.revisionCount;
  }

  /** What to hand to the next watch, or null when nothing has been read yet.
   *
   *  If the log was recreated mid-watch, the rows read from the previous file go along too:
   *  they are already on screen, and a restart should not erase them. They were all real
   *  requests with real times, so they do no harm, and they are pushed out once the buffer
   *  fills. */
  state(): AccessTailState | null {
    if (this.offset === null || this.ino === null) return null;
    return { ino: this.ino, size: this.offset, rows: [...this.rows] };
  }

  /** Read on from last time, stamping newly appeared rows, and return what is buffered, oldest
   *  first. */
  read(nowMs: number): readonly AccessRow[] {
    const stat = statOf(this.file);
    if (stat === null) return this.rows;
    this.ino = stat.ino;
    this.restore(stat);
    // A log recreated by a restart is shorter than the offset; drop the position and reread.
    if (this.offset !== null && stat.size < this.offset) this.offset = null;
    const catchUp = !this.caughtUp;
    this.caughtUp = true;
    if (this.offset === null) this.readFirst(stat);
    else if (stat.size > this.offset) this.readMore(stat, catchUp ? null : nowMs);
    return this.rows;
  }

  /** Take over from the previous watch, but only when **the same file has grown**, and only on
   *  the first read. */
  private restore(stat: FileStat): void {
    const saved = this.saved;
    this.saved = null;
    if (saved?.ino !== stat.ino || stat.size < saved.size) return;
    this.offset = saved.size;
    this.rows = saved.rows.slice(-this.keep);
  }

  /** The catch-up read: the end of the file only, stamping just the last row. */
  private readFirst(stat: FileStat): void {
    const start = Math.max(0, stat.size - FIRST_TAIL_BYTES);
    const text = this.slice(start, stat.size, start > 0);
    this.push(stampFinalLine(accessRows(text, this.keep, null), text, stat.mtimeMs));
    this.offset = stat.size;
    this.revisionCount++;
  }

  /** A follow-up read of what has newly appeared. A null `atMs` means this is still catching
   *  up, so only the last row is stamped. */
  private readMore(stat: FileStat, atMs: number | null): void {
    const start = Math.max(this.offset ?? 0, stat.size - MAX_CHUNK_BYTES);
    const text = this.slice(start, stat.size, start > (this.offset ?? 0));
    this.offset = stat.size;
    this.revisionCount++;
    const fresh: AccessRow[] = [];
    for (const line of text.split('\n')) {
      const row = parseAccessLine(line, atMs);
      if (row !== null) fresh.push(row);
    }
    this.push(atMs === null ? stampFinalLine(fresh, text, stat.mtimeMs) : fresh);
  }

  /** Read part of the file, dropping the truncated first line when `dropHead` is set. */
  private slice(start: number, end: number, dropHead: boolean): string {
    try {
      const fd = fs.openSync(this.file, 'r');
      try {
        const buffer = Buffer.alloc(Math.max(0, end - start));
        fs.readSync(fd, buffer, 0, buffer.length, start);
        const text = buffer.toString('utf8');
        return dropHead ? text.slice(text.indexOf('\n') + 1) : text;
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return '';
    }
  }

  private push(rows: readonly AccessRow[]): void {
    this.rows.push(...rows);
    if (this.rows.length > this.keep) this.rows.splice(0, this.rows.length - this.keep);
  }
}

/** One follower per file, kept unique so the read position is shared. */
const tails = new Map<string, AccessLogTail>();

/** What a previous watch left behind, read once per directory. */
const saved = new Map<string, Record<string, AccessTailState>>();

function savedFor(logDir: string, file: string): AccessTailState | null {
  const known = saved.get(logDir) ?? loadAccessState(logDir);
  saved.set(logDir, known);
  return known[file] ?? null;
}

function tailFor(logDir: string, file: string, keep: number): AccessLogTail {
  const known = tails.get(file);
  if (known !== undefined) return known;
  const tail = new AccessLogTail(file, keep, savedFor(logDir, file));
  tails.set(file, tail);
  return tail;
}

/** The access rows for one server, reading all of its logs together when it has several.
 *  The state is rewritten only when a position actually moved, never on an idle pass. */
export function readAccessRows(logDir: string, logFiles: readonly string[], keep: number, nowMs: number): AccessRow[] {
  const out: AccessRow[] = [];
  let moved = false;
  for (const file of logFiles) {
    const tail = tailFor(logDir, file, keep);
    const before = tail.revision;
    out.push(...tail.read(nowMs));
    moved ||= tail.revision !== before;
  }
  if (moved) saveAccessState(logDir, statesOfTails());
  return out.slice(-keep);
}

/** Everything the followers can hand over, which is **only what could be read**. */
function statesOfTails(): Record<string, AccessTailState> {
  const files: Record<string, AccessTailState> = {};
  for (const [file, tail] of tails) {
    const state = tail.state();
    if (state !== null) files[file] = state;
  }
  return files;
}
