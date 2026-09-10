/** The verbs that act on a server.
 *
 *  What restarting actually involves — what to build, which jobs to drain without taking
 *  running work with them, which ports to wait for — differs in every repository, so none of it
 *  can live in a package. It sits behind `WatchServerAdapter`: this file decides **which** verb
 *  applies and the adapter knows **how**.
 *
 *  ⚠️ The order inside `restart` is the adapter's responsibility, and the important part of it
 *  is that **a build has to succeed before anything is stopped**. Stopping first and then
 *  finding the build broken leaves nothing running, which is worse than the old code still
 *  serving. That is stated on the type in `config.ts`. */
import { sendSignal } from '../../io/processes.js';
import type { WatchTarget } from '../../core/watchTargets.js';
import type { ActionContext, Emit } from './stream.js';

/** Run a verb against a server. An id with no adapter says so rather than doing nothing. */
export async function runServer(target: WatchTarget, verb: string, ctx: ActionContext): Promise<boolean> {
  const server = ctx.servers.get(target.id);
  if (server === undefined) {
    ctx.emit('warn', `${target.key}: no server adapter is configured for ${target.id}`);
    return false;
  }
  if (verb === 'restart') return server.restart(ctx.emit);
  if (verb === 'stop') return server.stop(ctx.emit);
  if (verb === 'start') return server.start(ctx.emit);
  ctx.emit('warn', `${target.key}: ${verb} does not apply to a server`);
  return false;
}

/** Send one signal. `kill` means SIGKILL, which gives the target no chance to tidy up. */
export function signalPid(pid: number | undefined, verb: string, what: string, emit: Emit): boolean {
  if (pid === undefined) {
    emit('warn', `${what}: no pid to signal`);
    return false;
  }
  const sig = verb === 'kill' ? 'SIGKILL' : 'SIGTERM';
  try {
    sendSignal(pid, sig);
    emit('step', `${sig} sent to ${what} (pid ${pid})`);
    return true;
  } catch (err) {
    emit('error', `could not signal ${what} (pid ${pid}): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
