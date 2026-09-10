/** Write events out as lines and read them back. Pure functions; nothing touches the disk.
 *
 *  Events that only ever go to the terminal vanish the moment the watcher is restarted: the
 *  log pane comes back empty and "what was happening a minute ago" is gone. So they are
 *  appended one JSON object per line and replayed at startup.
 *
 *  **Each line stands alone** (this is not a JSON array). Appending is all that is needed, and
 *  a crash mid-write damages exactly one line, which the reader drops and carries on.
 */
import { asRecord } from './util.js';
import type { WatchEvent } from './types.js';
import type { Mark, Tone } from './term/index.js';

/** Marks accepted when reading back. A line with an unknown mark is dropped, so an older log
 *  format cannot leak into the pane. */
const MARKS: readonly Mark[] = [
  'change',
  'step',
  'task',
  'session',
  'prompt',
  'rename',
  'version',
  'watch',
  'cmd',
  'warn',
  'error',
  'info',
];
const TONES: readonly Tone[] = ['plain', 'dim', 'bold', 'ok', 'warn', 'bad', 'crit', 'accent'];

/** One event as one line. The trailing newline is the caller's to add. */
export function encodeWatchEvent(e: WatchEvent): string {
  return JSON.stringify({ at: new Date(e.atMs).toISOString(), mark: e.mark, text: e.text, tone: e.tone });
}

/** One line back into an event. Unreadable lines and unknown marks return null. */
export function decodeWatchEvent(line: string): WatchEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const o = asRecord(parsed);
  if (o === null) return null;
  const atMs = typeof o.at === 'string' ? Date.parse(o.at) : NaN;
  const mark = o.mark;
  const text = o.text;
  if (!Number.isFinite(atMs)) return null;
  if (typeof mark !== 'string' || !(MARKS as readonly string[]).includes(mark)) return null;
  if (typeof text !== 'string') return null;
  const tone =
    typeof o.tone === 'string' && (TONES as readonly string[]).includes(o.tone) ? (o.tone as Tone) : undefined;
  return { atMs, mark: mark as Mark, text, tone };
}

/** How much of the log to read back. */
export interface WatchLogWindow {
  /** At most this many, taken from the newest end. */
  limit: number;
  /** Nothing older than this is replayed (milliseconds). */
  withinMs: number;
}

/**
 * Replay from the whole log (or its tail), oldest first.
 *
 * **Dropping what is too old is the point.** A row in the pane shows only `HH:MM:SS`, so an
 * event from three days ago reads as "three o'clock today".
 */
export function decodeWatchLog(text: string, nowMs: number, window: WatchLogWindow): WatchEvent[] {
  const out: WatchEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    const event = decodeWatchEvent(line);
    if (event !== null && nowMs - event.atMs <= window.withinMs) out.push(event);
  }
  return out.slice(-window.limit);
}
