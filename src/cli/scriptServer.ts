/** **`--start <script>` as a server adapter.**
 *
 *  Everything `WatchServerAdapter` asks for can be derived from an npm script name: the command
 *  is the project's own package manager, stopping is the child's process tree, starting is
 *  spawning it again, and probing is whether that child is still there. The one thing that
 *  cannot be derived is a finer restart rule — see `restartOn` below.
 *
 *  The child itself is `io/scriptServer.ts`. What lives here is the ordering that makes a
 *  restart safe, and that ordering needs `streamCommand`, which belongs to the composition
 *  root. Hence the split: the lifecycle is a library, the policy is a command. */
import path from 'node:path';
import { restartUnless } from '../core/plan.js';
import type { PackageManager } from '../core/packageManager.js';
import { ChildServer } from '../io/scriptServer.js';
import { streamCommand, type Emit } from './actions/stream.js';
import type { WatchServerAdapter } from '../config.js';

/** Ten minutes, the same cap the watcher's other long-running children get. */
const BUILD_TIMEOUT_MS = 10 * 60_000;

export interface ScriptServerOptions {
  /** The scripts named by `--start`, in the order they were given. */
  scripts: readonly string[];
  /** The script named by `--build`, or null. It runs **before** anything is stopped. */
  build: string | null;
  manager: PackageManager;
  /** The repository, which is where the scripts run. */
  root: string;
  /** Where the log files go. Absolute, and already resolved against `root`. */
  logDir: string;
}

export function scriptServers(o: ScriptServerOptions): WatchServerAdapter[] {
  return o.scripts.map(script => adapterFor(script, o));
}

/** Run the build script, and say whether the caller may now stop anything.
 *
 *  ⚠️ **This is the rule the config-file adapters are held to**, stated on `WatchServerAdapter`:
 *  a build that failed must leave the running server alone. Stopping first and then finding the
 *  incoming code broken leaves nothing serving, which is worse than the old code serving. */
async function built(o: ScriptServerOptions, id: string, emit: Emit): Promise<boolean> {
  if (o.build === null) return true;
  emit('step', `${id}: ${o.manager} run ${o.build} ...`);
  const { ok, detail } = await streamCommand({
    command: o.manager,
    args: ['run', o.build],
    cwd: o.root,
    timeoutMs: BUILD_TIMEOUT_MS,
    emit,
  });
  if (ok) emit('step', `${id}: ${o.build} done`);
  else emit('error', `${id}: ${o.build} failed${detail === null ? '' : ` (${detail})`} - left the server running`);
  return ok;
}

function adapterFor(script: string, o: ScriptServerOptions): WatchServerAdapter {
  const child = new ChildServer({
    id: script,
    command: o.manager,
    args: ['run', script],
    cwd: o.root,
    logFile: path.join(o.logDir, `${script}.txt`),
    // Which package manager is running it — the one thing about this server that is not
    // already in its name.
    mode: o.manager,
  });
  return {
    id: script,
    /**
     * ⚠️ **Everything restarts, except test files and root documents.**
     *
     * A flag names a script; it cannot say which incoming paths that script's output depends
     * on. Guessing narrow would mean a server quietly serving code that was replaced under it,
     * and a missed restart is invisible, while a needless one costs the seconds a dev server
     * takes to come back. Finer rules are what the config file is for.
     */
    restartOn: restartUnless([]),
    probe: () => Promise.resolve(child.row()),
    start: emit => child.start(emit),
    stop: emit => child.stop(emit),
    restart: async emit => {
      if (!(await built(o, script, emit))) return child.row().state === 'up';
      await child.stop(emit);
      return child.start(emit);
    },
  };
}
