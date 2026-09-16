/** Public entry point.
 *
 *  `startWatch(config, args)` runs the watcher; the types describe what a repository has to
 *  supply. The pure half is also available as `next-watch/core`, the terminal helpers as
 *  `next-watch/term`, the access-log reader as `next-watch/access-log`, and the process
 *  helpers as `next-watch/process`, and the quota as `next-watch/quota` (pure, safe in a
 *  browser) with its readers as `next-watch/quota/io`. */
export { startWatch } from './cli/watch.js';
export { parseArgs, DEFAULT_CONFIG, type Args } from './cli/args.js';
export { loadConfig, main } from './cli/main.js';
export { resolveConfig } from './config.js';
export type {
  Emit,
  NextWatchConfig,
  ResolvedConfig,
  ResolvedProviders,
  ServiceSpec,
  ToolSpec,
  ToolsSetting,
  ScriptServerEntry,
  WatchProviders,
  WatchServerAdapter,
  WatchServerSpec,
} from './config.js';
export {
  restartIfAny,
  restartIfPrefixed,
  restartUnless,
  runIfAny,
  type AfterPullHook,
  type BlockedPath,
  type PullPolicy,
  type WatchPlan,
  type WatchServerPolicy,
} from './core/plan.js';
export type { TaskRow, WatchServerRow } from './core/types.js';
