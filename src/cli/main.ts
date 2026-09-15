/** The entry point: work out what to watch, then watch it.
 *
 *  What to watch comes from a config file, from the flags, or from both — `zeroConfig.ts` puts
 *  the three cases together. Reading the file itself is `load.ts`. */
import { parseArgs } from './args.js';
import { packageVersion } from '../io/version.js';
import { startWatch } from './watch.js';
import { configFor } from './zeroConfig.js';

export { loadConfig } from './load.js';

export async function main(argv: readonly string[]): Promise<number> {
  // The version is passed rather than guessed: see `ParseArgsOptions.version`. Null (an
  // unreadable package.json) falls back to the guess, which is no worse than what it replaces.
  const args = parseArgs({ version: packageVersion() ?? undefined }, argv);
  try {
    return await startWatch(await configFor(args), args);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
