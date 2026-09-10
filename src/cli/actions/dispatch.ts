/** Send a typed verb to whatever kind of thing is selected.
 *
 *  What can be selected and what can be typed is decided by `core/watchTargets/`, which is
 *  pure. This only runs what was decided, and always says one line before and one after — a
 *  build takes tens of seconds, so the output in between does not say whether it has finished.
 *
 *  Servers go through their adapter, and the kinds that belong to the optional sections go to
 *  their handlers rather than to code here that would have to know what a session is. */
import { type WatchTarget } from '../../core/watchTargets.js';
import { runServer, signalPid } from './servers.js';
import { type ActionContext } from './stream.js';

/** Run one verb. The result is **whether it worked**. */
async function dispatch(target: WatchTarget, verb: string, ctx: ActionContext): Promise<boolean> {
  switch (target.kind) {
    case 'server':
      return runServer(target, verb, ctx);
    case 'task':
      return signalPid(target.pid, verb, `task ${target.id}`, ctx.emit);
    case 'session':
    case 'service':
    case 'tool':
    case 'ssh': {
      // These belong to the optional providers, which the host supplies. With no handler there
      // is nothing to run, and saying so beats doing nothing in silence.
      const handler = ctx.handlers[target.kind];
      if (handler === undefined) {
        ctx.emit('warn', `${target.key}: no handler is configured for ${target.kind}`);
        return false;
      }
      return handler(target, verb, ctx);
    }
    default:
      ctx.emit('warn', `${target.key} has nothing to run`);
      return false;
  }
}

/** How a finished action ended, which the caller shows on the bottom line for a few seconds.
 *  `text` is the same string as the closing row in the event log, so one result is never
 *  worded two ways. */
export interface WatchActionResult {
  ok: boolean;
  text: string;
}

/**
 * Run one action. **This never throws**: a failure becomes an event, and the watch goes on.
 *
 * The line before and the line after are the point. A build takes tens of seconds and an
 * update includes a download, so a stream of intermediate output does not say whether the
 * thing is still going. The start, the end, how long it took and whether it worked all land in
 * the event log alongside that output.
 *
 * The closing line is returned as well. The event log scrolls as other events stack below it,
 * so the result is also put where the person who typed it is looking.
 */
export async function runWatchAction(
  target: WatchTarget,
  verb: string,
  ctx: ActionContext,
): Promise<WatchActionResult> {
  const startedAtMs = Date.now();
  ctx.emit('cmd', `${verb} ${target.key} ...`);
  const took = (): string => `${((Date.now() - startedAtMs) / 1000).toFixed(1)}s`;
  try {
    const ok = await dispatch(target, verb, ctx);
    const text = `${verb} ${target.key} ${ok ? 'done' : 'failed'} ${took()}`;
    ctx.emit(ok ? 'cmd' : 'error', text);
    return { ok, text };
  } catch (err) {
    const text = `${verb} ${target.key} failed ${took()}: ${err instanceof Error ? err.message : String(err)}`;
    ctx.emit('error', text);
    return { ok: false, text };
  }
}
