/** **What happens once a pull has landed**: install what the dependencies need, restart the
 *  servers the paths call for, then run the repository's own `afterPull` commands.
 *
 *  Deciding *whether* to pull is `tick.ts`; this is only the doing, which is why it takes a
 *  plan rather than a diff.
 *
 *  ⚠️ **The two halves fail differently, on purpose.** `applyPlan` stops when the install
 *  fails, because restarting servers onto a tree whose dependencies did not land is worse than
 *  leaving the old ones up. `runAfterPull` stops for nothing: the merge has already happened
 *  and cannot be taken back, so a hook that fails leaves a red row and the next one still
 *  runs. */
import { hooksToRun, type WatchPlan } from '../core/plan.js';
import { installCommand } from '../core/packageManager.js';
import { packageManagerAt } from '../io/packageManager.js';
import type { ResolvedConfig } from '../config.js';
import { type Emit } from './actions/stream.js';

/** Running a command, injected so a test can watch what would have run. */
export type RunCommand = (o: {
  command: string;
  args: readonly string[];
  cwd: string;
}) => Promise<{ ok: boolean; detail: string | null }>;

/** Install dependencies with **the manager the checkout's lockfile names**.
 *
 *  ⚠️ The lockfile is read here, after the merge, rather than once when the watch started. A
 *  pull that swaps one lockfile for another is exactly the pull that moves the dependencies, so
 *  a manager remembered from startup would be the one the repository has just left behind.
 *
 *  Running the wrong one is not a cosmetic mistake: npm in a bun or pnpm checkout ignores the
 *  lockfile that is there, can write a `package-lock.json` of its own into the tree, and leaves
 *  `node_modules` out of step with what the lockfile pins. */
async function install(config: ResolvedConfig, emit: Emit, run: RunCommand): Promise<boolean> {
  const { command, args } = installCommand(packageManagerAt(config.root).manager);
  const label = [command, ...args].join(' ');
  emit('step', `${label} ...`);
  const { ok, detail } = await run({ command, args, cwd: config.root });
  emit(ok ? 'step' : 'error', ok ? `${label} done` : `${label} failed${detail === null ? '' : `: ${detail}`}`);
  return ok;
}

/** Restart what the plan named, through the adapters. The same code path a typed `restart`
 *  takes, so the two cannot drift apart. */
export async function applyPlan(config: ResolvedConfig, plan: WatchPlan, emit: Emit, run: RunCommand): Promise<void> {
  if (plan.install && !(await install(config, emit, run))) return;
  const byId = new Map(config.servers.map(s => [s.id, s]));
  for (const id of plan.restart) {
    const server = byId.get(id);
    if (server === undefined) continue;
    await server.restart(emit);
  }
}

/** Run the repository's `afterPull` hooks, in the order the config gave them.
 *
 *  ⚠️ **Every hook is tried**, including after an earlier one failed — see the file's note on
 *  why this differs from `applyPlan`. A broken build must not also leave a crontab stale. */
export async function runAfterPull(
  config: ResolvedConfig,
  paths: readonly string[],
  emit: Emit,
  run: RunCommand,
): Promise<void> {
  for (const hook of hooksToRun(config.afterPull, paths)) {
    emit('step', `${hook.label} ...`);
    // A `run` that throws rather than returning `ok: false` must not take the rest with it.
    const { ok, detail } = await run({ command: hook.command, args: hook.args ?? [], cwd: config.root }).catch(
      (e: unknown) => ({ ok: false, detail: String(e) }),
    );
    const why = detail === null ? '' : `: ${detail}`;
    emit(ok ? 'step' : 'error', ok ? `${hook.label} done` : `${hook.label} failed${why}`);
  }
}
