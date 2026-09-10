/** The **log panes** below the body: the events and the access logs. A pane is also the unit
 *  that scrolls.
 *
 *  Both put **the newest at the bottom**, the way a log scrolls in a terminal, and what does
 *  not fit is dropped **one whole entry at a time from the oldest end** — never cut mid-entry. */
import { accessClass, formatMs, type AccessRow } from '../accessLog.js';
import { truncateDisplay, wrapDisplay } from '../term/index.js';
import { eventLine, renderCells, type Cell, type Paint, type Tone } from '../term/index.js';
import type { AccessPane, WatchEvent } from '../types.js';
import { type PaneName, type WatchClock, type WatchLayout, type WatchView } from './index.js';
import { innerWidth } from './layout.js';

/** Indent for wrapped continuations, **aligned with the start of the text**. An event row is
 *  `HH:MM:SS ✕ text`, so eleven columns; an access row is `HH:MM:SS  text`, so ten. */
const EVENT_INDENT = ' '.repeat(11);
const ACCESS_INDENT = ' '.repeat(10);

/** Fit entries into a pane. **Nothing is cut mid-entry; whole entries are dropped from the
 *  oldest end** — a cut leaves rows whose beginning is missing, and nobody can tell what they
 *  continue. When even the newest entry alone exceeds the budget, it is shown **from its
 *  start**, because a continuation without its timestamp and opening words reads as nothing.
 *
 *  `offset` counts **entries** back from the end, and the returned `entries` is how many were
 *  actually shown, which is what the scroll limit is computed from. The budget is in rows and
 *  the scrolling is in entries, so an entry that wraps to several rows would otherwise put the
 *  older ones out of reach. */
export function fitGroups(
  groups: readonly (readonly string[])[],
  budget: number,
  offset = 0,
): { lines: string[]; entries: number } {
  if (budget <= 0 || groups.length === 0) return { lines: [], entries: 0 };
  // Scrolling past the start still shows at least one entry.
  const end = Math.max(1, groups.length - Math.max(0, Math.floor(offset)));
  const lines: string[] = [];
  let entries = 0;
  for (let i = end - 1; i >= 0; i--) {
    const group = groups[i];
    if (lines.length + group.length > budget) break;
    lines.unshift(...group);
    entries += 1;
  }
  if (entries > 0) return { lines, entries };
  return { lines: [...groups[end - 1]].slice(0, budget), entries: 1 };
}

/** One event becomes several wrapped rows, kept **bundled per entry** so a bundle is never
 *  cut in half. */
export function eventGroups(
  events: readonly WatchEvent[],
  paint: Paint,
  layout: WatchLayout,
  clock: WatchClock,
): string[][] {
  // `eventLine` starts with a two-column indent; inside the frame the border already does
  // that job, so it is dropped.
  return events.map(e =>
    wrapDisplay(
      eventLine(clock.time(e.atMs), e.mark, e.text, paint, e.tone).slice(2),
      innerWidth(layout),
      EVENT_INDENT,
    ),
  );
}

/** The event pane. **Newest at the bottom**, the way a log scrolls in a terminal. */
export function eventPane(
  events: readonly WatchEvent[],
  paint: Paint,
  layout: WatchLayout,
  count: number,
  offset: number,
  clock: WatchClock,
): string[] {
  return fitGroups(eventGroups(events, paint, layout, clock), count, offset).lines;
}

const ACCESS_TONE: Record<string, Tone> = {
  ok: 'ok',
  redirect: 'dim',
  clientError: 'warn',
  serverError: 'bad',
  unknown: 'dim',
};

/** The cells of one access row; `renderCells` does the alignment.
 *
 *  **The URL, whose length is unbounded, goes last.** `renderCells` sizes a column to its
 *  widest cell, so a single long URL in a middle column would pad every row out to that width
 *  and wrap even the short ones. */
function accessCells(r: AccessRow, clock: WatchClock): Cell[] {
  const at: Cell = { text: r.atMs === null ? '' : clock.time(r.atMs), tone: 'dim' };
  if (r.method === null) return [at, { text: r.target, tone: 'dim' }];
  const tone = ACCESS_TONE[accessClass(r.status)];
  return [
    at,
    { text: r.method, tone: 'dim' },
    { text: r.status === null ? '' : String(r.status), tone, right: true },
    { text: formatMs(r.ms), tone: 'dim', right: true },
    { text: r.target },
  ];
}

/** One access row becomes several wrapped rows. The columns are sized across **every row the
 *  pane holds**, so scrolling does not move them sideways under the reader. */
export function accessGroups(pane: AccessPane, paint: Paint, layout: WatchLayout, clock: WatchClock): string[][] {
  // A long URL wraps rather than being cut, indented so the continuation sits under the text.
  return renderCells(
    pane.rows.map(r => accessCells(r, clock)),
    paint,
  ).map(l => wrapDisplay(l, innerWidth(layout), ACCESS_INDENT));
}

/** The access pane. A line that did not parse (startup, an error) is shown raw and dim. The
 *  leading column is **when the row was seen**, which is blank for rows that were already in
 *  the file before watching started. */
export function accessPane(
  pane: AccessPane,
  paint: Paint,
  layout: WatchLayout,
  count: number,
  offset: number,
  clock: WatchClock,
): string[] {
  if (!pane.rows.length) return [];
  return fitGroups(accessGroups(pane, paint, layout, clock), count, offset).lines;
}

/** The pane heading, including which file is being read, so the screen says where it is
 *  looking. */
export function accessTitle(name: string, pane: AccessPane, width: number): string {
  if (pane.file === null) return name;
  return `${name}  ${truncateDisplay(pane.file, Math.max(16, width - name.length - 12))}`;
}

/** Add **the cursor and the scroll position** to a heading. `↑N` appears only while scrolled
 *  back; showing it always would make "at the end" and "scrolled back" look the same. */
export function paneTitle(name: PaneName, title: string, view: WatchView): string {
  const cursor = view.selected === `pane:${name}` ? '› ' : '';
  const scrolled = view.scroll[name] ?? 0;
  const back = scrolled > 0 ? `  ↑${scrolled}` : '';
  // Filling the frame is stated in the heading, so the missing body has a visible reason and
  // the way back is on screen.
  const focused = view.focus === name ? '  (focused - press f or Esc to go back)' : '';
  return `${cursor}${title}${back}${focused}`;
}
