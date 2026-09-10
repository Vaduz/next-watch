/** Append events to a log file and replay them at startup.
 *
 *  Writing is one appended JSON line at a time (the shape is `core/watchLog.ts`). Reading
 *  happens once, at startup, and that is when old lines are dropped so the file cannot grow
 *  without bound — counting on every append would tie one tick of the watcher to the length of
 *  the log.
 *
 *  ⚠️ **A failure to write never stops the watcher.** The log exists to be read back later,
 *  and stopping a pull because of it would have the priorities backwards. Failures are
 *  swallowed.
 *
 *  The log's directory is a parameter rather than a constant: it belongs to the repository
 *  being watched, not to the package.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodeWatchLog, encodeWatchEvent, type WatchLogWindow } from '../core/watchLog.js';
import type { WatchEvent } from '../core/types.js';

/** The file inside the log directory. */
const WATCH_LOG = 'watch.jsonl';

/** How much is replayed at startup. Nothing older than half a day comes back, because a row
 *  shows only `HH:MM:SS` and an older one would read as today. */
const RESTORE_WINDOW: WatchLogWindow = { limit: 200, withinMs: 12 * 60 * 60_000 };

/** Past this, old lines are dropped at startup. Days of watching stay within a few megabytes. */
const MAX_LINES = 5_000;

const logPath = (logDir: string): string => path.join(logDir, WATCH_LOG);

/** Append one event. A failure to write is given up on silently. */
export function appendWatchEvent(logDir: string, event: WatchEvent): void {
  try {
    const file = logPath(logDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${encodeWatchEvent(event)}\n`);
  } catch {
    /* a log that cannot be written must not stop the watch */
  }
}

/** Replay at startup, trimming the file if it has grown too long. */
export function loadWatchLog(logDir: string, nowMs: number, window: WatchLogWindow = RESTORE_WINDOW): WatchEvent[] {
  let text: string;
  try {
    text = fs.readFileSync(logPath(logDir), 'utf8');
  } catch {
    return [];
  }
  truncateIfLong(logDir, text);
  return decodeWatchLog(text, nowMs, window);
}

/** Rewrite the file with only the newest lines when it is over the limit. */
function truncateIfLong(logDir: string, text: string): void {
  const lines = text.split('\n').filter(l => l.length > 0);
  if (lines.length <= MAX_LINES) return;
  try {
    fs.writeFileSync(logPath(logDir), `${lines.slice(-MAX_LINES).join('\n')}\n`);
  } catch {
    /* reading and writing still work even if it cannot be trimmed */
  }
}
