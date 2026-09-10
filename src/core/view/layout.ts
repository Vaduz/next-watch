/** The frame's width and each pane's share, from the terminal's size. The shapes
 *  (`WatchLayout`, `PaneBudget`) belong to `index.ts`; this file is only the arithmetic.
 *
 *  The pane split divides among however many access panes there are, which is one per server. */
import { chromeLines } from '../term/index.js';
import { EVENT_PANE } from '../panes.js';
import type { PaneBudget, PaneName, WatchLayout } from './index.js';

/** The narrowest frame that still holds together. A terminal below this overflows sideways. */
const FRAME_MIN_WIDTH = 72;
/** Used when the terminal's size cannot be read (a pipe, a redirect to a file). */
const FALLBACK_COLUMNS = 100;
const FALLBACK_ROWS = 30;
/** The cap when rows are chosen automatically. However tall the terminal, no more than this. */
const MAX_AUTO_LOG_LINES = 20;

/** Decide the widths from `process.stdout.columns`, falling back to a default. */
export function watchLayout(
  columns: number | null | undefined,
  rows?: number | null,
  logLines: number | null = null,
  accessLines: number | null = null,
): WatchLayout {
  const width = Math.max(FRAME_MIN_WIDTH, (columns ?? FALLBACK_COLUMNS) - 2);
  // The numbers subtracted are what everything except the name costs in each table: the other
  // columns and their separators, measured and rounded.
  return {
    width,
    service: Math.max(16, width - 54),
    subject: Math.max(24, width - 42),
    bar: Math.max(12, Math.min(24, Math.round(width / 5))),
    height: Math.max(12, rows ?? FALLBACK_ROWS),
    logLines: logLines === null ? null : Math.max(0, Math.floor(logLines)),
    accessLines: accessLines === null ? null : Math.max(0, Math.floor(accessLines)),
  };
}

/** How many panes hold at least one row. Only those get a divider drawn. */
const withLines = (have: PaneBudget): number => Object.values(have).filter(n => n > 0).length;

/** Every pane at zero, so a budget can be built by filling in from there. */
const noRows = (have: PaneBudget): Record<PaneName, number> =>
  Object.fromEntries(Object.keys(have).map(name => [name, 0]));

/** The share the event pane takes; the rest is divided among the access panes.
 *  Events appear a few times a minute while access rows stream by, so the events are the ones
 *  worth showing more of. */
const EVENT_SHARE = 0.5;

/** The access panes, which is every pane that is not the event log. */
const accessNames = (have: PaneBudget): PaneName[] => Object.keys(have).filter(name => name !== EVENT_PANE);

/**
 * Divide the terminal's height among the panes.
 *
 * An explicit `--log` / `--access` wins; otherwise the remaining height is split. `have` is how
 * many rows each pane actually holds, and no pane is given more than that.
 */
export function paneBudget(
  layout: WatchLayout,
  bodyLines: number,
  have: PaneBudget,
  focus: PaneName | null = null,
): PaneBudget {
  // A focused pane takes the whole frame: no body, no other panes. The explicit row counts are
  // not applied, because focusing *is* the instruction to make this one big.
  if (focus !== null) {
    const room = Math.max(0, layout.height - chromeLines(1));
    return { ...noRows(have), [focus]: Math.min(room, have[focus] ?? 0) };
  }
  // Only panes that hold something get counted for dividers: a pane with no rows is dropped by
  // `frame` entirely, so subtracting for its divider would leave unused space at the bottom.
  // Undercounting is worse — the frame then overflows and the screen scrolls every second — so
  // what is counted is "does it hold anything", and a pane whose share rounds to zero simply
  // leaves that space blank.
  const room = Math.max(0, layout.height - bodyLines - chromeLines(withLines(have)));
  const access = accessNames(have);
  const accessRows = access.reduce((sum, name) => sum + (have[name] ?? 0), 0);
  // With no access rows at all, the events take the whole height rather than half of it.
  const share = accessRows > 0 ? EVENT_SHARE : 1;
  const auto = Math.min(MAX_AUTO_LOG_LINES, Math.max(0, Math.round(room * share)));
  const event = Math.min(layout.logLines ?? auto, have[EVENT_PANE] ?? 0);
  const rest = Math.max(0, room - event);
  const perAccess = layout.accessLines ?? Math.min(MAX_AUTO_LOG_LINES, Math.floor(rest / Math.max(1, access.length)));
  const budget: Record<PaneName, number> = { ...noRows(have), [EVENT_PANE]: event };
  for (const name of access) budget[name] = Math.min(perAccess, have[name] ?? 0);
  return budget;
}

/** The last `count` rows, `offset` of them further back. An offset past what exists is clamped
 *  here, so whoever pressed the key does not need to know how many rows there are. */
export function visibleSlice<T>(rows: readonly T[], count: number, offset: number): readonly T[] {
  if (count <= 0) return [];
  const back = Math.max(0, Math.min(Math.max(0, rows.length - count), Math.floor(offset)));
  const end = rows.length - back;
  return rows.slice(Math.max(0, end - count), end);
}

/** How much further a pane can still be scrolled back, which caps the key repeat. */
export const scrollMaxOf = (have: number, shown: number): number => Math.max(0, have - shown);

/** The width available inside the frame, which is what wrapping measures against. */
export function innerWidth(layout: WatchLayout): number {
  return layout.width - 4;
}
