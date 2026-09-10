/** Read **only the head and the tail** of a file that is being appended to.
 *
 *  The watcher looks at agent transcripts **every second**, and one of them can pass 1.7MB.
 *  Reading them whole would make the watcher heavy. All that is wanted is what was asked first
 *  (the head) and how things stand now (the tail), so a fixed amount of each is read. */
import fs from 'node:fs';

/** The file's size, or null when it cannot be read (not there yet, or gone). */
export function fileSize(file: string): number | null {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

/** When it was last written, or null when unreadable. */
export function fileMtimeMs(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** Read `[start, start + length)`. An unreadable range comes back empty: a row can still be
 *  built without it. */
function readRange(file: string, start: number, length: number): string {
  if (length <= 0) return '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const read = fs.readSync(fd, buffer, 0, length, start);
      return buffer.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

/** The first `bytes` of the file. */
export function readHead(file: string, bytes: number): string {
  const size = fileSize(file);
  if (size === null) return '';
  return readRange(file, 0, Math.min(size, bytes));
}

/** The last `bytes` of the file. */
export function readTail(file: string, bytes: number): string {
  const size = fileSize(file);
  if (size === null) return '';
  const start = Math.max(0, size - bytes);
  return readRange(file, start, size - start);
}
