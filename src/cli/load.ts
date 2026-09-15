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
  return config as NextWatchConfig;
}
