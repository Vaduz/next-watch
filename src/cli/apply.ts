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
import type { ResolvedConfig } from '../config.js';
import { type Emit } from './actions/stream.js';

/** Running a command, injected so a test can watch what would have run. */
export type RunCommand = (o: {
  command: string;
  args: readonly string[];
  cwd: string;
}) => Promise<{ ok: boolean; detail: string | null }>;

/** Install dependencies. The command is fixed because `package.json` is what a dependency
 *  change means, and the adapters restart afterwards either way. */
async function install(config: ResolvedConfig, emit: Emit, run: RunCommand): Promise<boolean> {
  emit('step', 'npm install ...');
  const { ok, detail } = await run({ command: 'npm', args: ['install'], cwd: config.root });
  emit(ok ? 'step' : 'error', ok ? 'npm install done' : `npm install failed${detail === null ? '' : `: ${detail}`}`);
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
