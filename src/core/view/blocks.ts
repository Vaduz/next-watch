/** The **tables** in the panel body: servers, quotas, tasks, sessions, external services.
 *
 *  Each is a table aligned by `renderCells`, and the selection cursor is a **column** at the
 *  left edge. The external services are `services.ts`: that table alone carries a second line
 *  under each row. What is shown as a single row instead (the repository, the ssh-agent, the CLI
 *  versions) is `lines.ts`.
 *
 *  Colour marks exceptions only. **A settled state gets no colour**, so every section is built
 *  so that a row colour (`RowTone`) appears only when something is wrong. */
import { displayWidth, formatUptime, truncateDisplay } from '../term/index.js';
import { bar, cell, renderCells, type Cell, type Paint, type RowTone, type Tone } from '../term/index.js';
import { quotaTone } from '../quota/view.js';
import { formatClockElapsed } from '../util.js';
import type {
  AgentSessionRow,
  QuotaCard,
  QuotaWindowView,
  TaskRow,
  ToolVersionRow,
  WatchPanel,
  WatchServerRow,
} from '../types.js';
import { since, type WatchClock, type WatchLayout, type WatchView } from './index.js';
import { sessionRestartNote } from './sessionNote.js';

/** The selection cursor, placed **only at the left edge of the selected row**. The row itself
 *  is not recoloured, because colour is reserved for trouble (down, busy, nearly full). */
const gutter = (key: string, selected: string | null): Cell => ({
  text: key === selected ? '›' : ' ',
  tone: 'accent',
});

/** The rule that a settled state takes no colour, in one place. */
const rowToneOf = (map: Record<string, RowTone>, key: string): RowTone => map[key];

const STATE_TONE: Record<WatchServerRow['state'], Tone> = { up: 'ok', down: 'dim', busy: 'warn' };

/** The servers. Fewer columns than a status listing: a pid and where a server came from are
 *  not what a watcher is for. */
export function serverBlock(p: WatchPanel, paint: Paint, view: WatchView): string[] {
  if (!p.servers.length) return [];
  const head = ['', 'SERVER', 'STATE', 'URL', 'OWNER', 'MODE', 'UPTIME'].map((t): Cell => ({ text: t, tone: 'dim' }));
  const rows = p.servers.map((s): Cell[] => {
    // `up` is the ordinary state and takes no colour. `down` is dimmed, and `busy` (something
    // else holds the port) stands out in yellow.
    const row = rowToneOf({ down: 'dim', busy: 'warn' }, s.state);
    return [
      gutter(`server:${s.server}`, view.selected),
      { text: s.server, tone: row },
      { text: s.state, tone: row ?? STATE_TONE[s.state] },
      { text: s.url, tone: row ?? (s.state === 'up' ? 'accent' : 'dim') },
      { text: s.owner ?? '-', tone: row ?? 'dim' },
      { text: s.mode ?? '-', tone: row ?? 'dim' },
      { text: formatUptime(s.uptimeSeconds), tone: row, right: true },
    ];
  });
  return renderCells([head, ...rows], paint);
}

/** One usage window as `5h  26% ██▌···  resets 21:00 (in 2h13m)`. */
function quotaWindowCells(w: QuotaWindowView, nowMs: number, barWidth: number, clock: WatchClock): Cell[] {
  const reset =
    w.resetsAtMs === null ? '' : `resets ${clock.hourMinute(w.resetsAtMs)} (in ${since(w.resetsAtMs, nowMs)})`;
  // Up to half used, the name and reset time stay dim: there is nothing to read. Past that,
  // the colour moves onto the whole row.
  const tone = quotaTone(w.usedPercent);
  const row = tone === 'ok' ? undefined : tone;
  return [
    { text: w.name, tone: row ?? 'dim' },
    { text: `${Math.round(w.usedPercent)}%`, tone, right: true },
    { text: bar(w.usedPercent, barWidth), tone },
    { text: reset, tone: row ?? 'dim' },
  ];
}

/** One backend: a heading row (`Claude  Max 5x`) and the window rows beneath it. */
function quotaRows(
  q: QuotaCard,
  nowMs: number,
  barWidth: number,
  clock: WatchClock,
): { head: Cell[]; windows: Cell[][] } {
  const head: Cell[] = [
    { text: q.label, tone: 'bold' },
    { text: q.plan ?? '', tone: 'dim' },
  ];
  if (q.error !== null || !q.windows.length) {
    return { head: [...head, { text: q.error ?? 'no quota available', tone: 'dim' }], windows: [] };
  }
  const age = q.fetchedAtMs === null ? '' : `${since(nowMs, q.fetchedAtMs)} ago${q.stale ? ' (stale)' : ''}`;
  const windows = q.windows.map((w, i) => {
    // The leading empty cell becomes a two-column indent (`renderCells` joins with two spaces).
    const row: Cell[] = [cell(''), ...quotaWindowCells(w, nowMs, barWidth, clock)];
    return i === q.windows.length - 1 && age ? [...row, cell(age, 'dim')] : row;
  });
  return { head, windows };
}

/** The quotas. A backend that could not be read **keeps its row**; dropping it would hide
 *  that anything is wrong.
 *
 *  The provider and plan go on the heading row and the windows **two columns beneath it**.
 *  As one table, the window, the percentage and the bar would all be pushed right by the width
 *  of the provider and plan columns, and the whole section would look deeply indented. */
export function quotaBlock(p: WatchPanel, paint: Paint, layout: WatchLayout, clock: WatchClock): string[] {
  if (!p.quotas.length) return [];
  const parts = p.quotas.map(q => quotaRows(q, p.nowMs, layout.bar, clock));
  // Headings and windows are aligned **separately**; in one table the window columns would be
  // dragged out to the width of the headings.
  const heads = renderCells(
    parts.map(x => x.head),
    paint,
  );
  const windows = renderCells(
    parts.flatMap(x => x.windows),
    paint,
  );
  let at = 0;
  return parts.flatMap((x, i) => {
    const rows = windows.slice(at, at + x.windows.length);
    at += x.windows.length;
    return [heads[i], ...rows];
  });
}

const TASK_TONE: Record<TaskRow['state'], Tone> = {
  running: 'ok',
  done: 'dim',
  failed: 'bad',
  lost: 'warn',
};

/** The command row of one task. **Not truncated**: it wraps if it overflows the frame. The
 *  cursor sits at this row's left edge, the same shape as a session's title row. */
function taskCommand(t: TaskRow, view: WatchView, paint: Paint, row: RowTone): string {
  const cursor = `task:${t.id}` === view.selected ? paint('›', 'accent') : ' ';
  return `${cursor} ${paint(t.label, row)}`;
}

/** The tasks: what is running, plus what finished recently. With none, the section is omitted.
 *  `lost` is a task still marked running whose pid is gone, so it is not dimmed away.
 *
 *  **The command goes whole on the first row and the metadata (ID / STATE / ELAPSED / ENDED)
 *  on the second.** A command has no bounded length once flags are added, so as a table column
 *  one long command would push every other column right — the same reason a session title gets
 *  its own row. */
export function taskBlock(p: WatchPanel, paint: Paint, view: WatchView): string[] {
  if (!p.tasks.length) return [];
  const head = ['TASK', 'ID', 'STATE', 'ELAPSED', 'ENDED'].map((t): Cell => ({ text: t, tone: 'dim' }));
  // Running is ordinary; finished is dimmed; failed and lost stand out.
  const tones = p.tasks.map(t => rowToneOf({ done: 'dim', failed: 'bad', lost: 'warn' }, t.state));
  const meta = p.tasks.map((t, i): Cell[] => {
    const row = tones[i];
    return [
      // Leave the width of the `TASK` heading empty so the metadata lines up beneath it.
      { text: '' },
      { text: t.id, tone: row ?? 'dim' },
      { text: t.state, tone: row ?? TASK_TONE[t.state] },
      // ELAPSED keeps its seconds. Steps here finish in ninety seconds, and without the
      // seconds there is no way to see one moving.
      { text: formatClockElapsed(t.elapsedSeconds), tone: row, right: true },
      {
        text: t.endedSecondsAgo === null ? '' : `${formatUptime(t.endedSecondsAgo)} ago`,
        tone: row ?? 'dim',
        right: true,
      },
    ];
  });
  const rendered = renderCells([head, ...meta], paint);
  return [rendered[0], ...p.tasks.flatMap((t, i) => [taskCommand(t, view, paint, tones[i]), rendered[i + 1]])];
}

const SESSION_TONE: Record<string, Tone | undefined> = {
  busy: 'ok',
  idle: 'dim',
  waiting: 'warn',
  shell: 'accent',
};

/** Token counts as `305k`. Every digit would be noise; only the magnitude gets used. */
export function formatTokens(n: number | null): string {
  if (n === null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** The version a session is actually running.
 *
 *  Differing from what is installed means **the CLI was replaced after the session started**,
 *  and that session is still on the old code. That takes priority over the row colour, because
 *  what matters is that restarting it would pick up the new one. With nothing installed to
 *  compare against, no comparison is made rather than lighting up every row. */
function sessionVersionCell(s: AgentSessionRow, versions: readonly ToolVersionRow[], row: RowTone): Cell {
  const installed = versions.find(v => v.name === s.agent)?.version ?? null;
  const stale = s.version !== null && installed !== null && s.version !== installed;
  return { text: s.version ?? blank(s, '-'), tone: stale ? 'warn' : (row ?? 'dim') };
}

/** What an unreadable cell says. **Empty for a row built from `ps` alone**: a dash there would
 *  read as "there is none", where the truth is that the record which holds it was never written.
 *  Every other row keeps the dash it has always had. */
function blank(s: AgentSessionRow, dash: string): string {
  return s.unrecorded === true ? '' : dash;
}

/** The title row of one session. **Not truncated**: it wraps if it overflows. The cursor sits
 *  at the left edge, and the watcher's own session is marked `*` so it is not miscounted. */
function sessionName(s: AgentSessionRow, view: WatchView, paint: Paint, row: RowTone): string {
  const cursor = `session:${s.pid}` === view.selected ? paint('›', 'accent') : ' ';
  return `${cursor} ${paint(`${s.self === true ? '*' : ''}${s.name}`, row)}`;
}

/** How far a note under a session row starts: past the cursor column, the heading column, and
 *  the two spaces `renderCells` joins columns with. Derived rather than counted, so renaming the
 *  heading cannot leave the line hanging under the wrong column. */
const SESSION_NOTE_INDENT = ' '.repeat(1 + 1 + displayWidth('SESSION') + 2);

/** The rows one session takes: its title, its metadata, and a note where it has one.
 *
 *  ⚠️ The note goes **outside the table**. `renderCells` pads every column to the widest cell in
 *  it, so putting "not in tmux · (r)estart needs tmux" in `STATUS` would widen that column on
 *  every row, for every session, to say something about one of them. */
function sessionRows(s: AgentSessionRow, title: string, meta: string, paint: Paint): string[] {
  const note = sessionRestartNote(s, s.startedSecondsAgo == null ? null : formatUptime(s.startedSecondsAgo));
  if (note === null) return [title, meta];
  return [title, meta, SESSION_NOTE_INDENT + paint(note, 'dim')];
}

/** The agent sessions. **The title goes whole on the first row and the metadata on the
 *  second**, because a title has no bounded length and as a column one long name would push
 *  every other column right. */
export function sessionBlock(p: WatchPanel, paint: Paint, view: WatchView): string[] {
  // Nobody is reading them: no section at all. Read and empty is a different thing, and it gets
  // a row saying so — otherwise there is no way to tell the reader apart from an idle machine.
  const sessions = p.sessions;
  if (sessions === null) return [];
  if (!sessions.length) return [`${paint('SESSION', 'dim')}  ${paint('no live AI sessions', 'dim')}`];
  const head = ['SESSION', 'TREE', 'AGENT', 'STATUS', 'MODEL', 'CONTEXT', 'IDLE', 'VER'].map((t): Cell => ({
    text: t,
    tone: 'dim',
  }));
  const tones = sessions.map(s => rowToneOf({ idle: 'dim', waiting: 'warn', '?': 'dim' }, s.status));
  const meta = sessions.map((s, i): Cell[] => {
    // busy is ordinary, since that is the usual state. `waiting` is yellow because something
    // is waiting on a person; a stopped one is dimmed.
    const row = tones[i];
    return [
      // Leave the width of the `SESSION` heading empty so the metadata lines up beneath it.
      { text: '' },
      { text: truncateDisplay(s.tree, 16), tone: row ?? 'dim' },
      { text: s.agent, tone: row ?? 'dim' },
      { text: s.status, tone: row ?? SESSION_TONE[s.status] ?? 'dim' },
      { text: s.model ?? blank(s, '-'), tone: row ?? 'dim' },
      { text: blank(s, formatTokens(s.contextTokens)), tone: row, right: true },
      { text: blank(s, formatUptime(s.idleSeconds)), tone: row ?? 'dim', right: true },
      sessionVersionCell(s, p.versions, row),
    ];
  });
  const rendered = renderCells([head, ...meta], paint);
  return [
    rendered[0],
    ...sessions.flatMap((s, i) => sessionRows(s, sessionName(s, view, paint, tones[i]), rendered[i + 1], paint)),
  ];
}
