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

export type { ResolvedProviders, ServiceSpec, ToolSpec, ToolsSetting, WatchProviders } from './io/providers.js';

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
  /** The steps `restart` will take, in order, for `--dry-run` to print without running them.
   *  Omitted means the dry run says only that this server would restart, which is all it could
   *  honestly say about a function it cannot look inside. */
  describeRestart?: () => readonly string[];
  /** Whether the watch **starts this server when it starts**.
   *
   *  A described server sets it, because the watcher is the only thing that could start it: it
   *  spawns the child itself, so a described server nobody started is a row saying `down` for
   *  ever. An adapter written by hand leaves it out, because whether its server is already
   *  running — under systemd, in another terminal, since last week — is the repository's
   *  business and not something to decide on its behalf.
   *
   *  ⚠️ Never on `--once` or `--dry-run`: one looks and leaves, and the other promises that the
   *  run changes nothing. */
  autostart?: boolean;
}

/** One server **described rather than written**: an npm script, and the handful of decisions
 *  that surround running one.
 *
 *  Everything `WatchServerAdapter` asks for can be derived from a script name — that is what
 *  `--start` on the command line already does — and the fields below are the ones a repository
 *  cannot derive: what to build first, what to prepare before each start, and which incoming
 *  paths call for a restart. A repository that needs more than these writes an adapter; the two
 *  forms may be mixed in one `servers` array.
 *
 *  `{ id: 'dev', script: 'dev' }` is exactly what `--start dev` builds. */
export interface ScriptServerEntry {
  /** The id used as the key everywhere: the pane name, the target key, the plan's `restart`. */
  id: string;
  /** The npm script to run, as `<pm> run <script>`. The package manager is read from the
   *  lockfile in the checkout. */
  script: string;
  /** What to call it on screen. Defaults to the id. */
  label?: string;
  /** A script to run **before anything is stopped**. A build that fails leaves the running
   *  server alone and says so, which is the rule every adapter here is held to. */
  build?: string;
  /** Whether this server **outlives the watch**.
   *
   *  A detached server is spawned into its own process group with its output going to the log
   *  file, tracked through `<logDir>/servers/<id>.pid`, and **adopted** by the next watch that
   *  finds the process still running — so closing the dashboard does not take the site down, and
   *  opening it again does not start a second one onto a taken port.
   *
   *  ⚠️ It is **not stopped when the watch exits**, which is the whole point: stopping it is a
   *  thing somebody asks for, with `(s)top` on the screen or by signalling it themselves. */
  detached?: boolean;
  /** What to prepare before **every** start, including the one inside a restart: an npm script
   *  name, or a function.
   *
   *  ⚠️ It runs **before the stop**, so the old server is still serving while it works. That is
   *  what keeps a restart from adding a gap — and it means that if the preparation rewrites
   *  something the running server reads, judging that effect is the repository's own business.
   *
   *  A failure leaves the old server running, exactly as a failed build does. */
  preStart?: string | ((emit: Emit) => Promise<void>);
  /** Restart **only** when an incoming path starts with one of these. Prefixes, so `web/`
   *  covers that tree and a whole file name works too. */
  restartPaths?: readonly string[];
  /** Restart for **anything except** these prefixes (and test-only files, and root-level
   *  documents). The opposite shape of `restartPaths`; giving both is an error. */
  ignorePaths?: readonly string[];
}

/** What `servers` accepts: a described server, or one written out in full. */
export type WatchServerSpec = WatchServerAdapter | ScriptServerEntry;

/** Whether a `servers` entry is the described form. **Having `script` is what decides it** —
 *  the same test `loadConfig` uses, so the type guard and the validation cannot disagree. */
export function isScriptServer(spec: WatchServerSpec): spec is ScriptServerEntry {
  return typeof (spec as ScriptServerEntry).script === 'string';
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
  /** The servers, in the order they appear on screen. Each one is either described
   *  (`ScriptServerEntry`) or written out (`WatchServerAdapter`); the two may be mixed. */
  servers: WatchServerSpec[];
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

/** The loop only ever sees adapters, so a described server has to have become one first.
 *
 *  Turning a script into an adapter means spawning children and streaming their output, which
 *  belongs to the composition root and not here — `startWatch` does it on the way in. This only
 *  says so when something skipped that step, because a server silently missing from the screen
 *  is the worst way to find out. */
function alreadyAnAdapter(spec: WatchServerSpec): WatchServerAdapter {
  if (!isScriptServer(spec)) return spec;
  throw new Error(
    `server ${spec.id}: a described server is turned into an adapter by startWatch, not by resolveConfig`,
  );
}

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
    servers: config.servers.map(alreadyAnAdapter),
    tasks: config.tasks ?? ((): TaskRow[] => []),
    afterPull: config.afterPull ?? [],
    providers: buildProviders({ appName: config.appName, providers: config.providers ?? {} }),
  };
}
