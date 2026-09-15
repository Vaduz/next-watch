/** Whether the remote may be pulled, and **what to restart** once it has been. Pure functions.
 *
 *  The decision follows from the incoming paths alone, so it stays here and is checked as a
 *  table. The half that matters most is the refusals: pulling something that must not be
 *  pulled is not undone by restarting afterwards.
 *
 *  Which paths must never arrive, and which of them mean a rebuild, differs in every
 *  repository — a database file, a directory of published images, whatever one server's build
 *  ignores. A package can know none of it, so the rules arrive as a `PullPolicy` and a list of
 *  servers, and the two helpers below build the shapes that come up most. */

/** A reason not to pull. One is enough to leave the remote alone. */
export interface WatchBlocker {
  /** The incoming path that triggered it. */
  path: string;
  reason: string;
}

/** What to do after pulling. */
export interface WatchPlan {
  blockers: WatchBlocker[];
  /** Dependencies moved, so an install is needed. */
  install: boolean;
  /** The servers to restart, by id, in the order they were given. */
  restart: string[];
}

/** A path that must never arrive from the remote, and why.
 *
 *  What belongs here is anything **this checkout is the one that writes**. Receiving it from
 *  the remote means somewhere else wrote it, which is not a change to overwrite silently. */
export interface BlockedPath {
  prefix: string;
  reason: string;
}

/** The rules for deciding whether to pull. */
export interface PullPolicy {
  blocked: readonly BlockedPath[];
  /** Paths that mean the dependencies moved. An install implies restarting everything. */
  dependencyPaths?: readonly string[];
}

/** One server, and what makes it need a restart. */
export interface WatchServerPolicy {
  id: string;
  restartOn(paths: readonly string[]): boolean;
}

const startsWithAny = (p: string, prefixes: readonly string[]): boolean => prefixes.some(x => p.startsWith(x));

/** A file that exists only for the tests or the linter, and so never reaches a build. */
const isTestOnly = (p: string): boolean => p.endsWith('.test.ts') || p.endsWith('.test.tsx');

/** A document at the repository root (`README.md` and friends). */
const isRootDoc = (p: string): boolean => !p.includes('/') && p.endsWith('.md');

/**
 * A server that restarts for **anything except** the given prefixes.
 *
 * Listing what does *not* matter, rather than what does, means an unfamiliar path **falls on
 * the restarting side**. A needless rebuild costs ten seconds; a missed one is invisible.
 *
 * Test-only files and root documents never count, because neither reaches a build.
 */
export function restartUnless(prefixes: readonly string[]): (paths: readonly string[]) => boolean {
  return paths => paths.some(p => !isTestOnly(p) && !isRootDoc(p) && !startsWithAny(p, prefixes));
}

/**
 * A server that restarts **only for** the given paths.
 *
 * This is the shape for a dev server that reloads itself: it needs a restart only for the
 * files its own watcher cannot pick up, such as its build configuration.
 */
export function restartIfAny(paths: readonly string[]): (incoming: readonly string[]) => boolean {
  return incoming => incoming.some(p => paths.includes(p));
}

/** The same predicate under the name that reads right on an `afterPull` hook, whose `runOn`
 *  restarts nothing. One function, two names: a config saying `restartIfAny` beside a hook
 *  that only rewrites a crontab would describe itself wrongly. */
export const runIfAny = restartIfAny;

/**
 * A server that restarts **only for** paths under one of the given prefixes.
 *
 * The prefix twin of `restartIfAny`, and what a declarative `restartPaths: ['web/', 'lib/']`
 * means. A list written by hand names directories far more often than files, and `restartIfAny`
 * compares whole paths — `'web/'` there would match nothing at all, silently, which is the
 * failure that is invisible. A whole file name still works, because a path is its own prefix.
 *
 * ⚠️ **No test-only or root-document exclusion here**, unlike `restartUnless`. This list says
 * what *does* matter; something that landed in it deserves to be taken at its word.
 */
export function restartIfPrefixed(prefixes: readonly string[]): (paths: readonly string[]) => boolean {
  return paths => paths.some(p => startsWithAny(p, prefixes));
}

/** A command to run **after a pull that brought something in**.
 *
 *  The servers restart because files they serve changed; this is for the rest of what a
 *  checkout owns — a crontab to rewrite, a cache to warm — which no server adapter covers. */
export interface AfterPullHook {
  /** What the event log calls it. */
  label: string;
  command: string;
  args?: readonly string[];
  /** Whether these incoming paths call for it. **Omitted means every pull**, which is the
   *  right default for something cheap and idempotent; `runIfAny` builds the usual shape for
   *  anything that is neither. */
  runOn?: (changedPaths: readonly string[]) => boolean;
}

/** The hooks these paths call for, in the order the config gave them. Filtering is separated
 *  from running so the choice can be checked as a table without a process in sight. */
export function hooksToRun<T extends AfterPullHook>(hooks: readonly T[], paths: readonly string[]): T[] {
  return hooks.filter(h => h.runOn === undefined || h.runOn(paths));
}

function blockersFor(paths: readonly string[], blocked: readonly BlockedPath[]): WatchBlocker[] {
  const out: WatchBlocker[] = [];
  for (const rule of blocked) {
    const hit = paths.find(p => p.startsWith(rule.prefix));
    if (hit !== undefined) out.push({ path: hit, reason: rule.reason });
  }
  return out;
}

/**
 * From the changes that exist only on the remote, decide whether to pull and what to restart.
 *
 * When there are blockers, install and restart come back **empty**. Nothing was pulled, and a
 * flag saying "restart the server" would let a caller that misread the result build from the
 * old code and take down a server that was running. No field is left for nobody to read.
 */
export function planFromIncoming(
  paths: readonly string[],
  policy: PullPolicy,
  servers: readonly WatchServerPolicy[],
): WatchPlan {
  const blockers = blockersFor(paths, policy.blocked);
  if (blockers.length) return { blockers, install: false, restart: [] };
  const install = paths.some(p => (policy.dependencyPaths ?? []).includes(p));
  return {
    blockers,
    install,
    restart: servers.filter(s => install || s.restartOn(paths)).map(s => s.id),
  };
}

/**
 * Local uncommitted changes that a pull would **overwrite**.
 *
 * Git detects this too and refuses the merge, but looking first means the reason can be
 * stated: git's message does not know which files this checkout is the rightful writer of.
 */
export function conflictingDirtyPaths(dirty: readonly string[], incoming: readonly string[]): string[] {
  const set = new Set(incoming);
  return dirty.filter(p => set.has(p));
}

/** What one poll did, as the material for a single log row.
 *
 *  `packageManager` names the command the install will actually run, so the row and the install
 *  cannot say different things. **It defaults to npm for compatibility, not out of preference**:
 *  this is exported from `next-watch/core`, and a host calling it with one argument was written
 *  before there was a second. Callers inside this package always pass the manager they read. */
export function describePlan(plan: WatchPlan, packageManager = 'npm'): string {
  if (plan.blockers.length) return 'skipped the pull';
  const todo: string[] = [];
  if (plan.install) todo.push(`${packageManager} install`);
  for (const id of plan.restart) todo.push(`restart ${id}`);
  return todo.length ? todo.join(' / ') : 'nothing to restart (the dev servers pick these up)';
}
