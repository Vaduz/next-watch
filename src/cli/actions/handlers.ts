/** Which verbs the **built-in sections** answer to.
 *
 *  `dispatch.ts` sends every kind that belongs to a provider here, and a kind with no entry says
 *  so on the screen rather than doing nothing. So the rule is the same one the panel follows:
 *  **a section that is off has no verbs**, because there is nothing there to act on. */
import type { ResolvedProviders } from '../../io/providers.js';
import { signalPid } from './servers.js';
import { restartSession } from './sessions.js';
import { addSshKey, openUrl, updateTool } from './tools.js';
import type { ActionContext, ActionHandler } from './stream.js';

/** Restarting an agent session is its own procedure; every other verb is a signal. */
const session: ActionHandler = (target, verb, ctx) =>
  verb === 'restart'
    ? restartSession(target, ctx)
    : Promise.resolve(signalPid(target.pid, verb, `session ${target.id}`, ctx.emit));

/** A service row carries the page a person would read, so the verb opens it. */
const service: ActionHandler = (target, _verb, ctx) => Promise.resolve(openUrl(target.url ?? '', ctx.emit));

/** A tool row is the CLI itself, so the verb installs a new release of it. */
const tool: ActionHandler = (target, _verb, ctx) => updateTool(target.id, ctx);

const ssh: ActionHandler = (_target, _verb, ctx) => addSshKey(ctx);

/** The handlers for whichever sections are switched on. */
export function builtInHandlers(providers: ResolvedProviders): ActionContext['handlers'] {
  return {
    ...(providers.sessions === undefined ? {} : { session }),
    ...(providers.services === undefined ? {} : { service }),
    ...(providers.toolVersions === undefined ? {} : { tool }),
    ...(providers.sshAgent === undefined ? {} : { ssh }),
  };
}
