/** The `next-watch/core` subpath: everything the dashboard decides and draws, with no I/O.
 *
 *  Nothing here reads a clock, a terminal, the filesystem or the network. The caller supplies
 *  the panel, the width, the time zone and the rules; what comes back is rows of text and
 *  decisions. That is what makes all of it checkable as a table. */
export { asRecord, formatClockElapsed, sleep } from './util.js';
export { EVENT_PANE, paneNamesOf } from './panes.js';
export { cleanOutputLine, splitOutputLines, tailOutputLines, OutputLineReader } from './commandOutput.js';
export { accessClass, accessRows, formatAccessLine, formatMs, parseAccessLine, stampFinalLine } from './accessLog.js';
export { decodeWatchEvent, decodeWatchLog, encodeWatchEvent, type WatchLogWindow } from './watchLog.js';
export {
  diffLocalSnapshot,
  sshAgentEvents,
  stampEvent,
  toolVersionEvents,
  type LocalSnapshot,
  type PendingEvent,
} from './watchEvents.js';
export { sshAgentSummary, sshAgentNeedsKey, SSH_TARGET_KEY } from './sshAgentView.js';
export { isBehind, type AutoUpdateMemo } from './toolVersionView.js';
export { quotaTone, type QuotaSessionProbe } from './quota/view.js';
export { type WatchTarget, type WatchTargetKind } from './watchTargets.js';
export { resolveSelection, stepSelection, tabTargets, toolTarget, watchTargets } from './watchTargets/targets.js';
export {
  actionLabel,
  helpLines,
  parseWatchCommand,
  shortcutVerb,
  verbHint,
  verbLabel,
  type WatchCommand,
} from './watchTargets/verbs.js';
export {
  applyKey,
  initialUi,
  scrollPane,
  toggleFocus,
  visibleFlash,
  FLASH_TTL_MS,
  type WatchAction,
  type WatchFlash,
  type WatchKey,
  type WatchUi,
} from './watchInteraction.js';
export { SaidOnce, initialState, nextSelection, panelDue, type RepoState, type WatchState } from './watchState.js';
export {
  conflictingDirtyPaths,
  describePlan,
  hooksToRun,
  planFromIncoming,
  restartIfAny,
  restartUnless,
  runIfAny,
  type AfterPullHook,
  type BlockedPath,
  type PullPolicy,
  type WatchBlocker,
  type WatchPlan,
  type WatchServerPolicy,
} from './plan.js';
export {
  COMMIT_LOG_FORMAT,
  parseCommitLog,
  parsePorcelain,
  parseShortstat,
  type WatchCommit,
  type WatchDiffStat,
} from './gitOutput.js';
export * from './types.js';
export {
  clockWithOffset,
  since,
  type PaneBudget,
  type WatchClock,
  type WatchLayout,
  type WatchView,
} from './view/index.js';
export { innerWidth, paneBudget, scrollMaxOf, visibleSlice, watchLayout } from './view/layout.js';
export { describeIncoming, summarizePaths } from './view/incoming.js';
export { renderWatchPanel, watchPaneBudget, watchPaneEntries } from './view/panel.js';
export { renderBanner, renderBottomLine, renderHeartbeat, type BottomLineView } from './view/outerLines.js';
