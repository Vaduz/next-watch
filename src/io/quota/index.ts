/** `next-watch/quota/io` — reading the quota from outside.
 *
 *  The counterpart of `next-watch/quota`, which is pure and safe to import anywhere (a browser
 *  component included). **This half may import that one; never the other way round.** */
export {
  parseCachedQuota,
  readOwnQuotaCache,
  readSharedQuotaCache,
  writeOwnQuotaCache,
  writeSharedQuotaCache,
  QUOTA_WINDOW_MINUTES,
  QUOTA_WINDOW_NAMES,
  type CachedClaudeQuota,
  type CachedQuotaWindow,
} from './cache.js';
export {
  fetchClaudeUsage,
  readClaudeCredentials,
  readCodexRateLimits,
  type ClaudeUsageResult,
  type CodexRateLimitsResult,
} from './sources.js';
export { watchQuotaCards, type QuotaClient } from './watch.js';
