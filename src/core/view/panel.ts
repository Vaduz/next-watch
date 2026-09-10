/** Assemble the body sections and the log panes into **one screen**.
 *
 *  The sections themselves are `blocks.ts` and `lines.ts`, the panes are `panes.ts`, and the
 *  row allocation is `layout.ts`. What lives here is the order they go in and the decision to
 *  fit them into the terminal's height.
 *
 *  The panes are derived from the panel rather than listed: one per server, plus the event
 *  log. */
import { wrapDisplay } from '../term/index.js';
import { BODY_INDENT, frame, type FramePane, type Paint } from '../term/index.js';
import { EVENT_PANE, paneNamesOf } from '../panes.js';
import type { AccessPane, WatchPanel } from '../types.js';
import {
  selfTitle,
  since,
  type PaneBudget,
  type PaneName,
  type WatchClock,
  type WatchLayout,
  type WatchView,
} from './index.js';
import { innerWidth, paneBudget } from './layout.js';
import { quotaBlock, serverBlock, serviceBlock, sessionBlock, taskBlock } from './blocks.js';
import { repoLines, sshLine, versionLine } from './lines.js';
import { accessGroups, accessPane, accessTitle, eventGroups, eventPane, fitGroups, paneTitle } from './panes.js';

/** How a watcher nobody is typing at (a pipe, a single run) is drawn. */
const NO_VIEW: WatchView = { selected: null, scroll: {}, focus: null };

/** Join sections with a single blank line between them; an empty section disappears. */
function joinBlocks(blocks: readonly string[][]): string[] {
  const out: string[] = [];
  for (const block of blocks.filter(b => b.length > 0)) {
    if (out.length) out.push('');
    out.push(...block);
  }
  return out;
}

/** The rows the frame costs at minimum: the blank lines above and below, and the two rules. */
const FRAME_MIN_LINES = 4;

/** Cut a body that will not fit the terminal. The sections are in the order worth reading
 *  (repository, servers, ...), so what goes is taken from the bottom. */
function clipBody(body: readonly string[], height: number): string[] {
  return body.slice(0, Math.max(0, height - FRAME_MIN_LINES));
}

/** The body inside the frame, above the log panes. Its row count decides the panes' share,
 *  which is why it is a separate function.
 *
 *  ⚠️ **Wrap first, then count.** Task commands and session titles are not truncated, so one
 *  of them can become two or three rows inside the frame. Deciding the panes' share from the
 *  unwrapped count makes the real screen taller than the terminal, and every redraw scrolls it
 *  by a screen — which reads as flicker. Wrapping here at the same width and indent `frame`
 *  uses means `frame` never has to wrap anything itself. */
function panelBody(p: WatchPanel, paint: Paint, layout: WatchLayout, view: WatchView, clock: WatchClock): string[] {
  const blocks = [
    [...repoLines(p, paint, clock), ...sshLine(p, paint, view)],
    serverBlock(p, paint, view),
    taskBlock(p, paint, view),
    quotaBlock(p, paint, layout, clock),
    sessionBlock(p, paint, view),
    serviceBlock(p, paint, layout, view),
    // On a short terminal the bottom goes first (see `clipBody`), and this is what can go.
    versionLine(p, paint, view),
  ];
  const wrapped = joinBlocks(blocks).flatMap(l => wrapDisplay(l, innerWidth(layout), BODY_INDENT));
  return clipBody(wrapped, layout.height);
}

/** How many **rows** (not entries) each pane holds. Counting entries would give a pane holding
 *  one long wrapped entry a share of one row, which would show only its first line. */
function paneHave(p: WatchPanel, paint: Paint, layout: WatchLayout, clock: WatchClock): PaneBudget {
  const rows = (groups: readonly (readonly string[])[]): number => groups.reduce((n, g) => n + g.length, 0);
  const have: Record<PaneName, number> = { [EVENT_PANE]: rows(eventGroups(p.events, paint, layout, clock)) };
  for (const [name, pane] of Object.entries(p.access)) {
    have[name] = rows(accessGroups(pane, paint, layout, clock));
  }
  return have;
}

/** How many **entries** each pane is currently showing, which is what the scroll limit needs.
 *  An entry can wrap to several rows, so using the row budget as an entry count would report
 *  "nothing older to see" while older entries are still off screen. */
export function watchPaneEntries(
  p: WatchPanel,
  paint: Paint,
  layout: WatchLayout,
  clock: WatchClock,
  view: WatchView = NO_VIEW,
  focus: PaneName | null = null,
): PaneBudget {
  const budget = watchPaneBudget(p, paint, layout, clock, focus);
  const entries: Record<PaneName, number> = {
    [EVENT_PANE]: fitGroups(
      eventGroups(p.events, paint, layout, clock),
      budget[EVENT_PANE] ?? 0,
      view.scroll[EVENT_PANE] ?? 0,
    ).entries,
  };
  for (const [name, pane] of Object.entries(p.access)) {
    entries[name] = fitGroups(
      accessGroups(pane, paint, layout, clock),
      budget[name] ?? 0,
      view.scroll[name] ?? 0,
    ).entries;
  }
  return entries;
}

/** How many **rows** each pane will actually draw, so the caller knows how far the cursor can
 *  scroll. The cursor's position does not change the row count, so `NO_VIEW` is enough here. */
export function watchPaneBudget(
  p: WatchPanel,
  paint: Paint,
  layout: WatchLayout,
  clock: WatchClock,
  focus: PaneName | null = null,
): PaneBudget {
  return paneBudget(
    layout,
    panelBody(p, paint, layout, NO_VIEW, clock).length,
    paneHave(p, paint, layout, clock),
    focus,
  );
}

/** Do not draw an empty frame when the focused pane holds nothing (a log with nothing in it
 *  yet). The body is hidden, so otherwise the screen would offer no clue at all. */
function fillFocused(
  panes: readonly FramePane[],
  names: readonly PaneName[],
  focus: PaneName | null,
  paint: Paint,
): FramePane[] {
  if (focus === null) return [...panes];
  const at = names.indexOf(focus);
  if (at < 0 || (panes[at]?.lines.length ?? 0) > 0) return [...panes];
  return panes.map((p, i) => (i === at ? { ...p, lines: [paint('(nothing here yet)', 'dim')] } : p));
}

/** The heading for one pane: the event log, or a server's access log. Every name other than
 *  the event pane comes from `p.access`, so its pane is always there. */
function headingFor(name: PaneName, access: AccessPane, view: WatchView, width: number): string {
  if (name === EVENT_PANE) return paneTitle(name, 'event log', view);
  return paneTitle(name, accessTitle(`${name} access`, access, width), view);
}

/** One panel. Deciding not to print the same thing again belongs to the caller. */
export function renderWatchPanel(
  p: WatchPanel,
  paint: Paint,
  layout: WatchLayout,
  clock: WatchClock,
  view: WatchView = NO_VIEW,
): string[] {
  const title = `${selfTitle(p.selfVersion)}  ${clock.time(p.nowMs)}  up ${since(p.nowMs, p.startedAtMs)}`;
  const focus = view.focus ?? null;
  // A focused pane hides the body, so that pane gets the whole frame.
  const body = focus === null ? panelBody(p, paint, layout, view, clock) : [];
  const budget = paneBudget(layout, body.length, paneHave(p, paint, layout, clock), focus);
  const names = paneNamesOf(p);
  const panes: FramePane[] = names.map(name => {
    const rows = budget[name] ?? 0;
    const scroll = view.scroll[name] ?? 0;
    const access = p.access[name];
    return {
      title: headingFor(name, access, view, layout.width),
      lines:
        name === EVENT_PANE
          ? eventPane(p.events, paint, layout, rows, scroll, clock)
          : accessPane(access, paint, layout, rows, scroll, clock),
    };
  });
  return frame({ title, body, panes: fillFocused(panes, names, focus, paint), paint, width: layout.width });
}
