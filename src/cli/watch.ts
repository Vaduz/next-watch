/** Watch a remote branch, pull it, restart only what needs restarting, and show the state of
 *  the machine on one screen.
 *
 *  The order of the pull has reasons behind it:
 *
 *   1. The fetch **cannot raise an authentication prompt**. On a clone whose remote is https
 *      and with no terminal present, git would hang asking for credentials and the watch would
 *      die without a word.
 *   2. An incoming path the policy blocks **stops the pull**. What belongs in that list is
 *      whatever this checkout is the one that writes: receiving it means something else wrote
 *      it, and letting git overwrite the copy a running process holds open is not a conflict
 *      but destruction.
 *   3. A build runs **before anything is stopped**, and only a build that passed leads to a
 *      restart. Stopping first leaves nothing running when the incoming code is broken.
 *
 *  What it shows:
 *
 *   - Events as timestamped rows. A pull names the commits it brought, with their subjects and
 *     authors, so a server never restarts without saying why.
 *   - A panel folding the servers, the tasks, and whatever the optional providers supply into
 *     one screen. Off a terminal it is only redrawn **when the content changed**.
 *   - Log panes below it, newest at the bottom, one per server plus the watcher's own events.
 *   - Rows that overflow are **wrapped, not cut**, because the tail is where an error message
 *     and a URL are.
 *   - The bottom line shows **only what can be typed**, unless something is running, being
 *     typed, or has just finished.
 *
 *  On a terminal it is **operable, not only readable**: Tab and Shift-Tab move the cursor, a
 *  verb runs on the thing under it, and the arrow keys scroll a pane. What can be selected and
 *  what can be typed is `core/watchTargets/`; how a key behaves is `core/watchInteraction.ts`.
 *  Both are pure.
 *
 *  What is left here is **the flow**: read the arguments, look at the machine, draw a panel,
 *  go round. The pulling is `tick.ts`, the terminal is `terminal.ts`, and the state decisions
 *  are `core/watchState.ts`. */
import { renderBanner } from '../core/view/outerLines.js';
import { SaidOnce, initialState, panelDue, type WatchState } from '../core/watchState.js';
import { type Args } from './args.js';
import {
  maybeAutoUpdate,
  maybeStartQuotaSession,
  offerSshKey,
  reportLocalChanges,
  reportSshAgentChanges,
  reportVersionChanges,
  showPanel,
  waitNext,
} from './report.js';
import { runGit } from '../io/git.js';
import { packageVersion } from '../io/version.js';
import { builtInHandlers } from './actions/handlers.js';
import { streamCommand, type ActionContext, type Emit } from './actions/stream.js';
import { WatchScreen } from './screen.js';
import { assertWatchable, repoState, tick, type RunCommand } from './tick.js';
import { wireTerminal } from './terminal.js';
import { appendWatchEvent, loadWatchLog } from '../io/watchLogFile.js';
import { packageManagerAt } from '../io/packageManager.js';
import { withAdapters } from './scriptServer.js';
import { resolveConfig, type NextWatchConfig, type ResolvedConfig, type WatchServerAdapter } from '../config.js';
import path from 'node:path';

/** Open the outlet. Events are appended to the log and the pane starts **where the previous
 *  watch left off**. */
function openScreen(config: ResolvedConfig): WatchScreen {
  const logDir = path.resolve(config.root, config.logDir);
  const screen = new WatchScreen({
    persist: event => {
      appendWatchEvent(logDir, event);
    },
    timezoneOffsetMinutes: config.timezoneOffsetMinutes,
  });
  screen.restore(loadWatchLog(logDir, Date.now()));
  return screen;
}

/** The mouth for redrawing. **Never two screens at once**: keys arrive as they are pressed but
 *  collecting a panel is asynchronous, so calling it directly would interleave half-drawn
 *  screens. Requests that arrive while drawing are folded into one. */
function drawer(config: ResolvedConfig, state: WatchState, screen: WatchScreen, args: Args): () => Promise<void> {
  let drawing = false;
  let requested = 0;
  return async function draw(): Promise<void> {
    // Nothing is drawn while the terminal belongs to a person: a frame must not overwrite a
    // question they are answering.
    if (state.paused) return;
    requested += 1;
    if (drawing) return;
    drawing = true;
    try {
      while (requested > 0) {
        const taken = requested;
        await showPanel(config, state, screen, args, true);
        requested -= taken;
      }
    } finally {
      drawing = false;
    }
  };
}

/** Turn every described server into an adapter, which is the only shape the loop knows.
 *
 *  It happens here rather than in `resolveConfig` because it spawns children and streams their
 *  output, and because **`startWatch` is the door every run comes through** — the command line,
 *  and a host that builds its config in code. Doing it anywhere later would leave one of those
 *  two with servers the screen never draws.
 *
 *  The paths are resolved the same way `resolveConfig` resolves them, because the adapters need
 *  them before the config is resolved. */
function resolveScriptServers(input: NextWatchConfig): NextWatchConfig {
  const root = input.root ?? process.cwd();
  return withAdapters(input, {
    manager: packageManagerAt(root).manager,
    root,
    logDir: path.resolve(root, input.logDir ?? 'log'),
  });
}

/** Start the servers the watcher owns, which is what makes `--start dev` — and a described
 *  server in a config file — serve anything at all.
 *
 *  Which ones those are is the adapter's own answer (`autostart`), not a list of flags: a
 *  described entry in a config file and a `--start` on the command line are the same thing by
 *  the time they get here, and an adapter written by hand says nothing, because whether its
 *  server is already running is the repository's business.
 *
 *  ⚠️ **Only on the watching path.** `--once` looks and leaves, so a server started there would
 *  be stopped a second later by the process exiting — a side effect for no benefit. `--dry-run`
 *  is the promise that this run changes nothing, and spawning a server changes something. Both
 *  are checked here rather than at the call site so the reason stays next to the rule. */
async function startOwnServers(
  args: Args,
  servers: ReadonlyMap<string, WatchServerAdapter>,
  emit: Emit,
): Promise<void> {
  const mine = [...servers.values()].filter(s => s.autostart === true);
  if (args.dryRun) {
    if (mine.length > 0) emit('info', `(dry-run) would start ${mine.map(s => s.id).join(', ')}`, 'dim');
    return;
  }
  for (const server of mine) await server.start(emit);
}

/** Record the start and the stop as events. The pane resumes from the previous watch, so
 *  without these there would be no way to see where one ended and the next began. */
function reportStarted(screen: WatchScreen, args: Args, live: boolean): void {
  const modes = [
    `git every ${args.interval}s`,
    args.dryRun ? 'dry-run' : '',
    args.restart ? '' : 'no restart',
    live ? 'keys on' : 'no keys',
  ].filter(m => m !== '');
  screen.event(Date.now(), 'watch', `next-watch started (${modes.join(' · ')})`);
}

/** Run a command, which `tick` uses for the install. */
const runCommand: RunCommand = o =>
  streamCommand({ command: o.command, args: o.args, timeoutMs: 10 * 60_000, emit: () => undefined, cwd: o.cwd });

/** The single-run path (`--once`). No keys, and nothing to wait for. */
async function once(config: ResolvedConfig, args: Args, screen: WatchScreen): Promise<number> {
  const head = (await runGit(config.root, ['rev-parse', 'HEAD'])).trim();
  const state = initialState(head, Date.now());
  const emit: Emit = (mark, text, tone) => {
    screen.event(Date.now(), mark, text, tone);
  };
  await reportLocalChanges(config, state, screen, true);
  await reportVersionChanges(config, state, screen);
  await reportSshAgentChanges(config, state, screen);
  reportStarted(screen, args, false);
  const run: RunCommand = o => streamCommand({ ...o, timeoutMs: 10 * 60_000, emit });
  await tick(config, args, { said: new SaidOnce(), screen, state, emit, run });
  state.repo = await repoState(config);
  if (args.panel > 0) await showPanel(config, state, screen, args, true);
  screen.event(Date.now(), 'watch', 'next-watch stopped');
  return 0;
}

/** Everything shown before the loop starts.
 *
 *  On a terminal one screen is drawn **before the providers are asked**, because reading them
 *  takes a moment and a Tab pressed while the targets are still empty would do nothing. */
async function firstScreen(
  config: ResolvedConfig,
  state: WatchState,
  screen: WatchScreen,
  args: Args,
  keys: boolean,
): Promise<void> {
  await reportLocalChanges(config, state, screen, true);
  if (screen.live) await showPanel(config, state, screen, args, true);
  await reportVersionChanges(config, state, screen);
  banner(screen, config, state.repo.head, args);
  reportStarted(screen, args, keys);
  await showPanel(config, state, screen, args, true);
}

/** The banner, which is only printed off a terminal — on one, the panel fills the screen. */
function banner(screen: WatchScreen, config: ResolvedConfig, head: string, args: Args): void {
  if (screen.live) return;
  screen.lines(
    renderBanner(
      {
        nowMs: Date.now(),
        root: config.root,
        branch: config.branch,
        head,
        intervalSeconds: args.interval,
        dryRun: args.dryRun,
        panelSeconds: args.panel,
        remote: config.remote,
        version: packageVersion(),
      },
      screen.paint,
    ),
  );
}

/** Start watching. Returns an exit code; with `--once` it returns after one pass, and
 *  otherwise it only returns when the watch is stopped. */
export async function startWatch(input: NextWatchConfig, args: Args): Promise<number> {
  const config = resolveConfig(resolveScriptServers(input));
  assertWatchable(config.root, config.branch);
  const screen = openScreen(config);
  if (args.once) return once(config, args, screen);
  const said = new SaidOnce();
  const head = (await runGit(config.root, ['rev-parse', 'HEAD'])).trim();
  const state = initialState(head, Date.now());
  await reportSshAgentChanges(config, state, screen);
  const draw = drawer(config, state, screen, args);
  // The progress of a restart becomes events, and each one redraws, so nothing goes quiet for
  // the tens of seconds a build takes.
  const emit: Emit = (mark, text, tone) => {
    screen.event(Date.now(), mark, text, tone);
    if (screen.live) void draw();
  };
  const servers = new Map(config.servers.map(s => [s.id, s]));
  const handlers: ActionContext['handlers'] = builtInHandlers(config.providers);
  // Ask for the ssh key **before the terminal goes into raw mode**: from then on the keystrokes
  // of the passphrase would be read by the watcher instead of by `ssh-add`.
  await offerSshKey(state, screen, { root: config.root, emit, servers, handlers });
  const { keys, start } = wireTerminal({
    root: config.root,
    servers,
    handlers,
    state,
    screen,
    emit,
    draw,
    refreshVersions: () => reportVersionChanges(config, state, screen),
    refreshSsh: () => reportSshAgentChanges(config, state, screen),
  });
  await firstScreen(config, state, screen, args, keys);
  await startOwnServers(args, servers, emit);
  const run: RunCommand = o => streamCommand({ ...o, timeoutMs: 10 * 60_000, emit });
  // Deliberately endless. It stops on Ctrl-C or a typed `quit`, from the person at this
  // terminal.
  for (;;) {
    await tick(config, args, { said, screen, state, emit, run });
    await reportLocalChanges(config, state, screen);
    await reportVersionChanges(config, state, screen);
    await reportSshAgentChanges(config, state, screen);
    // The two things the watcher does on its own initiative. Both start a child and neither
    // waits for it, so the git watch keeps its rhythm.
    maybeAutoUpdate(config, state, screen, start);
    await maybeStartQuotaSession(config, state, screen, emit);
    state.repo = await repoState(config);
    // A pull always shows a panel, so what moved sits next to the report of what arrived.
    if (
      screen.live ||
      (state.lastPull?.atMs ?? 0) > state.lastPanelAtMs ||
      panelDue(args.panel, state.lastPanelAtMs, Date.now())
    ) {
      await showPanel(config, state, screen, args, screen.live);
    }
    await waitNext(config, args, state, screen, draw);
  }
}

export { runCommand };
