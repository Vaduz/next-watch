/** **A described server turned into an adapter.**
 *
 *  `{ id, script, build?, preStart?, restartPaths? }` in a config file and `--start dev` on the
 *  command line are the same thing: everything `WatchServerAdapter` asks for can be derived from
 *  a script name. The child itself is `io/scriptServer.ts`; what lives here is the **ordering**,
 *  and that ordering needs `streamCommand`, which belongs to the composition root. Hence the
 *  split: the lifecycle is a library, the policy is a command.
 *
 *  ⚠️ **The order inside a restart is the point of this file**: build, then prepare, then stop,
 *  then start. Everything that can fail happens **while the old server is still serving**, so a
 *  failure leaves something running rather than nothing. */
import path from 'node:path';
import { restartIfPrefixed, restartUnless } from '../core/plan.js';
import type { PackageManager } from '../core/packageManager.js';
import { ChildServer } from '../io/scriptServer.js';
import { DetachedServer } from '../io/detachedServer.js';
import { streamCommand, type Emit } from './actions/stream.js';
import type { WatchServerRow } from '../core/types.js';
import type { NextWatchConfig, ScriptServerEntry, WatchServerAdapter } from '../config.js';
import { isScriptServer } from '../config.js';

/** Ten minutes, the same cap the watcher's other long-running children get. */
const STEP_TIMEOUT_MS = 10 * 60_000;

/** Running one of the entry's scripts, injected so a test can watch what would have run. */
export type RunStep = (o: {
  command: string;
  args: readonly string[];
  cwd: string;
  emit: Emit;
}) => Promise<{ ok: boolean; detail: string | null }>;

const runStep: RunStep = o =>
  streamCommand({ command: o.command, args: o.args, cwd: o.cwd, timeoutMs: STEP_TIMEOUT_MS, emit: o.emit });

export interface ScriptServerContext {
  manager: PackageManager;
  /** The repository, which is where the scripts run. */
  root: string;
  /** Where the log files go. Absolute, and already resolved against `root`. */
  logDir: string;
  /** Only a test passes these. */
  run?: RunStep;
  child?: (entry: ScriptServerEntry) => ServerChild;
}

/** What `restartOn` becomes. Giving both lists is refused in `load.ts`, so this only has to pick
 *  among the three shapes that survive: named paths, ignored paths, or the blunt default from
 *  `--start` — restart for anything that is not a test file or a root-level document. */
function restartRuleFor(entry: ScriptServerEntry): (paths: readonly string[]) => boolean {
  if (entry.restartPaths !== undefined) return restartIfPrefixed(entry.restartPaths);
  return restartUnless(entry.ignorePaths ?? []);
}

/** Run one named script, saying so on both sides: a build takes tens of seconds, and a step that
 *  only prints when it fails leaves the screen silent for all of them. */
async function runNamed(
  o: ScriptServerContext,
  id: string,
  script: string,
  what: string,
  emit: Emit,
): Promise<boolean> {
  emit('step', `${id}: ${o.manager} run ${script} ...`);
  const { ok, detail } = await (o.run ?? runStep)({
    command: o.manager,
    args: ['run', script],
    cwd: o.root,
    emit,
  });
  if (ok) emit('step', `${id}: ${script} done`);
  else
    emit('error', `${id}: ${what} (${script}) failed${detail === null ? '' : ` (${detail})`} - left the server alone`);
  return ok;
}

/** The preparation before a start: a script name, or the repository's own function.
 *
 *  A function is given the same `emit` an adapter gets, so whatever it says lands in the event
 *  pane like everything else. Throwing counts as failing — a hook that rejects must not take the
 *  watch with it. */
async function prepared(o: ScriptServerContext, entry: ScriptServerEntry, emit: Emit): Promise<boolean> {
  const { preStart } = entry;
  if (preStart === undefined) return true;
  if (typeof preStart === 'string') return runNamed(o, entry.id, preStart, 'preStart', emit);
  emit('step', `${entry.id}: preStart ...`);
  try {
    await preStart(emit);
    emit('step', `${entry.id}: preStart done`);
    return true;
  } catch (err) {
    emit(
      'error',
      `${entry.id}: preStart failed (${err instanceof Error ? err.message : String(err)}) - left the server alone`,
    );
    return false;
  }
}

/** The steps a restart will take, in order, for the dry run to print. */
function restartSteps(entry: ScriptServerEntry): string[] {
  const steps = [
    entry.build === undefined ? null : `build (${entry.build})`,
    entry.preStart === undefined ? null : `preStart${typeof entry.preStart === 'string' ? ` (${entry.preStart})` : ''}`,
    'stop',
    `start (${entry.script})`,
  ];
  return steps.filter((s): s is string => s !== null);
}

/** The two ways of holding a server, behind the three things an adapter asks of one. Which is
 *  used is `detached`, and nothing above this line has to know which it got. */
export interface ServerChild {
  row: () => WatchServerRow;
  start: (emit: Emit) => Promise<boolean>;
  stop: (emit: Emit) => Promise<boolean>;
}

function childFor(entry: ScriptServerEntry, o: ScriptServerContext): ServerChild {
  if (o.child !== undefined) return o.child(entry);
  const common = {
    id: entry.id,
    command: o.manager,
    args: ['run', entry.script] as const,
    cwd: o.root,
    logFile: path.join(o.logDir, `${entry.id}.txt`),
    // Which package manager is running it — the one thing about this server that is not already
    // in its name.
    mode: o.manager,
  };
  if (entry.detached !== true) return new ChildServer(common);
  return new DetachedServer({ ...common, logDir: o.logDir, script: entry.script, mode: `${o.manager} detached` });
}

export function scriptAdapter(entry: ScriptServerEntry, o: ScriptServerContext): WatchServerAdapter {
  const child = childFor(entry, o);
  const build = async (emit: Emit): Promise<boolean> =>
    entry.build === undefined ? true : runNamed(o, entry.id, entry.build, 'build', emit);
  return {
    id: entry.id,
    label: entry.label,
    restartOn: restartRuleFor(entry),
    probe: () => Promise.resolve(child.row()),
    // ⚠️ **Adoption is not a start.** A detached server is still running when the next watch
    // opens, and `start` is called on every described server at startup: preparing for a start
    // that is not going to happen would rewrite the material a live server is serving from. The
    // same guard covers a person pressing `st(a)rt` on a row that is already up.
    start: async emit =>
      child.row().state === 'up' ? child.start(emit) : (await prepared(o, entry, emit)) ? child.start(emit) : false,
    stop: emit => child.stop(emit),
    restart: async emit => {
      // Both of these can fail, and both run **before the stop**, so a failure leaves the old
      // server serving rather than leaving nothing at all.
      if (!(await build(emit)) || !(await prepared(o, entry, emit))) return child.row().state === 'up';
      await child.stop(emit);
      return child.start(emit);
    },
    describeRestart: () => restartSteps(entry),
    // The watcher spawns this child itself, so nothing else is going to start it.
    autostart: true,
  };
}

/** The config with every described server turned into an adapter, which is the only shape the
 *  loop knows. Anything already written out is passed through untouched. */
export function withAdapters(config: NextWatchConfig, o: ScriptServerContext): NextWatchConfig {
  if (!config.servers.some(isScriptServer)) return config;
  return { ...config, servers: config.servers.map(s => (isScriptServer(s) ? scriptAdapter(s, o) : s)) };
}
