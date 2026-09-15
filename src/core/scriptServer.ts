/** The decisions behind `--start <script>` that follow from strings alone: which package
 *  manager runs the script, what a server's own output says about where it is listening, and
 *  what the watcher may call itself when nobody wrote a config file.
 *
 *  All three are read off a directory listing or a line of stdout, so all three are tables. */

export type PackageManager = 'npm' | 'bun' | 'pnpm' | 'yarn';

/** Which lockfile means which manager, **in the order they are looked for**.
 *
 *  ⚠️ The order is the whole content of this list, because a tree with several lockfiles is
 *  ordinary: a repository that moved from npm to bun and never deleted `package-lock.json`
 *  still installs with bun. The first hit wins, so npm is last — it is also the answer for a
 *  tree with no lockfile at all, which is an npm tree nobody has installed yet. */
const LOCKFILES: readonly { lockfile: string; manager: PackageManager }[] = [
  { lockfile: 'bun.lock', manager: 'bun' },
  { lockfile: 'bun.lockb', manager: 'bun' },
  { lockfile: 'pnpm-lock.yaml', manager: 'pnpm' },
  { lockfile: 'yarn.lock', manager: 'yarn' },
  { lockfile: 'package-lock.json', manager: 'npm' },
];

export interface PackageManagerChoice {
  manager: PackageManager;
  /** The lockfile it was read from, or null when there was none. It is also what counts as a
   *  dependency change, so the caller needs the name and not only the manager. */
  lockfile: string | null;
}

/** The package manager for a directory holding these entries. */
export function packageManagerFor(entries: readonly string[]): PackageManagerChoice {
  const found = LOCKFILES.find(l => entries.includes(l.lockfile));
  return found === undefined ? { manager: 'npm', lockfile: null } : { ...found };
}

/** Where a server said it is listening. */
export interface ServerAddress {
  url: string;
  /** The port, taken from the URL. Null where the URL named none and the scheme's default
   *  would be a guess rather than a reading. */
  port: number | null;
}

/** The two shapes a Next.js server prints its own address in:
 *
 *      - Local:        http://localhost:3000        (13 and later)
 *      ready - started server on 0.0.0.0:3000, url: http://localhost:3000   (12)
 *
 *  ⚠️ **The label is required, not decoration.** A bare `https?://` would also match a URL in
 *  an error message or a request line, and the panel would then show a status page as the
 *  address of the server. */
const LABELLED_URL = /(?:^|[\s-])(?:local|url):\s*(https?:\/\/[^\s,]+)/i;

/** The address one line of a server's output announces, or null when it announces none. */
export function parseServerAddress(line: string): ServerAddress | null {
  const m = LABELLED_URL.exec(line);
  if (m === null) return null;
  // The group matched, so it is there. `noUncheckedIndexedAccess` is off, and the compiler
  // agrees with that for once.
  const raw = m[1].replace(/[.,)]+$/, '').replace(/\/$/, '');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  return { url: raw, port: parsed.port === '' ? null : Number(parsed.port) };
}

/** A package name made safe to use as `appName`.
 *
 *  ⚠️ `appName` **names directories** — the quota cache, and the sandbox at
 *  `join(tmpdir(), appName)`. A scoped package (`@acme/site`) would put a separator in the
 *  middle of one of those paths and quietly create a tree nobody goes looking for. */
export function safeAppName(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/-+$/, '');
  return cleaned.length > 0 ? cleaned : 'next-watch';
}
