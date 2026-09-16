/** Reading the config file.
 *
 *  The config is an ES module whose default export is a `NextWatchConfig`. It is imported
 *  rather than parsed, because the server adapters and the pull policy are code — a predicate
 *  over paths cannot be written in JSON.
 *
 *  It is its own file so that `zeroConfig.ts`, which assembles the config from the file **and**
 *  from the flags, can read it without importing the entry point that calls it. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { asRecord } from '../core/util.js';
import { quotaSessionPlans, type QuotaSessionSwitch } from '../core/quota/sessionConfig.js';
import { toolsIn } from '../core/toolsConfig.js';
import type { NextWatchConfig } from '../config.js';

/** Load the config module and check that it exported something usable. The message names the
 *  path, because the commonest failure is running from the wrong directory. */
export async function loadConfig(file: string): Promise<NextWatchConfig> {
  const resolved = path.resolve(file);
  let module: unknown;
  try {
    module = (await import(pathToFileURL(resolved).href)) as unknown;
  } catch (err) {
    throw new Error(`could not read ${resolved}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const config = asRecord(module)?.default;
  const shape = asRecord(config);
  if (shape === null) throw new Error(`${resolved} must export a config as its default export`);
  if (typeof shape.appName !== 'string') throw new Error(`${resolved}: appName is required`);
  if (!Array.isArray(shape.servers)) throw new Error(`${resolved}: servers is required`);
  if (asRecord(shape.pull) === null) throw new Error(`${resolved}: pull is required`);
  for (const entry of shape.servers as unknown[]) checkServer(entry, resolved);
  checkQuotaSession(shape.providers, resolved);
  checkTools(shape.providers, resolved);
  return config as NextWatchConfig;
}

/** Check every schedule in `quotaSession` — the outer one and each CLI's own — while the file's
 *  path is still in hand.
 *
 *  `buildProviders` checks them too, but from there the only name it can give is the key. A
 *  mistyped time is a typing mistake, and the answer to one is the file it is in. */
function checkQuotaSession(providers: unknown, resolved: string): void {
  const switched = asRecord(providers)?.quotaSession;
  if (switched === undefined || typeof switched === 'boolean') return;
  if (asRecord(switched) === null) {
    throw new Error(`${resolved}: providers.quotaSession must be true, false, or an object`);
  }
  // Reading it is what checks it, and the reading names the key each list came from.
  quotaSessionPlans(switched as QuotaSessionSwitch, `${resolved}: providers.quotaSession`);
}

/** Check the `tools` switch while the file's path is still in hand, for the same reason
 *  `checkQuotaSession` does: a mistyped `autoupdate` is a typing mistake, and the answer to one
 *  is the file it is in. The defaults are irrelevant to the check, so an empty list stands in
 *  for them. */
function checkTools(providers: unknown, resolved: string): void {
  toolsIn(asRecord(providers)?.tools as Parameters<typeof toolsIn>[0], [], `${resolved}: providers.tools`);
}

/** What is wrong with one `servers` entry, or null when nothing is.
 *
 *  ⚠️ **Refused here rather than resolved quietly.** Each of these is a configuration that reads
 *  as if it meant two different things, and picking one of them would leave a repository
 *  believing the other. A server the screen draws under the wrong rule is worse than a watch
 *  that will not start. */
function faultIn(entry: Record<string, unknown>): string | null {
  const described = typeof entry.script === 'string';
  // `script` is what makes an entry a described one, so having both is a claim to be both.
  if (described && typeof entry.start === 'function') {
    return 'has both `script` and `start`: a server is either described or written out, not both';
  }
  if (!described) return typeof entry.start === 'function' ? null : 'needs either `script` or the adapter functions';
  // One list says what matters and the other says what does not. Together they say nothing.
  if (entry.restartPaths !== undefined && entry.ignorePaths !== undefined) {
    return 'has both `restartPaths` and `ignorePaths`: give the one that describes the server';
  }
  return null;
}

function checkServer(entry: unknown, resolved: string): void {
  const shape = asRecord(entry);
  if (shape === null) throw new Error(`${resolved}: every entry in servers must be an object`);
  if (typeof shape.id !== 'string' || shape.id === '') throw new Error(`${resolved}: every server needs an id`);
  const fault = faultIn(shape);
  if (fault !== null) throw new Error(`${resolved}: server ${shape.id} ${fault}`);
}
