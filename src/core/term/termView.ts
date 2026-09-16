/** Shared pieces for drawing frames and tables on a terminal. Pure formatting only: no
 *  filesystem, no process, no clock.
 *
 *  Colour disappears entirely under `painter(false)` — the caller decides from
 *  `process.stdout.isTTY`. That keeps control characters out of a pipe, and **width is always
 *  measured with colour stripped** (`textWidth.ts`).
 *
 *  It is kept apart from the dashboard that uses it so that a second caller (a progress
 *  display, say) can reuse the vocabulary without depending on the watch screen. */
import { displayWidth, padDisplay, wrapDisplay } from './textWidth.js';

/** A semantic colour. What it actually looks like (ANSI or nothing) is `painter`'s decision. */
export type Tone = 'plain' | 'dim' | 'bold' | 'ok' | 'warn' | 'bad' | 'crit' | 'accent';

export type Paint = (text: string, tone?: Tone) => string;

const CODES: Record<Tone, string> = {
  plain: '',
  dim: '2',
  bold: '1',
  ok: '32',
  warn: '33',
  bad: '31',
  crit: '1;31', // Something to act on now (a quota about to run out, a service that is down)
  accent: '36',
};

/** Build the colouring function. `color=false` passes text through, so tests read plain strings. */
export function painter(color: boolean): Paint {
  if (!color) return text => text;
  return (text, tone = 'plain') => {
    const code = CODES[tone];
    return code ? `\u001b[${code}m${text}\u001b[0m` : text;
  };
}

/** A colour applied to a whole row. **An ordinary row gets none** (undefined).
 *  Colouring everything buries the one row worth noticing; only trouble stands out. */
export type RowTone = Tone | undefined;

/** One table cell. `text` is what gets measured; colour is applied after padding. */
export interface Cell {
  text: string;
  tone?: Tone;
  /** Right-align (numeric columns). */
  right?: boolean;
}

export const cell = (text: string, tone?: Tone): Cell => ({ text, tone });

/** Align columns by display width. No row is treated as a header — the caller decides colour
 *  per cell. */
export function renderCells(rows: readonly (readonly Cell[])[], paint: Paint): string[] {
  const columns = Math.max(0, ...rows.map(r => r.length));
  const widths = Array.from({ length: columns }, (_, i) =>
    Math.max(0, ...rows.map(r => displayWidth(r[i]?.text ?? ''))),
  );
  return rows.map(row =>
    row
      .map((c, i) => {
        const padded = c.right
          ? ' '.repeat(Math.max(0, widths[i] - displayWidth(c.text))) + c.text
          : padDisplay(c.text, widths[i]);
        return paint(padded, c.tone);
      })
      .join('  ')
      .trimEnd(),
  );
}

/** `HH:MM:SS` at a fixed UTC offset, independent of the host's TZ.
 *  The offset is a parameter so a caller in another zone is not forced into this one. */
export function clockAt(ms: number, offsetMinutes: number): string {
  return new Date(ms + offsetMinutes * 60 * 1000).toISOString().slice(11, 19);
}

/** `HH:MM` at a fixed offset, for places where seconds are noise (a reset time, say). */
export function hourMinuteAt(ms: number, offsetMinutes: number): string {
  return clockAt(ms, offsetMinutes).slice(0, 5);
}

/** Minutes since midnight at a fixed offset, so a configured `09:00` can be compared with the
 *  clock without either of them becoming a `Date` in the host's own zone. */
export function minuteOfDayAt(ms: number, offsetMinutes: number): number {
  const at = new Date(ms + offsetMinutes * 60 * 1000);
  return at.getUTCHours() * 60 + at.getUTCMinutes();
}

/** `YYYY-MM-DD` at a fixed offset. Something that happens **once a day** needs a name for the
 *  day the watcher's clock is showing, and the host's own date is the wrong one wherever
 *  `timezoneOffsetMinutes` differs from it. */
export function dayAt(ms: number, offsetMinutes: number): string {
  return new Date(ms + offsetMinutes * 60 * 1000).toISOString().slice(0, 10);
}

/** Render a percentage as a bar in eighth-of-a-cell steps (`██▌`). */
export function bar(percent: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const eighths = Math.round((clamped / 100) * width * 8);
  const full = Math.floor(eighths / 8);
  const rest = eighths % 8;
  const partial = rest ? '▏▎▍▌▋▊▉'[rest - 1] : '';
  return `${'█'.repeat(full)}${partial}`.padEnd(width, '·');
}

/** Elapsed time in **at most two units** (`3d4h`, `1h22m`, `32m`, `45s`).
 *  Listing every unit down to the second is noise: the reader only wants roughly how long. */
export function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '-';
  const [d, h, m] = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60];
  if (d > 0) return h > 0 ? `${d}d${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

/* ── One event row ─────────────────────────────────────────────── */

/** The glyph at the head of a row. **A different glyph per kind of event**, so the left edge
 *  alone says what kind of row this is (a pull, a build step, a task, a session, a prompt, a
 *  rename, a warning, a failure). */
export type Mark =
  | 'change'
  | 'step'
  | 'task'
  | 'session'
  | 'prompt'
  | 'rename'
  | 'version'
  | 'watch'
  | 'cmd'
  | 'warn'
  | 'error'
  | 'info';

/** The glyphs deliberately **avoid code points that terminals render as emoji** (`⚙ U+2699`
 *  and `✏ U+270F` are drawn two cells wide, which shifts the right border on that row alone). */
const MARKS: Record<Mark, { glyph: string; tone: Tone }> = {
  change: { glyph: '⇣', tone: 'accent' }, // pulled from the remote
  step: { glyph: '○', tone: 'dim' }, // install / build / restart step
  task: { glyph: '▸', tone: 'accent' }, // a task started from outside
  session: { glyph: '◆', tone: 'accent' }, // an agent session appearing or leaving
  prompt: { glyph: '✎', tone: 'accent' }, // a prompt being run
  rename: { glyph: '✱', tone: 'accent' }, // a session was renamed
  version: { glyph: '✧', tone: 'accent' }, // a local CLI moved to a new version
  watch: { glyph: '◎', tone: 'bold' }, // the watcher itself starting and stopping
  cmd: { glyph: '»', tone: 'accent' }, // a command typed on the screen
  warn: { glyph: '▲', tone: 'warn' },
  error: { glyph: '✕', tone: 'bad' },
  info: { glyph: '·', tone: 'dim' },
};

/** Just the glyph for a mark, for putting one inside a table. */
export const markGlyph = (mark: Mark): string => MARKS[mark].glyph;

/** One row with a timestamp. **The dashboard prints nothing in any other shape**, so the time
 *  column never steps. */
export function eventLine(clock: string, mark: Mark, text: string, paint: Paint, tone?: Tone): string {
  const m = MARKS[mark];
  return `  ${paint(clock, 'dim')} ${paint(m.glyph, tone ?? m.tone)} ${text}`;
}

/** A continuation row under an event, indented to line up with the text above it. */
export function detailLine(text: string): string {
  return `           ${text}`;
}

/** Indent for wrapped rows, matching the width of the timestamp column. */
export const BODY_INDENT = ' '.repeat(9);

/* ── The frame ─────────────────────────────────────────────────── */

/** A divider rule. `corners` is the two corner characters (`'╭╮'` or `'├┤'`). */
function rule(corners: string, title: string, paint: Paint, width: number): string {
  const dashes = Math.max(2, width - displayWidth(title) - 5);
  return paint(`${corners[0]}─ ${title} ${'─'.repeat(dashes)}${corners[1]}`, 'dim');
}

/** A section below the body: a divider and its content. An empty one is omitted entirely. */
export interface FramePane {
  title: string;
  lines: readonly string[];
}

/** Put content in a frame. **The width comes from the terminal**, not from the content.
 *  Panes go below a divider, keeping "how things are now" (above) separate from "what
 *  happened" (below). */
export function frame(o: {
  title: string;
  body: readonly string[];
  panes: readonly FramePane[];
  paint: Paint;
  width: number;
}): string[] {
  const side = o.paint('│', 'dim');
  // Rows that overflow are **wrapped, not cut**: cutting loses the tail, which is where the
  // error message is. Panes are wrapped already, so only an unexpectedly long body row lands
  // here.
  const inner = o.width - 4;
  const bars = (line: string): string[] =>
    wrapDisplay(line, inner, BODY_INDENT).map(row => `${side} ${padDisplay(row, inner)} ${side}`);
  const panes = o.panes
    .filter(p => p.lines.length > 0)
    .flatMap(p => [rule('├┤', p.title, o.paint, o.width), ...p.lines.flatMap(bars)]);
  return [
    '',
    rule('╭╮', o.title, o.paint, o.width),
    ...o.body.flatMap(bars),
    ...panes,
    o.paint(`╰${'─'.repeat(o.width - 2)}╯`, 'dim'),
    '',
  ];
}

/** Rows the frame itself costs: two blank lines, two rules, and one divider per pane. */
export const chromeLines = (panes: number): number => 4 + panes;
