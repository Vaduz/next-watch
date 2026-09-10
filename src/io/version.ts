/** This package's **own** version, read from its `package.json`.
 *
 *  The screen shows it so that a watcher left running for weeks says which next-watch is
 *  drawing it — the answer is otherwise only in whatever shell scrolled past days ago.
 *
 *  ⚠️ **`--version` deliberately does not come through here.** yargs resolves that from the
 *  entry point, so a host that embeds `parseArgs` in a CLI of its own has `--version` report
 *  *its* version, which is the right answer for that command. This is the other question —
 *  which next-watch is running — and it has one answer wherever it is asked from. */
import fs from 'node:fs';
import { asRecord } from '../core/util.js';

/** Read once. The file cannot change under a running process in any way worth following, and
 *  the panel asks every tick. `undefined` is "not read yet", which null is not. */
let cached: string | null | undefined;

export function packageVersion(): string | null {
  if (cached === undefined) cached = readPackageVersion();
  return cached;
}

/** Null rather than a guess when it cannot be read. A version is one word of a heading, and a
 *  wrong one there is worse than none at all. */
function readPackageVersion(): string | null {
  try {
    // `src/io/` and `dist/io/` are both two directories deep, so the one relative path serves
    // the sources and the build alike.
    const o = asRecord(JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')));
    // A *different* package.json two levels up — a bundler, an unusual layout — would hand over
    // a number belonging to something else, so the name is checked before the version is used.
    if (o?.name !== 'next-watch') return null;
    return typeof o.version === 'string' && o.version !== '' ? o.version : null;
  } catch {
    return null;
  }
}
