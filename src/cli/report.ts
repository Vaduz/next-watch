/** What each pass reports: the local differences, the CLI versions, the ssh-agent, the panel
 *  and the bottom line, plus waiting for the next pass.
 *
 *  **The decisions live in `core/`, which is pure.** This calls them and puts the result on
 *  screen.
 *
 *  The version, ssh-agent and quota readers are optional: a host that switched none of them on
 *  simply has those sections absent. */
import { sleep } from '../core/util.js';
import { type SshAgentCard, type ToolVersionRow, type WatchPanel } from '../core/types.js';
import { type WatchLayout } from '../core/view/index.js';
import { renderWatchPanel } from '../core/view/panel.js';
import { nextSelection, type WatchState } from '../core/watchState.js';
import { collectWatchPanel, localSnapshot, panelKey } from './panel.js';
import { maybeStartQuotaSession, quotaSessionRows } from './quotaSession.js';
import { visibleFlash } from '../core/watchInteraction.js';
import { toolsToAutoUpdate } from '../core/toolVersionView.js';
import { sshAgentNeedsKey } from '../core/sshAgentView.js';
import { toolTarget } from '../core/watchTargets/targets.js';
import { addSshKey } from './actions/tools.js';
import type { ActionContext, Emit } from './actions/stream.js';
import type { Start } from './terminal.js';
import { verbHint } from '../core/watchTargets/verbs.js';
import { diffLocalSnapshot, sshAgentEvents, toolVersionEvents } from '../core/watchEvents.js';
import { WatchScreen } from './screen.js';
import type { ResolvedConfig } from '../config.js';

/** Only the arguments the reporting reads. */
export interface ReportArgs {
  interval: number;
  /** Whether this run promises to change nothing, which the quota session has to honour. */
  dryRun: boolean;
  sample: number;
  panel: number;
  once: boolean;
  log: number | null;
  access: number | null;
}

/** Look at the local state and report what changed since last time.
 *
 *  Nothing here reaches the network, so it can run **every second**, which is the granularity
 *  that lets a task starting show up as it happens. */
export async function reportLocalChanges(
  config: ResolvedConfig,
  state: WatchState,
  screen: WatchScreen,
  first = false,
): Promise<void> {
  const nowMs = Date.now();
  const next = await localSnapshot(config);
  // The first pass reports nothing, or every server, task and session that already existed
  // would scroll past as having just started.
  for (const e of diffLocalSnapshot(first ? null : state.local, next)) {
    screen.event(nowMs, e.mark, e.text, e.tone);
  }
  state.local = next;
}

/** Read the CLI versions and report any change. Without a provider there is nothing to read,
 *  and the section stays empty. */
export async function reportVersionChanges(
  config: ResolvedConfig,
  state: WatchState,
  screen: WatchScreen,
): Promise<void> {
  const read = config.providers.toolVersions;
  if (read === undefined) return;
  const nowMs = Date.now();
  const next = await safely<ToolVersionRow[]>(() => read(), state.versions === null ? [] : [...state.versions]);
  for (const e of toolVersionEvents(state.versions, next)) screen.event(nowMs, e.mark, e.text, e.tone);
  state.versions = next;
}

/** Read the ssh-agent and report a change in whether a key is loaded. */
export async function reportSshAgentChanges(
  config: ResolvedConfig,
  state: WatchState,
  screen: WatchScreen,
): Promise<void> {
  const read = config.providers.sshAgent;
  if (read === undefined) return;
  const nowMs = Date.now();
  const next = await safely<SshAgentCard | null>(() => read(), state.ssh);
  if (next === null) return;
  for (const e of sshAgentEvents(state.ssh, next)) screen.event(nowMs, e.mark, e.text, e.tone);
  state.ssh = next;
}

async function safely<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

/** Install a new release of a CLI the watcher itself noticed.
 *
 *  It goes through the **same path a typed `update` takes**, so everything that path already
 *  guarantees still holds: one child at a time, the result in the event log and on the bottom
 *  line, and the versions re-read when it finishes. It **does not wait** — an update that
 *  downloads would stop the git watch for as long as it took.
 *
 *  One tool per pass. If something else is running it is left for the next pass, and the memo
 *  is written **only when one is actually started**, so a skipped one comes round again. */
export function maybeAutoUpdate(config: ResolvedConfig, state: WatchState, screen: WatchScreen, start: Start): void {
  const wanted = config.providers.autoUpdate;
  if (!wanted.length || state.versions === null || state.ui.busy !== null) return;
  const [name] = toolsToAutoUpdate(state.versions, state.autoUpdated).filter(n => wanted.includes(n));
  const row = state.versions.find(v => v.name === name);
  if (row?.latest == null) return;
  // Say what it saw before doing it. Without this row the log would hold only `update tool:claude
  // done`, and afterwards there would be no way to tell why the version moved.
  screen.event(Date.now(), 'version', `${row.name} ${row.latest} is out (installed ${row.version}), updating ...`);
  state.autoUpdated = { ...state.autoUpdated, [row.name]: row.latest };
  start(toolTarget(row), 'update');
}

/** Offer to add an ssh key, **once, at startup**.
 *
 *  A watch is started by the person who owns the machine, so at that moment there is somebody at
 *  the terminal. This asks then and **never again**: a screen running unattended for hours must
 *  not stop on a question nobody is there to answer. Declining costs nothing — the panel keeps
 *  saying there is no key, and it can be added from the screen at any time. */
export async function offerSshKey(state: WatchState, screen: WatchScreen, ctx: ActionContext): Promise<void> {
  if (state.ssh === null || !sshAgentNeedsKey(state.ssh) || !process.stdin.isTTY) return;
  screen.event(Date.now(), 'prompt', 'ssh-agent has no key. Add one now (Ctrl-C to skip):');
  await addSshKey(ctx);
}

/** Draw the panel. **Nothing is printed when the content is unchanged**, except on a terminal,
 *  where the clock and the uptime move and every frame looks different anyway. */
export async function showPanel(
  config: ResolvedConfig,
  state: WatchState,
  screen: WatchScreen,
  args: ReportArgs,
  force = false,
): Promise<void> {
  const nowMs = Date.now();
  const panel = await collectWatchPanel({
    config,
    nowMs,
    startedAtMs: state.startedAtMs,
    head: state.repo.head,
    behind: state.repo.behind,
    lastPull: state.lastPull,
    // A single run has no next check, so it shows no countdown.
    nextCheckSeconds: args.once ? null : Math.max(0, Math.ceil((state.nextGitCheckAtMs - nowMs) / 1000)),
    events: screen.events(),
    local: state.local,
    versions: state.versions ?? [],
    ssh: state.ssh,
    quotaSessions: quotaSessionRows(config, state, nowMs),
  });
  state.lastPanelAtMs = nowMs;
  // The bottom line can wrap to more than one row, so it is **built before the panel's height
  // is decided**. Getting that share wrong overflows by a row, and then every redraw scrolls
  // the screen and the top is lost.
  const bottom = screen.live ? bottomLine(state, screen, screen.layout(args.log, args.access).width) : [];
  const layout = screen.layout(args.log, args.access, bottom.length);
  syncSelection(state, panel, screen, layout);
  const key = panelKey(panel);
  if (!screen.live && !force && key === state.lastPanelKey) return;
  state.lastPanelKey = key;
  const view = { selected: state.ui.selected, scroll: state.ui.scroll, focus: state.ui.focus };
  const lines = renderWatchPanel(panel, screen.paint, layout, screen.clock, view);
  screen.render([...lines, ...bottom]);
}

/** Bring **what can be selected and how far each pane scrolls** into line with the panel about
 *  to be drawn. The arithmetic is `core/watchState.ts`; this only writes it back. */
function syncSelection(state: WatchState, panel: WatchPanel, screen: WatchScreen, layout: WatchLayout): void {
  const next = nextSelection(panel, screen.paint, layout, screen.clock, state.ui);
  state.targets = next.targets;
  state.ui.selected = next.selected;
  state.ui.index = next.index;
  state.scrollMax = next.scrollMax;
}

/** The bottom line, drawn only on a terminal: the controls, what is being typed, or what is
 *  running. It wraps when it does not fit, so this is not always one row. */
function bottomLine(state: WatchState, screen: WatchScreen, width: number): string[] {
  const target = state.targets.find(t => t.key === state.ui.selected) ?? null;
  return screen.bottom(
    {
      input: state.ui.input,
      status: state.ui.status,
      busy: state.ui.busy,
      // An outcome that has aged out is dropped here. The screen redraws every second, so
      // time-based disappearance needs no timer of its own.
      flash: visibleFlash(state.ui, Date.now()),
      hint: verbHint(target),
    },
    width,
  );
}

/** Wait for the next check. **The local state is still read while waiting** (once a second by
 *  default). On a terminal the screen is redrawn; elsewhere one line is rewritten in place and
 *  leaves no history.
 *
 *  The quota schedule is looked at here too, and not in the git loop: it is a clock, and a clock
 *  whose resolution was `--interval` would fire an hour late for anyone who checks git hourly. */
export async function waitNext(
  config: ResolvedConfig,
  args: ReportArgs,
  state: WatchState,
  screen: WatchScreen,
  draw: () => Promise<void>,
  emit: Emit,
): Promise<void> {
  state.nextGitCheckAtMs = Date.now() + args.interval * 1000;
  for (;;) {
    const nowMs = Date.now();
    if (nowMs >= state.nextGitCheckAtMs) break;
    await sleep(Math.min(args.sample * 1000, state.nextGitCheckAtMs - nowMs));
    if (Date.now() >= state.nextGitCheckAtMs) break;
    await reportLocalChanges(config, state, screen);
    await maybeStartQuotaSession(config, state, screen, emit, { dryRun: args.dryRun });
    if (screen.live) await draw();
    else
      screen.beat({
        nowMs: Date.now(),
        startedAtMs: state.startedAtMs,
        head: state.repo.head,
        nextCheckSeconds: 0,
        note: null,
      });
  }
  screen.clearBeat();
}
