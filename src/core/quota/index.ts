/** The `next-watch/quota` subpath: reading and presenting a usage quota, with **no I/O**.
 *
 *  ⚠️ **Nothing here may import a Node module.** A browser component imports this subpath, so
 *  `fs`, `child_process` and `os` are all out. `next-watch/quota/io` may import this; the
 *  reverse is forbidden. */
export {
  classifyQuotaWindows,
  FIVE_HOUR_WINDOW_MINUTES,
  WEEKLY_WINDOW_MINUTES,
  WEEKLY_WINDOW_MS,
  type QuotaWindowWithDuration,
} from './window.js';
export { findClaudeWeeklyModelLimit, quotaNumber, retryAfterMs, type ClaudeScopedQuotaWindow } from './value.js';
export { quotaLevel, quotaTone, sessionQuotaText, sessionQuotas, type QuotaLevel, type SessionQuota } from './view.js';
export {
  claudeRateLimitsOf,
  codexInitializeLine,
  codexRateLimitsStep,
  consumeJsonLines,
  type CodexStep,
} from './protocol.js';
export {
  claudeCredentialSources,
  parseClaudeCredentials,
  pickClaudeCredentials,
  type ClaudeCredentials,
  type CredentialSource,
} from './credentials.js';
export { quotaSessionOpen, quotaSessionToStart, QUOTA_SESSION_RETRY_MS, type QuotaSessionStart } from './session.js';
