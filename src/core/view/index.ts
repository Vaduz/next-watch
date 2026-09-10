/** How the screen looks. Pure formatting only: no filesystem, no process, no clock (`now`
 *  arrives as an argument).
 *
 *  The point is that this is **not** a server status table. What the terminal is being watched
 *  for is not only how things are now, but **when something arrived and what changed because
 *  of it**; the server list is one part of that. So one panel folds servers, agent sessions,
 *  quotas and external services together, and events flow separately as timestamped rows.
 *
 *  Colour disappears entirely under `painter(false)`, so nothing reaches a pipe, and **width
 *  is measured with colour stripped**.
 *
 *  Split by meaning under `view/`:
 *    - `layout.ts` — the frame's width and each pane's share, from the terminal's size
 *    - `incoming.ts` — what a pull brought (the commits, the diff summary)
 *    - `blocks.ts` — the **tables** in the panel body (servers, quotas, tasks, sessions, services)
 *    - `lines.ts` — the **single rows** in the panel body (repository, ssh-agent, CLI versions)
 *    - `panes.ts` — the log panes below (events, access logs)
 *    - `panel.ts` — assembling the body and the panes into one screen
 *    - `outerLines.ts` — rows outside the frame (the startup banner, the bottom line, heartbeat)
 *
 *  This file holds only the vocabulary two or more of those share. */
import { clockAt, formatUptime, hourMinuteAt } from '../term/index.js';
import type { PaneName } from '../types.js';

export type { PaneName };

/** The widths allotted from the terminal's own width, decided in one place so every column
 *  trims consistently.
 *
 *  The frame spans the terminal, and the spare width goes to **the columns worth reading**
 *  (session names, task commands, commit subjects). A narrow terminal shrinks them to a
 *  minimum and truncates from there. */
export interface WatchLayout {
  /** The frame's width (the terminal minus the borders and the space beside them). */
  width: number;
  /** Width available for the name of a degraded component. */
  service: number;
  /** Width available for a commit subject. */
  subject: number;
  /** Length of a quota bar. */
  bar: number;
  /** The terminal's height, which the panel and the logs have to fit inside. */
  height: number;
  /** Rows for the event pane. Null means **fit it to whatever height is left**. */
  logLines: number | null;
  /** Rows for each access pane. Null means the same. */
  accessLines: number | null;
}

/** What the interaction looks like: what is selected, and how far each pane is scrolled back.
 *  A watcher nobody is typing at (a pipe, a single run) is drawn with nothing selected and
 *  nothing scrolled. */
export interface WatchView {
  selected: string | null;
  scroll: Readonly<Record<PaneName, number>>;
  /** The pane filling the frame, or null for the usual folded screen. */
  focus?: PaneName | null;
}

/** Rows given to each pane, keyed the same way the panes are. */
export type PaneBudget = Readonly<Record<PaneName, number>>;

/** How times are rendered. **The core never picks a time zone**: the composition root builds
 *  one of these from whatever offset the host configured, and every row that shows a clock
 *  takes it as an argument, rather than a time zone being written into the formatter. */
export interface WatchClock {
  /** `HH:MM:SS`. */
  time(ms: number): string;
  /** `HH:MM`, where seconds would be noise. */
  hourMinute(ms: number): string;
}

/** A clock at a fixed offset from UTC, in minutes (JST is 540, UTC is 0). */
export function clockWithOffset(offsetMinutes: number): WatchClock {
  return {
    time: ms => clockAt(ms, offsetMinutes),
    hourMinute: ms => hourMinuteAt(ms, offsetMinutes),
  };
}

/** The watcher's own name, as the frame's title and the startup banner both say it. */
export const SELF_NAME = 'next-watch';

/** The name with the version after it (`next-watch 0.1.4`). **Both headings go through here**,
 *  so the two cannot drift into saying it differently.
 *
 *  The version arrives as an argument because this layer reads no files; `io/version.ts` is
 *  what knows where it comes from. Null or absent gives the bare name — a heading reading
 *  `next-watch null` would be worse than one that simply does not say. */
export const selfTitle = (version: string | null | undefined): string =>
  version === null || version === undefined || version === '' ? SELF_NAME : `${SELF_NAME} ${version}`;

/** The gap between two times as `1h22m`. The future and the unknown are `-`. */
export function since(nowMs: number, thenMs: number | null): string {
  if (thenMs === null) return '-';
  return formatUptime(Math.max(0, Math.round((nowMs - thenMs) / 1000)));
}
