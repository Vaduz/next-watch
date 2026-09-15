/** The two readings behind `--start <script>` that follow from strings alone: what a server's
 *  own output says about where it is listening, and what the watcher may call itself when
 *  nobody wrote a config file.
 *
 *  Which package manager runs the script is `packageManager.ts`, because the install after a
 *  dependency change needs the same answer. */

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
