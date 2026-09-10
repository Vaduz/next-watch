/** Reading a CLI's version rows. Pure: running `--version` and fetching a release belong to
 *  `io/`. */
import type { ToolVersionRow } from './types.js';

/** Whether a newer version exists upstream. False when either side is unreadable: something
 *  unknown must not be shown as a warning. */
export function isBehind(row: ToolVersionRow): boolean {
  return row.version !== null && row.latest !== null && row.version !== row.latest;
}

/** The upstream versions the watcher has already run an update for, keyed by CLI name. */
export type AutoUpdateMemo = Readonly<Record<string, string>>;

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

/**
 * Which CLIs to update automatically.
 *
 * A CLI qualifies when it `isBehind` **and** no update has been run for that upstream version:
 * once per `latest`, and not again until upstream moves.
 *
 * ⚠️ Limiting the attempts is the whole point. `isBehind` compares **strings, not versions**,
 * so with a prerelease installed (`0.149.0-alpha.3` against a `0.148.0` release) or with a
 * registry that has not caught up, `isBehind` stays true after the update runs. Without the
 * memory it would run an update every tick and burn through the release API's hourly limit.
 */
export function toolsToAutoUpdate(rows: readonly ToolVersionRow[], attempted: AutoUpdateMemo): string[] {
  return rows.filter(r => isBehind(r) && attempted[r.name] !== r.latest).map(r => r.name);
}
