/** The command-line arguments. The meaning and the default of every flag is decided here.
 *
 *  What a section of the panel does is **not** a flag. Those are switches in the config file,
 *  because they describe the machine rather than this run of the watcher. */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { helpLines } from '../core/watchTargets/verbs.js';

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
}

export function parseArgs(o: ParseArgsOptions = {}, argv: readonly string[] = hideBin(process.argv)): Args {
  // The option is **not defined** rather than hidden when it is off: `strict()` then refuses
  // `--config` outright, instead of accepting it and doing nothing with it.
  const base = yargs([...argv])
    .scriptName(o.scriptName ?? 'next-watch')
    .usage('$0 [options]', 'watch a remote branch, pull it, and restart only what needs restarting');
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
    .option('once', { type: 'boolean', default: false, describe: 'check once and exit' })
    .option('dry-run', { type: 'boolean', default: false, describe: 'report what would be pulled without pulling' })
    .option('restart', {
      type: 'boolean',
      default: true,
      describe: 'restart after pulling (--no-restart to pull only)',
    })
    .option('verbose', { type: 'boolean', default: false, describe: 'say more about what is happening' })
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
  };
}
