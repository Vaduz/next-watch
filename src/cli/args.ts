/** The command-line arguments. The meaning and the default of every flag is decided here.
 *
 *  What a section of the panel does is **not** a flag. Those are switches in the config file,
 *  because they describe the machine rather than this run of the watcher. */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { helpLines } from '../core/watchTargets/verbs.js';
import { parseScheduleTimes } from '../core/quota/schedule.js';

export interface Args {
  /** Where the config file is. Defaults to `next-watch.config.mjs` in the working directory. */
  config: string;
  interval: number;
  once: boolean;
  dryRun: boolean;
  restart: boolean;
  panel: number;
  /** How often the local state (servers, tasks, sessions) is read, in seconds. */
  sample: number;
  /** Rows in the event pane. Null fits it to the terminal's height. */
  log: number | null;
  /** Rows in each access pane. Null fits it to the height. */
  access: number | null;
  verbose: boolean;
  /** npm scripts to run as servers of this watch, in the order they were given. Empty when
   *  none, which is every run that has a config file and nothing else. */
  start: string[];
  /** The script that has to pass before a `--start` server is stopped for a restart. Null when
   *  there is none, and then a restart is only stop-then-start. */
  build: string | null;
  /** Whether the quota-opening session may run **on a run with no config file**. A config file
   *  says what it wants in `providers`, and that wins. */
  quotaSession: boolean;
  /** The times it may run at, as they were typed (`09:00`). Empty means the automatic mode.
   *  Checked while the arguments are parsed, so an unusable one never reaches the watch. */
  quotaSessionAt: string[];
}

/** The default config file, relative to the working directory. */
export const DEFAULT_CONFIG = 'next-watch.config.mjs';

/** How the flags are presented, for a host that runs the watch from a script of its own.
 *
 *  `config: false` **removes `--config`**, for a caller that hands `startWatch` a config it
 *  built in code. A flag that is listed in `--help` and then quietly ignored is worse than a
 *  flag that is not there. */
export interface ParseArgsOptions {
  /** The name `--help` shows. Defaults to this package's own command. */
  scriptName?: string;
  /** Whether `--config` exists. Defaults to true. */
  config?: boolean;
  /** What `--version` prints.
   *
   *  ⚠️ **Pass this whenever the command is next-watch's own**, as `main` does. Left to yargs,
   *  the number is wrong the moment the package is installed as a dependency: its ESM shim
   *  guesses with `__dirname.substring(0, __dirname.lastIndexOf('node_modules'))`, which lands
   *  on **whichever project owns the `node_modules` tree** — the consuming application, not
   *  this package. Measured: a project at 1.0.0 with next-watch 0.1.5 installed printed
   *  `1.0.0`.
   *
   *  It is left undefined by default because that guess is right for a host embedding these
   *  flags in a CLI of its own: that host does own the tree, so it gets its own version, which
   *  is the correct answer for its `--version`. */
  version?: string;
}

/** The flags that say **what to run**, as opposed to how often to look at it. They are a group
 *  of their own because they are the ones that work with no config file at all: a repository
 *  that starts with `npm run dev` needs nothing written down to be watched.
 *
 *  ⚠️ `nargs: 1` on the repeatable one. Without it yargs reads a list greedily and
 *  `--start dev --once` becomes two scripts, one of them called `--once`. */
const SERVER_OPTIONS = {
  start: {
    type: 'string',
    array: true,
    nargs: 1,
    default: [] as string[],
    describe: 'run this npm script as a server (repeatable; needs no config file)',
  },
  build: {
    type: 'string',
    describe: 'npm script that must pass before a --start server is stopped for a restart',
  },
  'quota-session': {
    type: 'boolean',
    default: false,
    describe: 'with no config file, allow the session that opens a closed quota window',
  },
  'quota-session-at': {
    type: 'string',
    array: true,
    nargs: 1,
    default: [] as string[],
    // Naming times is asking for the session, so this does not need `--quota-session` beside it.
    describe: 'open the quota window only at these times (HH:MM,HH:MM); implies --quota-session',
  },
} as const;

/** The times from `--quota-session-at`, which may be repeated **and** comma-separated: a person
 *  reaching for a list writes commas, and a person scripting it repeats the flag. */
function scheduleTimesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap(v => String(v).split(',')).filter(t => t.trim() !== '');
}

/** Refused here rather than at nine o'clock: the times are read once, at startup, and a watch
 *  that starts and then quietly never opens a window is the worst of the outcomes.
 *
 *  Exported because yargs answers a failed check by printing usage and **exiting the process**,
 *  which a test cannot catch; the check itself can be held to a table. */
export function checkScheduleTimes(a: { 'quota-session-at'?: unknown }): true {
  const times = scheduleTimesFrom(a['quota-session-at']);
  if (times.length > 0) parseScheduleTimes(times, '--quota-session-at');
  return true;
}

export function parseArgs(o: ParseArgsOptions = {}, argv: readonly string[] = hideBin(process.argv)): Args {
  // The option is **not defined** rather than hidden when it is off: `strict()` then refuses
  // `--config` outright, instead of accepting it and doing nothing with it.
  const named = yargs([...argv])
    .scriptName(o.scriptName ?? 'next-watch')
    .usage('$0 [options]', 'watch a remote branch, pull it, and restart only what needs restarting');
  // Only when the caller knows the number. Calling `.version(undefined)` would not leave the
  // guess alone — it would print `unknown`.
  const base = o.version === undefined ? named : named.version(o.version);
  const a = (
    (o.config ?? true)
      ? base.option('config', { type: 'string', default: DEFAULT_CONFIG, describe: 'path to the config file' })
      : base
  )
    .option('interval', { type: 'number', default: 60, describe: 'how often to check git (seconds)' })
    .option('panel', {
      type: 'number',
      default: 600,
      describe: 'how often to redraw the status panel (seconds, 0 to hide)',
    })
    .option('sample', { type: 'number', default: 1, describe: 'how often to poll local state (seconds)' })
    .option('log', {
      type: 'number',
      describe: 'lines in the event log pane (default: as many as the terminal fits, 0 to hide)',
    })
    .option('access', { type: 'number', describe: 'lines in each access log pane (default: auto, 0 to hide)' })
    .options(SERVER_OPTIONS)
    .option('once', { type: 'boolean', default: false, describe: 'check once and exit' })
    .option('dry-run', { type: 'boolean', default: false, describe: 'report what would be pulled without pulling' })
    .option('restart', {
      type: 'boolean',
      default: true,
      describe: 'restart after pulling (--no-restart to pull only)',
    })
    .option('verbose', { type: 'boolean', default: false, describe: 'say more about what is happening' })
    // ⚠️ **Refused rather than reduced.** yargs collects a repeated option into an array, and
    // the reading below would then find no string and report no build script at all — a
    // `--start start --build build --build other` would restart without building, which is the
    // one rule this whole feature is held to. Measured against yargs 18: `build` came back
    // `['build', 'other']` and the run went on silently.
    .check(a => (Array.isArray(a.build) ? '--build takes one script, and it applies to every --start server' : true))
    .check(checkScheduleTimes)
    // The keys are documented in `--help` with the same wording the screen's own `help` uses,
    // so the two cannot say different things.
    .epilogue(`In a terminal:\n  ${helpLines().join('\n  ')}`)
    .strict()
    .alias('h', 'help')
    // `-v` is what everyone reaches for, and a watcher is a thing people run by hand.
    .alias('v', 'verbose')
    .parseSync();
  return {
    ...a,
    // Absent when the caller builds its own config, and then nothing reads it.
    config: typeof a.config === 'string' ? a.config : DEFAULT_CONFIG,
    sample: Math.max(1, a.sample),
    log: a.log ?? null,
    // yargs widens the type of an option with no default, so this is checked here.
    access: typeof a.access === 'number' ? a.access : null,
    start: Array.isArray(a.start) ? a.start.map(String) : [],
    build: typeof a.build === 'string' ? a.build : null,
    quotaSessionAt: scheduleTimesFrom(a['quota-session-at']),
  };
}
