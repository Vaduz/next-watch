/** **The terminal wiring.** Pick up keys, run one typed verb at a time, redraw once a second,
 *  and stop cleanly. The pulling half is `tick.ts` and the state decisions are
 *  `core/watchState.ts`.
 *
 *  The action context is built from the config, and the two refresh hooks (versions,
 *  ssh-agent) are optional, because a host need not have switched those sections on. */
import { type WatchState } from '../core/watchState.js';
import { since } from '../core/view/index.js';
import type { PaneName } from '../core/types.js';
import { applyKey, toggleFocus, FLASH_TTL_MS, type WatchKey } from '../core/watchInteraction.js';
import type { WatchTarget } from '../core/watchTargets.js';
import { actionLabel, helpLines, parseWatchCommand } from '../core/watchTargets/verbs.js';
import { runWatchAction } from './actions/dispatch.js';
import { type ActionContext, type Emit } from './actions/stream.js';
import { WatchInput } from './input.js';
import { WatchScreen } from './screen.js';

/** How often the screen is redrawn. The clock and the uptime move, so it redraws even when
 *  nothing else changed. */
const REDRAW_INTERVAL_MS = 1_000;

/** Start one verb. **This does not wait**: the event log and the bottom line say when it
 *  finished. */
export type Start = (target: WatchTarget, verb: string) => void;

/** Runs the commands typed at the screen. **One at a time**: an install or a build takes tens
 *  of seconds, and two overlapping would make it impossible to tell whose result is whose.
 *
 *  It returns both the mouth for keypresses (`submit`) and the one the watcher uses itself
 *  (`start`), so the busy check and the way a result is shown exist once. */
function commander(o: {
  root: string;
  servers: ReadonlyMap<string, import('../config.js').WatchServerAdapter>;
  handlers: ActionContext['handlers'];
  state: WatchState;
  screen: WatchScreen;
  emit: Emit;
  draw: () => Promise<void>;
  quit: () => void;
  /** Hands the terminal over for the body of an action, where there is one to hand over. */
  withTerminalPaused?: <T>(body: () => Promise<T>) => Promise<T>;
  /** Read the versions and the ssh-agent again right after an action, since both can have
   *  just changed. */
  refreshVersions: () => Promise<void>;
  refreshSsh: () => Promise<void>;
}): { submit: (line: string) => void; start: Start } {
  const { state, screen, emit } = o;
  const start: Start = (target, verb) => {
    if (state.ui.busy !== null) {
      state.ui.status = `busy: ${state.ui.busy} - wait for it to finish`;
      return;
    }
    state.ui.busy = actionLabel(target, verb);
    const ctx: ActionContext = {
      root: o.root,
      emit,
      servers: o.servers,
      handlers: o.handlers,
      withTerminalPaused: o.withTerminalPaused,
      refreshVersions: o.refreshVersions,
    };
    void runWatchAction(target, verb, ctx)
      .then(result => {
        // The outcome is one row in the event log too, but that scrolls as other events stack
        // below it. The person who typed it is looking at the bottom line, so it goes there
        // for a few seconds as well.
        state.ui.flash = { text: result.text, ok: result.ok, atMs: Date.now() };
        // Draw once at the moment it disappears; the one-second redraw would delay the
        // controls coming back by up to a second. The timer is unref'd so it never holds the
        // process open. Only on a terminal: off one, drawing here would drop a panel into the
        // log at every self-started action.
        if (!screen.live) return;
        setTimeout(() => {
          void o.draw();
        }, FLASH_TTL_MS).unref();
      })
      // `busy` is cleared in `finally`. `runWatchAction` promises not to throw, but failing to
      // clear it here would refuse every later command as busy with no way back but Ctrl-C.
      .finally(() => {
        state.ui.busy = null;
        // Whether a key is loaded has just changed. Waiting for the TTL would leave the
        // screen saying there is no key for up to a minute after one was added.
        void o.refreshSsh().finally(() => {
          if (screen.live) void o.draw();
        });
      });
  };
  return { submit: submitter(state, screen, o.quit, start), start };
}

/** Read a typed line into one of: stop, refuse, show help, fold a pane, run a verb. */
function submitter(state: WatchState, screen: WatchScreen, quit: () => void, start: Start): (line: string) => void {
  return (line: string): void => {
    const target = state.targets.find(t => t.key === state.ui.selected) ?? null;
    const command = parseWatchCommand(line, target);
    if (command.kind === 'quit') quit();
    else if (command.kind === 'error') state.ui.status = command.message;
    else if (command.kind === 'help') for (const l of helpLines()) screen.event(Date.now(), 'info', l, 'dim');
    else if (command.kind !== 'run') return;
    // Focusing a pane is presentation, so it does not take the path that starts children.
    else if (command.target.kind === 'pane') state.ui = toggleFocus(state.ui, command.target.id satisfies PaneName);
    else start(command.target, command.verb);
  };
}

/** Consume one key into one of: redraw, run a command, stop. */
function keyHandler(
  state: WatchState,
  draw: () => Promise<void>,
  run: (line: string) => void,
  quit: () => void,
): (key: WatchKey) => void {
  return (key: WatchKey): void => {
    const { ui, action } = applyKey(state.ui, key, { targets: state.targets, scrollMax: state.scrollMax });
    state.ui = ui;
    // `quit` normally leaves straight away. It only returns when it was refused because
    // something is running, and then the refusal has to be drawn.
    if (action.kind === 'quit') quit();
    else if (action.kind === 'submit') run(action.line);
    if (action.kind !== 'none') void draw();
  };
}

/** Stop. **One event is recorded first**, and only then is the terminal restored; the event log
 *  is written synchronously. Ctrl-C, SIGTERM and a typed `quit` all pass through here once.
 *
 *  While an action is running the first attempt is refused: leaving mid-restart can strand a
 *  half-stopped server. It does not refuse for ever, or there would be no way out — a second
 *  Ctrl-C or `quit` leaves anyway. `force` is for a signal from outside. */
function stopper(state: WatchState, screen: WatchScreen, restoreTerminal: () => void): (force?: boolean) => void {
  let stopped = false;
  let insisted = false;
  return (force = false): void => {
    if (stopped) return;
    if (!force && state.ui.busy !== null && !insisted) {
      insisted = true;
      state.ui.status = `busy: ${state.ui.busy} - press Ctrl-C (or type quit) again to leave it running`;
      return;
    }
    stopped = true;
    const nowMs = Date.now();
    screen.event(nowMs, 'watch', `next-watch stopped (watched for ${since(nowMs, state.startedAtMs)})`);
    restoreTerminal();
    // Leave below the drawn screen, so the shell prompt does not land on the frame.
    if (screen.live) process.stdout.write('\n');
    process.exit(0);
  };
}

/** The one-second redraw timer. Three places stop and restart it (stopping, handing the
 *  terminal over, taking it back), so the restart condition lives in one place.
 *
 *  The redraw is **separate from the watch loop**. On the same path, the clock would stop for
 *  exactly as long as a fetch or a build took, because whatever is waiting would also own the
 *  drawing. git is asynchronous to keep the event loop free, and filling that free time is
 *  this timer's job. */
function redrawTicker(draw: () => Promise<void>): { start: () => void; stop: () => void } {
  let timer: NodeJS.Timeout | null = null;
  return {
    start: (): void => {
      timer ??= setInterval(() => {
        void draw();
      }, REDRAW_INTERVAL_MS);
    },
    stop: (): void => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}

/** Build the mouth that **hands the terminal back to the person**, for a child that asks a
 *  question.
 *
 *  Raw mode is released and redrawing stops; afterwards both are restored and one screen is
 *  drawn. Failing to restore makes the shell afterwards look broken, so the restore is always
 *  in a `finally`. Where there is no terminal to hand over, the body simply runs. */
function terminalPauser(o: {
  live: boolean;
  state: WatchState;
  draw: () => Promise<void>;
  suspend: () => void;
  resume: () => void;
}): <T>(body: () => Promise<T>) => Promise<T> {
  return async <T>(body: () => Promise<T>): Promise<T> => {
    if (!o.live) return body();
    o.state.paused = true;
    o.suspend();
    // Leave below the drawn frame before the question, so it does not land on the frame.
    process.stdout.write('\n');
    try {
      return await body();
    } finally {
      o.state.paused = false;
      o.resume();
      await o.draw();
    }
  };
}

/** Wire up the terminal: keys, resizes, signals. It returns **whether keys can be read** (they
 *  cannot when the output is a pipe, and the banner says so) and the mouth the watcher uses to
 *  start a verb itself.
 *
 *  Keys are **started first**. Reading the local state takes around a second, and a key pressed
 *  during it would be lost for want of a reader, so the keyboard is live before the first
 *  screen is drawn. In raw mode Ctrl-C does not become SIGINT, so it is caught here. */
export function wireTerminal(o: {
  root: string;
  servers: ReadonlyMap<string, import('../config.js').WatchServerAdapter>;
  handlers: ActionContext['handlers'];
  state: WatchState;
  screen: WatchScreen;
  emit: Emit;
  draw: () => Promise<void>;
  refreshVersions: () => Promise<void>;
  refreshSsh: () => Promise<void>;
}): { keys: boolean; start: Start } {
  let input: WatchInput | null = null;
  const ticker = redrawTicker(o.draw);
  // Redraw at once on a resize. `layout()` re-reads the size every frame, so the next tick
  // would catch up anyway, but a frame at the wrong width would show for up to a second.
  const onResize = (): void => {
    void o.draw();
  };
  const quit = stopper(o.state, o.screen, () => {
    // Detach first, so no redraw lands after the tidying up.
    process.stdout.off('resize', onResize);
    ticker.stop();
    input?.stop();
  });
  const withTerminalPaused = terminalPauser({
    live: o.screen.live,
    state: o.state,
    draw: o.draw,
    suspend: () => {
      ticker.stop();
      input?.stop();
    },
    resume: () => {
      input?.start();
      ticker.start();
    },
  });
  const { submit, start } = commander({ ...o, quit, withTerminalPaused });
  if (o.screen.live) {
    input = new WatchInput(keyHandler(o.state, o.draw, submit, quit));
    if (!input.start()) input = null;
    process.stdout.on('resize', onResize);
    ticker.start();
  }
  // A signal from outside is not made to wait: that is somebody else's timing, and the
  // refuse-once rule belongs to the terminal.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      quit(true);
    });
  }
  return { keys: input !== null, start };
}
