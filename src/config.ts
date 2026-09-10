/** The contract between next-watch and the repository it watches.
 *
 *  Everything specific to a repository arrives here: which files must never be pulled, which
 *  servers exist and how to restart them, where its tasks are listed. The package itself knows
 *  none of it.
 *
 *  A config file is an ES module whose default export is a `NextWatchConfig`, found at
 *  `next-watch.config.mjs` in the working directory unless `--config` says otherwise. */
import type { AfterPullHook, PullPolicy } from './core/plan.js';
import type { TaskRow } from './core/types.js';
import type { WatchServerRow } from './core/types.js';
import type { Mark, Tone } from './core/term/index.js';
import { buildProviders, type ResolvedProviders, type WatchProviders } from './io/providers.js';

export type { ResolvedProviders, ServiceSpec, ToolSpec, WatchProviders } from './io/providers.js';

/** Put one line in the event log. Adapters use this to say what they are doing while they do
 *  it, rather than writing to stdout — **the screen has a single outlet**, and anything printed
 *  around it would be scrolled away by the next redraw. */
export type Emit = (mark: Mark, text: string, tone?: Tone) => void;

/** One server the watcher knows about.
 *
 *  ⚠️ **`restart` must build before it stops anything.** Stopping first and then discovering
 *  the build is broken leaves nothing running, which is worse than the old code still serving.
 *  The package cannot enforce this, because only the adapter knows what building means. */
export interface WatchServerAdapter {
  /** The id used as the key everywhere: the pane name, the target key, the plan's `restart`. */
  id: string;
  /** What to call it on screen. Defaults to the id. */
  label?: string;
  /** Whether these incoming paths mean this server has to restart. `restartUnless` and
   *  `restartIfAny` from `next-watch/core` build the two usual shapes. */
  restartOn: (changedPaths: readonly string[]) => boolean;
  /** Read the server's current state for the panel. */
  probe: () => Promise<WatchServerRow>;
  /** Build, then stop, then start. Returns whether it ended up running. */
  restart: (emit: Emit) => Promise<boolean>;
  stop: (emit: Emit) => Promise<boolean>;
  start: (emit: Emit) => Promise<boolean>;
}

export interface NextWatchConfig {
  /** Names the temporary and cache directories, and identifies the watcher to anything it
   *  talks to. */
  appName: string;
  /** The repository to watch. Defaults to the working directory. */
  root?: string;
  /** The branch that may be pulled. Defaults to `main`. The watcher refuses to run on any
   *  other branch, because merging into the wrong one is not something a person would see. */
  branch?: string;
  /** The remote branch to watch. Defaults to `origin/<branch>`. */
  remote?: string;
  /** Where the event log and the access-log positions are kept, relative to `root` unless
   *  absolute. Defaults to `log`. */
  logDir?: string;
  /** Minutes east of UTC for every clock on screen. Defaults to **this machine's own offset**,
   *  so a repository that says nothing still shows local time. */
  timezoneOffsetMinutes?: number;
  /** What must never arrive from the remote, and what counts as a dependency change. */
  pull: PullPolicy;
  /** The servers, in the order they appear on screen. */
  servers: WatchServerAdapter[];
  /** The tasks running outside the watcher. Omitted means the section is not drawn. */
  tasks?: () => TaskRow[];
  /** Commands to run **after a pull that brought something in**, in this order, once the
   *  servers have been restarted. For what a checkout owns that no server adapter covers.
   *  `--dry-run` lists them instead of running them, and `--no-restart` skips them with the
   *  restarts. */
  afterPull?: readonly AfterPullHook[];
  /** Which of the built-in sections to draw. Omitted means none of them. */
  providers?: WatchProviders;
}

/** The config with every default filled in, which is what the loop actually reads. */
export interface ResolvedConfig {
  appName: string;
  root: string;
  branch: string;
  remote: string;
  logDir: string;
  timezoneOffsetMinutes: number;
  pull: PullPolicy;
  servers: WatchServerAdapter[];
  tasks: () => TaskRow[];
  afterPull: readonly AfterPullHook[];
  /** The switches turned into readers. The loop only ever sees this side. */
  providers: ResolvedProviders;
}

/** `getTimezoneOffset` counts minutes **west** of UTC, which is the opposite sign from every
 *  other way of writing an offset (it returns -540 in Japan, which is UTC+9). */
const localOffsetMinutes = (): number => -new Date().getTimezoneOffset();

export function resolveConfig(config: NextWatchConfig): ResolvedConfig {
  const root = config.root ?? process.cwd();
  const branch = config.branch ?? 'main';
  return {
    appName: config.appName,
    root,
    branch,
    remote: config.remote ?? `origin/${branch}`,
    logDir: config.logDir ?? 'log',
    timezoneOffsetMinutes: config.timezoneOffsetMinutes ?? localOffsetMinutes(),
    pull: config.pull,
    servers: config.servers,
    tasks: config.tasks ?? ((): TaskRow[] => []),
    afterPull: config.afterPull ?? [],
    providers: buildProviders({ appName: config.appName, providers: config.providers ?? {} }),
  };
}
