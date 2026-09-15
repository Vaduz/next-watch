/** **The pulling half of one pass.** Look at the remote, decide whether it may be pulled, pull
 *  it, and restart what needs restarting. The terminal wiring is `terminal.ts` and the state
 *  decisions are `core/watchState.ts`.
 *
 *  The order has reasons behind it:
 *   1. The fetch is run in a way that cannot raise an authentication prompt.
 *   2. Anything the policy blocks stops the pull entirely.
 *   3. A build runs before anything is stopped, and only a build that passed leads to a restart
 *      (which is the adapter's responsibility; see `config.ts`).
 *
 *  The branch, the remote and the pull policy come from the config, restarting goes through
 *  the server adapters, and everything this has to say becomes an event, because the screen is
 *  the only outlet. */
import { checkBranch, runGit, tryGit, tryGitNonInteractive } from '../io/git.js';
import { conflictingDirtyPaths, describePlan, hooksToRun, planFromIncoming, type WatchPlan } from '../core/plan.js';
import {
  COMMIT_LOG_FORMAT,
  parseCommitLog,
  parsePorcelain,
  parseShortstat,
  type WatchCommit,
  type WatchDiffStat,
} from '../core/gitOutput.js';
import { describeIncoming } from '../core/view/incoming.js';
import { packageManagerAt } from '../io/packageManager.js';
import { SaidOnce, type RepoState, type WatchState } from '../core/watchState.js';
import type { ResolvedConfig } from '../config.js';
import { type Emit } from './actions/stream.js';
import { applyPlan, runAfterPull, type RunCommand } from './apply.js';
import { WatchScreen } from './screen.js';

export type { RunCommand } from './apply.js';

/** Commits and paths are **not all printed**. Forty of them arriving on a Monday must not
 *  scroll the terminal away, and what is left out is announced rather than cut silently. */
const MAX_COMMITS_SHOWN = 10;
const MAX_PATHS_SHOWN = 15;

/** Only the arguments `tick` reads. */
export interface TickArgs {
  dryRun: boolean;
  restart: boolean;
  verbose: boolean;
}

/** Whether this checkout may be watched at all. Merging the remote into a feature branch is
 *  not something anybody would see happen, so it is refused up front. */
export function assertWatchable(root: string, branch: string): void {
  const check = checkBranch(root, branch);
  if (check.ok) return;
  throw new Error(`next-watch runs on the ${branch} branch only (currently on ${check.branch}).`);
}

export interface Incoming {
  /** The remote's commit, which is also the key for not repeating a message. */
  sha: string;
  /** HEAD before the pull, so the report can say from where to where. */
  fromSha: string;
  /** Commits that exist only on the remote. Zero means nothing has arrived. */
  behind: number;
  /** Paths that changed only on the remote. */
  paths: string[];
  /** The incoming commits, newest first. **Read before the merge**, because afterwards there
   *  are none. */
  commits: WatchCommit[];
  stat: WatchDiffStat;
}

/** Fetch and read what has arrived, or null when the fetch failed.
 *
 *  git is run **asynchronously**. A synchronous spawn would stop the event loop, and the two
 *  seconds of a fetch would take the keyboard and the clock with it. */
async function fetchIncoming(config: ResolvedConfig, said: SaidOnce, screen: WatchScreen): Promise<Incoming | null> {
  const { root, remote } = config;
  const [remoteName, ...rest] = remote.split('/');
  const branch = rest.join('/');
  const fetched = await tryGitNonInteractive(root, ['fetch', '--quiet', remoteName, branch]);
  if (!fetched.ok) {
    if (said.fresh(`fetch:${fetched.out}`)) {
      screen.event(Date.now(), 'warn', `git fetch failed, still watching: ${fetched.out.trim()}`);
    }
    return null;
  }
  const [sha, fromSha, behindOut] = await Promise.all([
    runGit(root, ['rev-parse', remote]),
    runGit(root, ['rev-parse', 'HEAD']),
    runGit(root, ['rev-list', '--count', `HEAD..${remote}`]),
  ]);
  const behind = Number(behindOut.trim());
  if (behind === 0) {
    const empty = { files: 0, insertions: 0, deletions: 0 };
    return { sha: sha.trim(), fromSha: fromSha.trim(), behind, paths: [], commits: [], stat: empty };
  }
  const [names, commitLog, shortstat] = await Promise.all([
    runGit(root, ['diff', '--name-only', `HEAD...${remote}`]),
    // No `--no-merges`, to match `rev-list --count`, which counts merge commits too.
    runGit(root, ['log', COMMIT_LOG_FORMAT, `HEAD..${remote}`]),
    runGit(root, ['diff', '--shortstat', `HEAD...${remote}`]),
  ]);
  const paths = names.split('\n').filter(line => line.length > 0);
  return {
    sha: sha.trim(),
    fromSha: fromSha.trim(),
    behind,
    paths,
    commits: parseCommitLog(commitLog),
    stat: parseShortstat(shortstat),
  };
}

/** Why nothing was pulled. The heading is one timestamped row and the detail is indented
 *  beneath it; sending every line through `event` would stamp each one and make it unreadable. */
interface Refusal {
  head: string;
  details: string[];
}

/** The reason not to pull, or null when there is none. */
async function refusal(config: ResolvedConfig, incoming: Incoming, plan: WatchPlan): Promise<Refusal | null> {
  if (plan.blockers.length) {
    return {
      head: `${incoming.behind} commit(s) waiting on ${config.remote}, not pulling`,
      details: [...plan.blockers.map(b => `${b.path} - ${b.reason}`), 'look at them and pull by hand.'],
    };
  }
  const dirty = parsePorcelain(await runGit(config.root, ['status', '--porcelain']));
  const conflicts = conflictingDirtyPaths(dirty, incoming.paths);
  if (conflicts.length) {
    return {
      head: `${incoming.behind} commit(s) waiting on ${config.remote}, but they overlap uncommitted changes`,
      details: [...conflicts, 'commit them or restore them first.'],
    };
  }
  return null;
}

function reportRefusal(why: Refusal, screen: WatchScreen): void {
  screen.event(Date.now(), 'warn', why.head);
  for (const line of why.details) screen.detail(line);
}

/** Merge, and say whether it worked. */
async function merge(config: ResolvedConfig, screen: WatchScreen): Promise<boolean> {
  // A fast-forward where possible, a merge commit where the histories diverged: a checkout
  // that carries local commits of its own is an ordinary situation, so this cannot rely on
  // fast-forwarding.
  const merged = await tryGit(config.root, ['merge', '--no-edit', config.remote]);
  if (merged.ok) return true;
  await tryGit(config.root, ['merge', '--abort']);
  screen.event(Date.now(), 'error', `git merge failed and was rolled back:\n${merged.out.trim()}`);
  return false;
}

/** Report what arrived: the commits, the size of the diff, and what follows. The first row is
 *  an event and the rest is detail, so nothing lands outside the frame on a terminal.
 *
 *  The manager is passed in rather than read here, because **it is read after the merge**: the
 *  row has to name the command the install is about to run, and the merge may have brought the
 *  lockfile that decides it. */
function reportIncoming(incoming: Incoming, plan: WatchPlan, manager: string, screen: WatchScreen): void {
  const { head, details } = describeIncoming(
    {
      nowMs: Date.now(),
      fromSha: incoming.fromSha,
      toSha: incoming.sha,
      commits: incoming.commits.slice(0, MAX_COMMITS_SHOWN),
      totalCommits: incoming.behind,
      files: incoming.paths,
      totalFiles: incoming.stat.files || incoming.paths.length,
      insertions: incoming.stat.insertions,
      deletions: incoming.stat.deletions,
      plan: describePlan(plan, manager),
    },
    screen.paint,
    screen.layout(),
  );
  screen.event(Date.now(), 'change', head);
  for (const line of details) screen.detail(line);
}

/** Re-read HEAD and how far behind it is. **Read after the pull**, so the panel and the
 *  heartbeat show the state after the merge rather than reusing what the fetch saw. */
export async function repoState(config: ResolvedConfig): Promise<RepoState> {
  const [head, behind] = await Promise.all([
    runGit(config.root, ['rev-parse', 'HEAD']),
    runGit(config.root, ['rev-list', '--count', `HEAD..${config.remote}`]),
  ]);
  return { head: head.trim(), behind: Number(behind.trim()) };
}

/** One pass. The result says what arrived, which decides whether a panel is drawn. */
export async function tick(
  config: ResolvedConfig,
  args: TickArgs,
  ctx: { said: SaidOnce; screen: WatchScreen; state: WatchState; emit: Emit; run: RunCommand },
): Promise<Incoming | null> {
  const { said, screen, state } = ctx;
  const incoming = await fetchIncoming(config, said, screen);
  if (incoming === null) return null;
  if (incoming.behind === 0) {
    if (args.verbose) {
      screen.event(Date.now(), 'info', `in sync with ${config.remote} (${incoming.sha.slice(0, 7)})`, 'dim');
    }
    said.clear();
    return incoming;
  }
  const plan = planFromIncoming(incoming.paths, config.pull, config.servers);
  const why = await refusal(config, incoming, plan);
  if (why) {
    if (said.fresh(`refuse:${incoming.sha}`)) reportRefusal(why, screen);
    return incoming;
  }
  if (args.dryRun) {
    if (said.fresh(`dry:${incoming.sha}`)) reportDryRun(incoming, plan, config, screen);
    return incoming;
  }
  said.clear();
  if (!(await merge(config, screen))) return incoming;
  state.lastPull = { atMs: Date.now(), commits: incoming.behind };
  // Read after the merge: the pull may have brought the lockfile that decides it.
  reportIncoming(incoming, plan, packageManagerAt(config.root).manager, screen);
  if (args.restart) {
    // `finally`, because the hooks must run **even when a restart failed or threw**: whether a
    // crontab is current has nothing to do with whether a server came back up, and the day the
    // build breaks is exactly the day a stale schedule hurts most.
    try {
      await applyPlan(config, plan, ctx.emit, ctx.run);
    } finally {
      await runAfterPull(config, incoming.paths, ctx.emit, ctx.run);
    }
  }
  return incoming;
}

/** The dry-run report, which says what would arrive in the same shape as what did. */
function reportDryRun(incoming: Incoming, plan: WatchPlan, config: ResolvedConfig, screen: WatchScreen): void {
  const nowMs = Date.now();
  const hooks = hooksToRun(config.afterPull, incoming.paths);
  // Named rather than counted: the point of a dry run is seeing which commands would run.
  const then = hooks.length ? ` then ${hooks.map(h => h.label).join(', ')}` : '';
  // The manager as the tree stands now. A dry run pulls nothing, so nothing can change it.
  const manager = packageManagerAt(config.root).manager;
  const what = describePlan(plan, manager);
  screen.event(nowMs, 'change', `(dry-run) ${incoming.behind} commit(s) would come in -> ${what}${then}`);
  const shown = incoming.paths.slice(0, MAX_PATHS_SHOWN);
  const rest = incoming.paths.length - shown.length;
  for (const line of [...shown, ...(rest > 0 ? [`... ${rest} more file(s)`] : [])]) screen.detail(line);
  for (const line of restartSteps(config, plan)) screen.detail(line);
}

/** What each restart would actually do, for the servers that can say.
 *
 *  A plan saying `restart web` does not tell anybody whether that means building first, or
 *  preparing something, or only stopping and starting — and a dry run exists precisely to be
 *  read before trusting the real one. An adapter written by hand says nothing here, because a
 *  function cannot be looked inside. */
function restartSteps(config: ResolvedConfig, plan: WatchPlan): string[] {
  const byId = new Map(config.servers.map(s => [s.id, s]));
  const out: string[] = [];
  for (const id of plan.restart) {
    const steps = byId.get(id)?.describeRestart?.() ?? [];
    if (steps.length > 0) out.push(`${id}: ${steps.join(' → ')}`);
  }
  return out;
}
