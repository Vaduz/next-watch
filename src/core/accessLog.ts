/** Read **access rows** out of a dev server's log. Pure functions; nothing touches the disk.
 *
 *  A dev server's stdout collects in one file, and the Next dev server writes requests into it
 *  as ` GET /easy/ 200 in 741ms (next.js: 53ms, ...)`. The dashboard shows the tail of that
 *  file in a pane per server.
 *
 *  When there is not a single access row, **the raw tail is shown instead**. A server running
 *  in production mode (`next start`) writes no request lines at all, and a pane that is always
 *  empty is a pane nobody looks at; the startup and error lines are worth more there.
 */

/** One row in a pane. A null `method` means the line did not parse and is shown as it is. */
export interface AccessRow {
  /** When the row was **seen** (epoch ms). The line carries no timestamp of its own, so this
   *  is attached when the tail is read. Rows that were already in the file before watching
   *  started are null — except the last one, which can borrow the file's mtime
   *  (`stampFinalLine`). */
  atMs: number | null;
  method: string | null;
  /** The path, or the unparsed line itself. */
  target: string;
  status: number | null;
  /** Duration in milliseconds, or null when it could not be read. */
  ms: number | null;
}

/** The request line Next writes. Only the `GET /easy/ 200 in 741ms` shape is picked up. */
const REQUEST = /^\s*(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s+(\S+)\s+(\d{3})\s+in\s+([\d.]+)(ms|s)\b/;

/** Startup decoration. Worth nothing even in the raw view, so it is dropped there too. */
const NOISE = /^\s*(- (Local|Network|Environments):|▲ Next\.js|✓ Ready|✓ Compiled|✓ Running next\.config)/;

/** Read one line. Null when it is not a request line. The caller attaches the time. */
export function parseAccessLine(line: string, atMs: number | null = null): AccessRow | null {
  const m = REQUEST.exec(line);
  if (m === null) return null;
  const value = Number(m[4]);
  return {
    atMs,
    method: m[1],
    target: m[2],
    status: Number(m[3]),
    ms: Number.isFinite(value) ? Math.round(m[5] === 's' ? value * 1000 : value) : null,
  };
}

/** Fold an unparsed line into a row. */
const rawRow = (line: string, atMs: number | null): AccessRow => ({
  atMs,
  method: null,
  target: line.trim(),
  status: null,
  ms: null,
});

/**
 * The last `limit` rows from the tail of a log, **oldest first** rather than newest first.
 *
 * Access rows win if there are any; otherwise the raw lines (minus the decoration) are used.
 */
export function accessRows(text: string, limit: number, atMs: number | null = null): AccessRow[] {
  if (limit <= 0) return [];
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const requests: AccessRow[] = [];
  for (const line of lines) {
    const row = parseAccessLine(line, atMs);
    if (row !== null) requests.push(row);
  }
  if (requests.length) return requests.slice(-limit);
  return lines
    .filter(l => !NOISE.test(l))
    .slice(-limit)
    .map(l => rawRow(l, atMs));
}

/** The class of an HTTP status. Choosing a colour for it is the view's job. */
export type AccessClass = 'ok' | 'redirect' | 'clientError' | 'serverError' | 'unknown';

export function accessClass(status: number | null): AccessClass {
  if (status === null) return 'unknown';
  if (status >= 500) return 'serverError';
  if (status >= 400) return 'clientError';
  if (status >= 300) return 'redirect';
  return 'ok';
}

/**
 * Build an access line. **Read this together with `parseAccessLine`**: the two are a contract.
 *
 * Next writes request lines only from a dev server
 * (`next/dist/server/dev/log-requests.js`). A server running in production mode writes none,
 * so an application that wants its requests to show up in the pane emits this exact shape
 * itself — and then one parser reads both.
 */
export function formatAccessLine(row: { method: string; target: string; status: number; ms: number }): string {
  return ` ${row.method} ${row.target} ${row.status} in ${row.ms}ms`;
}

/** Duration for display (`741ms`, `2.5s`). */
export function formatMs(ms: number | null): string {
  if (ms === null) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/**
 * Attach the **one timestamp that can be known** to a backlog read (rows that were in the file
 * before watching started).
 *
 * The lines carry no time of their own, so when a backlogged row happened is unknowable. The
 * one fact available is the file's mtime, which is when **the last line** was written — so
 * only that row gets it. If the file's final line is decoration, or otherwise does not match
 * the last row being shown, nothing is stamped: no row is made to claim another row's time.
 */
export function stampFinalLine(rows: readonly AccessRow[], text: string, atMs: number): AccessRow[] {
  const last = text
    .split('\n')
    .filter(l => l.trim().length > 0)
    .at(-1);
  const row = rows.at(-1);
  if (last === undefined || row === undefined || !isFinalLine(row, last)) return [...rows];
  return [...rows.slice(0, -1), { ...row, atMs }];
}

/** Whether the line is the very row being shown last. */
function isFinalLine(row: AccessRow, line: string): boolean {
  const parsed = parseAccessLine(line);
  if (parsed === null) return row.method === null && row.target === line.trim();
  return parsed.method === row.method && parsed.target === row.target && parsed.status === row.status;
}
