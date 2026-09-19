/** Reading a CLI's version rows. Pure: running `--version` and fetching a release belong to
 *  `io/`. */
import type { ToolVersionRow } from './types.js';
import { compareVersions } from './version.js';

/** Where the installed version stands against the newest release.
 *
 *  - `behind` — upstream is newer, and both were readable. **The only standing that may install.**
 *  - `current` — the same version.
 *  - `ahead` — the installed one is newer, which is what a prerelease put on by hand looks like.
 *  - `unrankable` — the two differ but at least one is not a version, so which is newer is a guess.
 *  - `unknown` — one of them is missing, because it could not be read or fetched. */
export type VersionStanding = 'behind' | 'current' | 'ahead' | 'unrankable' | 'unknown';

/** Rank a row's installed version against its newest release.
 *
 *  This is a **version** comparison, not a string one. `0.9.0` is behind `0.10.0`, which reading
 *  the two as text gets backwards, and `0.156.0-alpha.7` is ahead of the released `0.155.1`
 *  rather than merely different from it. */
export function versionStanding(row: ToolVersionRow): VersionStanding {
  if (row.version === null || row.latest === null) return 'unknown';
  const order = compareVersions(row.version, row.latest);
  if (order === null) return row.version === row.latest ? 'current' : 'unrankable';
  return order < 0 ? 'behind' : order > 0 ? 'ahead' : 'current';
}

/** Whether to point the person at `latest`: **what the screen shows**, not what may be installed.
 *
 *  A difference nothing can rank counts, because hiding a difference the watcher can plainly see
 *  would be worse than showing one it cannot explain. Installing on the strength of it would be
 *  worse still, and that is `toolsToAutoUpdate`'s decision, which asks for `behind` exactly. */
export function isBehind(row: ToolVersionRow): boolean {
  const standing = versionStanding(row);
  return standing === 'behind' || standing === 'unrankable';
}

/** One update the watcher has already run for a CLI. */
export interface AutoUpdateAttempt {
  /** The upstream version it was aiming at. */
  readonly latest: string;
  /** The installed version it started from. */
  readonly from: string;
}

/** The updates the watcher has already run, keyed by CLI name. */
export type AutoUpdateMemo = Readonly<Record<string, AutoUpdateAttempt>>;

/** Something that looks like a version (`2.1.236`, `0.149.0-alpha.3`). */
const VERSION_RE = /\d+\.\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?/;

/** The version out of a `--version` output.
 *
 *  Every CLI formats it differently (`2.1.236 (Claude Code)`, `codex-cli 0.147.0`), so the
 *  first thing that looks like a version wins. Null when there is none. */
export function parseToolVersion(output: string): string | null {
  const found = VERSION_RE.exec(output);
  return found === null ? null : found[0];
}

/** The version out of a release tag (`v2.1.237`, `rust-v0.148.0`). The prefix differs by
 *  repository, so this too just takes what looks like a version. */
export const parseReleaseTag = parseToolVersion;

/** Whether this row is the one an earlier attempt was already made for, and nothing has moved
 *  since. Both halves must match: aiming at the same `latest`, and starting from the same
 *  installed version. */
function alreadyTried(attempt: AutoUpdateAttempt | undefined, row: ToolVersionRow): boolean {
  return attempt?.latest === row.latest && attempt.from === row.version;
}

/**
 * Which CLIs to update automatically.
 *
 * A CLI qualifies when it stands **exactly** `behind` — not merely different, which is why this
 * asks `versionStanding` rather than `isBehind`. A difference nothing can rank is worth showing
 * and not worth installing over: the screen says so, and nothing here acts on it.
 *
 * On top of that, the attempt already made must not describe where it stands now — once per
 * (`latest`, the installed version it started from). Upstream moving arms another attempt, and so
 * does the installed version moving.
 *
 * ⚠️ Limiting the attempts is still the point, and the reason has narrowed to one case. An update
 * can run, exit 0 and leave the version where it was — an installer that failed quietly, or a
 * distribution that never catches up with the release. The row stays `behind`, and without the
 * memo that is an install every tick, until the release API's hourly limit is gone. Both halves
 * of the memo match in that case, so it is not retried. (Until 2026-09-19 this paragraph also
 * named a prerelease installed against an older release; version comparison ended that case by
 * ranking it `ahead`, so it is never picked at all.)
 *
 * Remembering the version it started from, rather than only the target, is what 2026-09-18 cost.
 * `codex update` resolved 0.155.0 two minutes after GitHub published 0.155.1 — the distribution
 * had not caught up — and exited 0. The target was remembered, 0.154.0 → 0.155.0 was nobody's
 * business, and ten hours passed without a second attempt. A version that moved but fell short
 * now buys exactly one more, which is enough, because the next attempt records where it landed.
 */
export function toolsToAutoUpdate(rows: readonly ToolVersionRow[], attempted: AutoUpdateMemo): string[] {
  return rows.filter(r => versionStanding(r) === 'behind' && !alreadyTried(attempted[r.name], r)).map(r => r.name);
}
