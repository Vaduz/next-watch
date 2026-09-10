/** Remember **how far each access log has been read**, so the next watch can carry on.
 *
 *  A log line has no timestamp; the reader attaches one. Throwing away the position and the
 *  rows at every restart would leave the panel's time column **blank after every startup** —
 *  the event pane replays from its own log while the access panes started from nothing.
 *
 *  Carrying on is only allowed when it is **the same file, grown**. Reusing a position after
 *  the file was recreated would mark unread lines as read, so the inode and the size are
 *  checked and anything that does not match is discarded (and the tail is read afresh, as
 *  before).
 *
 *  ⚠️ **A failure to write never stops the watch**, the same rule as the event log.
 *
 *  The directory is a parameter rather than a constant. */
import fs from 'node:fs';
import path from 'node:path';
import type { AccessRow } from '../core/accessLog.js';

/** What is carried over for one log. `ino` and `size` are what confirm **it is the same file,
 *  continued**. */
export interface AccessTailState {
  ino: number;
  size: number;
  rows: AccessRow[];
}

/** The file inside the log directory. */
const STATE_FILE = 'watch-access.json';

const statePath = (logDir: string): string => path.join(logDir, STATE_FILE);

/** Unreadable or malformed counts as nothing to carry over. */
export function loadAccessState(logDir: string): Record<string, AccessTailState> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(statePath(logDir), 'utf8'));
    return isState(parsed) ? parsed.files : {};
  } catch {
    return {};
  }
}

/** Rewrite the whole file. It only ever holds the tail of a few logs, so appending would buy
 *  nothing. */
export function saveAccessState(logDir: string, files: Record<string, AccessTailState>): void {
  try {
    const file = statePath(logDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ v: 1, files })}\n`);
  } catch {
    /* a state file that cannot be written must not stop the watch */
  }
}

interface StateFile {
  v: number;
  files: Record<string, AccessTailState>;
}

/** A different shape is not carried over, which also covers a version bump. */
function isState(v: unknown): v is StateFile {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.v === 1 && typeof o.files === 'object' && o.files !== null;
}
