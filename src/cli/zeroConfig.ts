/** **The config for a run that has no config file.**
 *
 *  `next-watch --start dev` in a fresh Next.js checkout has to work, and everything the watcher
 *  needs is already on disk: the name in `package.json`, the lockfile that says which package
 *  manager installs, and the working directory. None of it is a guess about what the repository
 *  *means* — the moment a decision would be one (which paths must never arrive, which server
 *  restarts for what), the answer here is the blunt, safe one and the README says to write a
 *  config file.
 *
 *  This is also where a config file and `--start` are put together: they are not alternatives,
 *  and a repository with an adapter of its own can still name one more script on the command
 *  line. */
import fs from 'node:fs';
import path from 'node:path';
import { asRecord } from '../core/util.js';
import { safeAppName } from '../core/scriptServer.js';
import { packageManagerAt } from '../io/packageManager.js';
import type { PackageManagerChoice } from '../core/packageManager.js';
import { zeroConfigProviders } from '../io/providers.js';
import { loadConfig } from './load.js';
import type { Args } from './args.js';
import type { NextWatchConfig } from '../config.js';

/** What the directory itself says: which manager installs here, and what to call the watcher. */
function projectShape(root: string): { choice: PackageManagerChoice; appName: string } {
  return { choice: packageManagerAt(root), appName: appNameFor(root) };
}

/** The application's name, which names the cache and sandbox directories. */
function appNameFor(root: string): string {
  try {
    const parsed = asRecord(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as unknown);
    const name = parsed?.name;
    if (typeof name === 'string' && name.length > 0) return safeAppName(name);
  } catch {
    /* no package.json, or one that is not JSON */
  }
  return safeAppName(path.basename(root));
}

/** The config nobody wrote. */
function zeroConfig(o: { root: string; quotaSession: boolean }): NextWatchConfig {
  const { choice, appName } = projectShape(o.root);
  return {
    appName,
    root: o.root,
    branch: 'main',
    pull: {
      // ⚠️ **Nothing is blocked**, because nothing here knows what this checkout is the one
      // that writes. Inventing prefixes would refuse pulls for a reason nobody wrote down,
      // which is worse than not refusing: the watcher would look broken. A repository with a
      // database or a directory of uploads on this machine needs the config file, and the
      // README says so where the flag is documented.
      blocked: [],
      dependencyPaths: ['package.json', ...(choice.lockfile === null ? [] : [choice.lockfile])],
    },
    servers: [],
    providers: zeroConfigProviders({ quotaSession: o.quotaSession }),
  };
}

/** The message for a run that can do nothing: no file to read and no script to run. It names
 *  **both** ways out, because which one is wanted depends on the repository and the commonest
 *  cause is simply being in the wrong directory. */
function nothingToDo(configPath: string): Error {
  return new Error(
    [
      `no ${configPath} here, and no --start <script> to run without one.`,
      '  next-watch --start dev          run an npm script and watch, with no config file',
      `  next-watch --config <path>      point at a config file somewhere else`,
    ].join('\n'),
  );
}

/** The config file, or the one derived from the directory when there is none. */
async function baseConfig(args: Args): Promise<NextWatchConfig> {
  if (fs.existsSync(path.resolve(args.config))) {
    // The file wins over every default here, `providers` included: it is the statement of what
    // this machine wants, and a flag must not quietly overrule it.
    if (args.quotaSession) {
      process.stderr.write(`--quota-session is ignored: ${args.config} decides that in providers.quotaSession\n`);
    }
    return loadConfig(args.config);
  }
  if (args.start.length === 0) throw nothingToDo(args.config);
  return zeroConfig({ root: process.cwd(), quotaSession: args.quotaSession });
}

/** The config this run watches with: the file if there is one, the derived defaults if not, and
 *  the `--start` servers appended either way. */
export async function configFor(args: Args): Promise<NextWatchConfig> {
  if (args.build !== null && args.start.length === 0) {
    throw new Error('--build applies to the servers named by --start, and none were named.');
  }
  const base = await baseConfig(args);
  if (args.start.length === 0) return base;
  // ⚠️ `--build` belongs to the servers named on the command line and to no others. A config
  // file's own entries carry their own `build`, and a flag quietly building for them would
  // change what a file says without the file changing.
  const servers = args.start.map(script => ({ id: script, script, build: args.build ?? undefined }));
  // ⚠️ Two servers with one id cannot both be the pane called `dev`, the target the cursor
  // lands on, or the entry the plan restarts. Refusing is the only answer that does not pick
  // one of them silently.
  const clash = servers.find(s => base.servers.some(b => b.id === s.id));
  if (clash !== undefined) {
    throw new Error(`--start ${clash.id}: ${args.config} already has a server with that id.`);
  }
  return { ...base, servers: [...base.servers, ...servers] };
}
