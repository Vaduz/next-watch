// The state carried through a watch, and the decisions made on top of it.
//
// **This is pure.** Nothing is mutated: the next value is returned and the caller writes it
// back. It is separate from the side that owns the terminal because deciding what to select
// and when to redraw is only arithmetic over what will be drawn, which a test can pin down.
import { type Paint } from './term/index.js';
import { EVENT_PANE, paneNamesOf } from './panes.js';
import { type PaneName, type SshAgentCard, type ToolVersionRow, type WatchPanel } from './types.js';
import { type WatchClock, type WatchLayout } from './view/index.js';
import { scrollMaxOf } from './view/layout.js';
import { watchPaneEntries } from './view/panel.js';
import { initialUi, type WatchUi } from './watchInteraction.js';
import { type WatchTarget } from './watchTargets.js';
import { resolveSelection, tabTargets, watchTargets } from './watchTargets/targets.js';
import { type LocalSnapshot } from './watchEvents.js';
import { type AutoUpdateMemo } from './toolVersionView.js';
import { type QuotaSessionProbe } from './quota/view.js';
import { type FiredTimes } from './quota/schedule.js';

/** What the watcher knows about **one CLI's** five-hour window: what it has already done about
 *  it, and what the last read saw.
 *
 *  `fired` is null until the schedule is **armed**, which happens on the first look at the clock
 *  rather than here: what counts as already past depends on the times, and this file is where
 *  the state begins, not where the config is read. */
export interface QuotaSessionState {
  /** The last window a message was sent to, keyed so the same one is never opened twice. Null
   *  means it has never happened. */
  probe: QuotaSessionProbe | null;
  /** Listed time (minutes since midnight) to the day it last fired on. */
  fired: FiredTimes | null;
  /** When a session was last started, for the `sent HH:MM` tail on the service line. */
  sentAtMs: number | null;
  /** The five-hour window as the last read saw it, so the line can be drawn without the
   *  `quota` section being switched on. */
  window: { open: boolean; closesAtMs: number | null } | null;
  /** Whether the CLI can be run here at all. Null before the first look; false is said once and
   *  then nothing more is attempted for it. */
  installed: boolean | null;
}

/** The current HEAD and how many commits are still to come. **It is re-read right after a
 *  pull**, so the panel and the heartbeat show the value after the merge rather than reusing
 *  what the fetch saw. */
export interface RepoState {
  head: string;
  behind: number;
}

/** The state carried for the whole watch, for redrawing the panel and for elapsed times. */
export interface WatchState {
  startedAtMs: number;
  /** When the remote is next checked, which is what the repository row counts down to. */
  nextGitCheckAtMs: number;
  lastPull: { atMs: number; commits: number } | null;
  lastPanelKey: string;
  lastPanelAtMs: number;
  /** What the previous tick saw, so the difference can become events. */
  local: LocalSnapshot;
  /** The CLI versions from the previous tick. Null means **nothing has been read yet**, and
   *  no difference is reported. */
  versions: readonly ToolVersionRow[] | null;
  /** The upstream version an update was already run for, one per CLI, so the same version is
   *  never acted on twice. */
  autoUpdated: AutoUpdateMemo;
  /** What has been done about each CLI's five-hour window, keyed by the CLI. A CLI appears
   *  here from the first look at it, so a key that is absent means it has not been looked at. */
  quotaSessions: Record<string, QuotaSessionState | undefined>;
  /** The ssh-agent from the previous tick. Null means it has never been read. */
  ssh: SshAgentCard | null;
  /** True while the terminal belongs to a person (a passphrase prompt). **Nothing redraws.** */
  paused: boolean;
  /** The current HEAD and what is still to come, carried because a keypress redraw needs it. */
  repo: RepoState;
  /** The interaction state: cursor, scroll, the line being typed. */
  ui: WatchUi;
  /** What can currently be selected, from the panel last drawn. */
  targets: readonly WatchTarget[];
  /** How far each pane can still be scrolled, which caps the arrow keys. */
  scrollMax: Record<PaneName, number>;
}

/** The initial state. The time comes from the caller, which is what keeps this pure. */
export function initialState(head: string, nowMs: number): WatchState {
  return {
    startedAtMs: nowMs,
    nextGitCheckAtMs: nowMs,
    lastPull: null,
    lastPanelKey: '',
    lastPanelAtMs: 0,
    local: { servers: [], tasks: [], sessions: [] },
    versions: null,
    autoUpdated: {},
    quotaSessions: {},
    repo: { head, behind: 0 },
    ssh: null,
    paused: false,
    ui: initialUi(),
    targets: [],
    scrollMax: { [EVENT_PANE]: 0 },
  };
}

/** **What can be selected and how far each pane scrolls**, computed against the panel about
 *  to be drawn. Writing it back is the caller's job.
 *
 *  Tasks and sessions change every second, so a selection that disappears moves to its
 *  neighbour rather than jumping back to the top. */
export function nextSelection(
  panel: WatchPanel,
  paint: Paint,
  layout: WatchLayout,
  clock: WatchClock,
  ui: WatchUi,
): { targets: readonly WatchTarget[]; selected: string | null; index: number; scrollMax: Record<PaneName, number> } {
  // While a pane fills the frame, only the panes are reachable, so nothing off screen can be
  // acted on. The position is counted against that same list, so Tab lands in the same place
  // on the way back.
  const targets = tabTargets(watchTargets(panel), ui.focus);
  const at = resolveSelection(targets, ui.selected, ui.index);
  // The scroll limit follows from **how many entries are on screen**, not how many rows. The
  // budget is in rows, and an entry that wraps to several of them would otherwise put the
  // older entries out of reach.
  const shown = watchPaneEntries(panel, paint, layout, clock, ui, ui.focus);
  return {
    targets,
    selected: at.key,
    index: at.index,
    scrollMax: scrollLimits(panel, shown),
  };
}

/** How far each pane can still be scrolled, one entry per pane the panel has. */
function scrollLimits(panel: WatchPanel, shown: Readonly<Record<PaneName, number>>): Record<PaneName, number> {
  const limits: Record<PaneName, number> = {};
  for (const name of paneNamesOf(panel)) {
    const have = name === EVENT_PANE ? panel.events.length : panel.access[name].rows.length;
    limits[name] = scrollMaxOf(have, shown[name] ?? 0);
  }
  return limits;
}

/** Whether it is time to redraw the panel. A period of zero means never. */
export const panelDue = (panelSeconds: number, lastPanelAtMs: number, nowMs: number): boolean =>
  panelSeconds > 0 && nowMs - lastPanelAtMs >= panelSeconds * 1000;

/** Remembers what was already said, so the same state is not announced every tick. Repeating
 *  the same five lines every minute buries **the next thing that actually changes**. */
export class SaidOnce {
  private last = '';
  /** True when this has not been said yet, and records that it now has been. */
  fresh(key: string): boolean {
    if (this.last === key) return false;
    this.last = key;
    return true;
  }
  clear(): void {
    this.last = '';
  }
}
