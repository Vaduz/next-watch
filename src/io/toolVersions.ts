/** The **version of each agent CLI installed here**, and the newest one published upstream.
 *
 *  Two reads:
 *
 *   1. What is installed — `<command> --version`, run once.
 *   2. What is out — GitHub's `releases/latest` for that repository (prereleases and drafts are
 *      not in it).
 *
 *  The watcher stays up and calls this over and over, so both obey the same rules:
 *   - Always a timeout. Something going quiet must not take the watch with it.
 *   - Never throw. Failing to read becomes part of the row and the watch carries on — dropping
 *     the row would hide that the tool was ever there.
 *   - A `latest` that could not be fetched **keeps the previous value**. Resetting it to null
 *     would make the next successful read announce a new release that is not new.
 *
 *  How often it actually reaches out is the caller's `ttlMs`; in between, the previous result
 *  is returned. GitHub allows 60 unauthenticated requests an hour, so a ten-minute interval
 *  over two repositories uses a fifth of that. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseReleaseTag, parseToolVersion } from '../core/toolVersionView.js';
import type { ToolVersionRow } from '../core/types.js';

const VERSION_TIMEOUT_MS = 10_000;
const RELEASE_TIMEOUT_MS = 6_000;
/** How long to wait after a 403 / 429 whose reset time could not be read. */
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 30 * 60_000;

/** One CLI to watch. `command` is what appears on the panel; `repo` is where its releases are. */
export interface ToolSpec {
  command: string;
  repo: string;
  /** Whether the watcher installs a new release itself when one appears. */
  autoUpdate?: boolean;
}

const run = promisify(execFile);

/** What is installed (`<command> --version`). */
async function readInstalled(command: string): Promise<Pick<ToolVersionRow, 'version' | 'error'>> {
  try {
    const { stdout } = await run(command, ['--version'], { timeout: VERSION_TIMEOUT_MS, encoding: 'utf8' });
    const version = parseToolVersion(stdout);
    if (version === null) return { version: null, error: 'no version in the output' };
    return { version, error: null };
  } catch (err) {
    return { version: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** While rate limited, nothing is asked. One counter across repositories: it is one API. */
let blockedUntilMs = 0;

/** When it is allowed to ask again, from `x-ratelimit-reset` (epoch seconds) or `retry-after`
 *  (seconds). */
function backoffUntilMs(headers: Headers, nowMs: number): number {
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset * 1000 > nowMs) return reset * 1000;
  const retryAfter = Number(headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return nowMs + retryAfter * 1000;
  return nowMs + DEFAULT_RATE_LIMIT_BACKOFF_MS;
}

/** The newest release upstream, or the reason it could not be read. */
async function fetchLatest(repo: string, nowMs: number, userAgent: string): Promise<string | { error: string }> {
  if (nowMs < blockedUntilMs) return { error: 'GitHub rate limited (backing off)' };
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': userAgent },
      signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
    });
    if (res.status === 403 || res.status === 429) {
      blockedUntilMs = backoffUntilMs(res.headers, nowMs);
      return { error: `GitHub HTTP ${res.status} (backing off)` };
    }
    if (!res.ok) return { error: `GitHub HTTP ${res.status}` };
    const body = (await res.json()) as { tag_name?: unknown };
    const tag = typeof body.tag_name === 'string' ? parseReleaseTag(body.tag_name) : null;
    return tag ?? { error: 'no tag in the latest release' };
  } catch (err) {
    return { error: `cannot reach GitHub (${err instanceof Error ? err.message : String(err)})` };
  }
}

/** One row. `previous` is the last result, which a failed `latest` is carried over from. */
async function readOne(
  tool: ToolSpec,
  o: { nowMs: number; userAgent: string },
  previous: ToolVersionRow | undefined,
): Promise<ToolVersionRow> {
  const [installed, latest] = await Promise.all([
    readInstalled(tool.command),
    fetchLatest(tool.repo, o.nowMs, o.userAgent),
  ]);
  const base = { name: tool.command, ...installed };
  if (typeof latest === 'string') return { ...base, latest, latestError: null };
  return { ...base, latest: previous?.latest ?? null, latestError: latest.error };
}

let cache: { atMs: number; rows: ToolVersionRow[] } | null = null;

/** Forget the installed versions. Called **right after an update was run**: the caller knows
 *  the version moved, and waiting out the TTL would leave the old one on screen for minutes.
 *  `latest` is worth keeping, so the rows are aged rather than dropped. */
export function forgetInstalledVersions(): void {
  if (cache === null) return;
  cache = { atMs: 0, rows: cache.rows };
}

/** The installed and upstream versions. Within `ttlMs` the previous result is returned as is. */
export async function toolVersionRows(o: {
  tools: readonly ToolSpec[];
  nowMs: number;
  ttlMs: number;
  userAgent: string;
}): Promise<ToolVersionRow[]> {
  if (cache !== null && o.nowMs - cache.atMs < o.ttlMs) return cache.rows;
  const previous = new Map((cache?.rows ?? []).map(r => [r.name, r]));
  const rows = await Promise.all(
    o.tools.map(t => readOne(t, { nowMs: o.nowMs, userAgent: o.userAgent }, previous.get(t.command))),
  );
  cache = { atMs: o.nowMs, rows };
  return rows;
}
