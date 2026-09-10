/** **Reading** git's output. Pure functions; running git belongs to the io layer.
 *
 *  Three things are read: `git status --porcelain` (local uncommitted changes),
 *  `git log --format=...` (the commits that arrived) and `git diff --shortstat` (how big the
 *  change was). All three are **values to display**, never input to the decision in `plan.ts`,
 *  which is why a malformed line is dropped rather than raised. */

/** The paths out of `git status --porcelain`. A rename (`R  old -> new`) yields the new side. */
export function parsePorcelain(out: string): string[] {
  const paths: string[] = [];
  for (const line of out.split('\n')) {
    if (line.length < 4) continue;
    const rest = line.slice(3);
    const arrow = rest.indexOf(' -> ');
    paths.push(arrow === -1 ? rest : rest.slice(arrow + 4));
  }
  return paths;
}

/** The separators for `git log --format=...`. **A subject can contain spaces and any
 *  punctuation**, so neither a space nor a `|` can be the delimiter; git is asked to emit these
 *  same control characters (`%x1f` and `%x1e`). */
const FIELD_SEPARATOR = '\u001f';
const RECORD_SEPARATOR = '\u001e';

/** The `--format` passed to `git log`. Read this together with `parseCommitLog`. */
export const COMMIT_LOG_FORMAT = '--format=%H%x1f%s%x1f%an%x1f%at%x1e';

/** One commit that arrived. */
export interface WatchCommit {
  sha: string;
  subject: string;
  author: string;
  /** When it was committed (epoch ms). */
  atMs: number;
}

/** Read the commits, dropping any malformed record: these are for display only. */
export function parseCommitLog(out: string): WatchCommit[] {
  const commits: WatchCommit[] = [];
  for (const record of out.split(RECORD_SEPARATOR)) {
    const fields = record.replace(/^\n/, '').split(FIELD_SEPARATOR);
    if (fields.length < 4) continue;
    const [sha, subject, author, at] = fields;
    if (!sha) continue;
    commits.push({ sha, subject, author, atMs: Number(at) * 1000 });
  }
  return commits;
}

/** What `git diff --shortstat` said. */
export interface WatchDiffStat {
  files: number;
  insertions: number;
  deletions: number;
}

/** Read ` 12 files changed, 240 insertions(+), 33 deletions(-)`. An unreadable field is 0. */
export function parseShortstat(out: string): WatchDiffStat {
  const pick = (re: RegExp): number => Number(re.exec(out)?.[1] ?? 0);
  return {
    files: pick(/(\d+) files? changed/),
    insertions: pick(/(\d+) insertions?\(\+\)/),
    deletions: pick(/(\d+) deletions?\(-\)/),
  };
}
