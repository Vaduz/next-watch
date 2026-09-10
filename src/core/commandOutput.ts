/** **Flatten a child process's output into rows that can go on screen.** Pure functions.
 *
 *  The stdout and stderr of a command run from the screen (a build, an install, an update)
 *  would break through the frame that is being redrawn every second. Each line becomes an
 *  event in the log pane instead.
 *
 *  Three things have to be flattened for that.
 *
 *   - ANSI escapes — not only colour but cursor movement and screen clearing. Inside the frame
 *     they destroy it.
 *   - `\r` overwrites — a progress display (`[####    ] 40%`) redraws one line over and over.
 *     Only the last of those redraws is kept; keeping them all would fill the pane with
 *     progress alone.
 *   - Blank lines — the number of rows is capped, so none of it goes to rows with nothing in
 *     them. */

/** ANSI escape sequences: a CSI (`ESC [ ... final`) and the short `ESC` plus one character. */
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g;

/** The remaining control characters (bell, backspace). Inside the frame they take no width
 *  but still shift the columns. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Flatten one line, keeping only **the last redraw** of a progress display overwritten with
 *  `\r`. */
export function cleanOutputLine(line: string): string {
  const last = line.split('\r').pop() ?? '';
  return last.replace(ANSI, '').replace(CONTROL, '').trimEnd();
}

/** Split collected output into rows, dropping the blank ones. */
export function splitOutputLines(text: string): string[] {
  return text
    .split('\n')
    .map(cleanOutputLine)
    .filter(line => line.trim().length > 0);
}

/** Keep the last `limit` rows, saying in one line how many were dropped rather than cutting
 *  silently. */
export function tailOutputLines(lines: readonly string[], limit: number): string[] {
  if (lines.length === 0) return [];
  if (limit <= 0) return [`... ${lines.length} line(s) not shown`];
  if (lines.length <= limit) return [...lines];
  return [`... ${lines.length - limit} earlier line(s) not shown`, ...lines.slice(-limit)];
}

/**
 * Split output that arrives in chunks into rows.
 *
 * A `data` event can end mid-line, so the fragment is carried into the next chunk. Without
 * that, one line would appear torn into two in the pane.
 */
export class OutputLineReader {
  private carry = '';

  /** Only the rows that are **complete lines** in what has arrived so far. */
  push(chunk: string): string[] {
    const parts = `${this.carry}${chunk}`.split('\n');
    this.carry = parts.pop() ?? '';
    return parts.map(cleanOutputLine).filter(line => line.trim().length > 0);
  }

  /** Whatever fragment is left at the end: a last line with no trailing newline. */
  end(): string[] {
    const rest = cleanOutputLine(this.carry);
    this.carry = '';
    return rest.trim().length > 0 ? [rest] : [];
  }
}
