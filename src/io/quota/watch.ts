/** The **quota cards** on the panel.
 *
 *  The Claude figures come from the shared cache first. Where something else on the machine
 *  refreshes it every few minutes, that means **the same figure is never fetched twice** — and
 *  since `oauth/usage` returns 429 for reasons unrelated to the quota, asking less is the whole
 *  point. When the cache is stale the watcher fetches once itself and writes its own file
 *  (never the shared one).
 *
 *  Codex has no such file, so `codex app-server` is asked directly, and only at the caller's
 *  interval. */
import { findClaudeWeeklyModelLimit, quotaNumber } from '../../core/quota/value.js';
import { classifyQuotaWindows } from '../../core/quota/window.js';
import { asRecord } from '../../core/util.js';
import type { QuotaCard, QuotaWindowView } from '../../core/types.js';
import {
  QUOTA_WINDOW_NAMES,
  readOwnQuotaCache,
  readSharedQuotaCache,
  writeOwnQuotaCache,
  type CachedClaudeQuota,
} from './cache.js';
import { fetchClaudeUsage, readClaudeCredentials, readCodexRateLimits } from './sources.js';
import { clientName } from '../http.js';

/** How old a shared figure may be before the watcher fetches for itself. Kept **above** the
 *  caller's TTL, so where the shared cache exists the endpoint is never asked twice. */
const SHARED_CACHE_FRESH_MS = 30 * 60_000;
/** How long to wait after a 429 whose `Retry-After` could not be read. */
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 10 * 60_000;

/** Who the quota is being read for: names the cache directory and the client registration.
 *  `client` is derived from `appName` unless the caller has a name of its own. */
export interface QuotaClient {
  appName: string;
  client?: string;
}

/** Epoch seconds or an ISO string to epoch ms. */
function toEpochMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v * 1000;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/** Whichever cached copy is newer, or null when there is none. */
function freshestClaudeCache(appName: string): CachedClaudeQuota | null {
  const candidates = [readSharedQuotaCache(appName), readOwnQuotaCache(appName)].filter(
    (c): c is CachedClaudeQuota => c !== null,
  );
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.fetchedAtMs - a.fetchedAtMs)[0];
}

/** One window of the usage response, ready to show. */
function windowFrom(name: string, v: unknown): QuotaWindowView | null {
  const o = asRecord(v);
  const percent = quotaNumber(o?.utilization) ?? quotaNumber(o?.used_percentage);
  if (percent === null) return null;
  return { name, usedPercent: percent, resetsAtMs: toEpochMs(o?.resets_at) };
}

/** The per-model weekly window. One with no reset time is a placeholder, so it is left out. */
function fableWindow(limits: unknown): QuotaWindowView | null {
  const found = findClaudeWeeklyModelLimit(limits, 'fable');
  const resetsAtMs = found === null ? null : toEpochMs(found.resetsAt);
  if (found === null || resetsAtMs === null) return null;
  return { name: QUOTA_WINDOW_NAMES.fable, usedPercent: found.usedPercent, resetsAtMs };
}

/** While rate limited, nothing is asked (the endpoint's own limit, not an exhausted quota). */
let blockedUntilMs = 0;

/** Ask the usage endpoint once, or say why there is no figure. */
async function fetchClaudeQuota(o: QuotaClient, nowMs: number): Promise<CachedClaudeQuota | string> {
  const found = readClaudeCredentials();
  if (found.credentials === null) return `cannot read credentials (${found.tried.join(' / ')})`;
  const usage = await fetchClaudeUsage(found.credentials.token, {
    nowMs,
    fallbackBackoffMs: DEFAULT_RATE_LIMIT_BACKOFF_MS,
    userAgent: o.client ?? clientName(o.appName),
  });
  if (usage.kind === 'rate-limited') {
    blockedUntilMs = nowMs + usage.retryAfterMs;
    return 'oauth/usage HTTP 429 (backing off)';
  }
  if (usage.kind === 'http-error') return `oauth/usage HTTP ${usage.status}`;
  if (usage.kind === 'failed') return `oauth/usage failed: ${usage.message}`;
  const rl = usage.rateLimits;
  const windows = [
    windowFrom(QUOTA_WINDOW_NAMES.fiveHour, rl.five_hour),
    windowFrom(QUOTA_WINDOW_NAMES.weekly, rl.seven_day),
    fableWindow(rl.limits),
  ].filter((w): w is QuotaWindowView => w !== null);
  if (!windows.length) return 'oauth/usage returned no quota';
  return { fetchedAtMs: Date.now(), plan: found.credentials.plan, windows };
}

/** The Claude card: cache first, fetch once when it is stale, and show the old figures marked
 *  stale when the fetch fails. */
async function claudeCard(o: QuotaClient, nowMs: number): Promise<QuotaCard> {
  const base = { label: 'Claude', plan: null, windows: [], error: null, fetchedAtMs: null, stale: false };
  const cached = freshestClaudeCache(o.appName);
  if (cached !== null && nowMs - cached.fetchedAtMs < SHARED_CACHE_FRESH_MS) {
    return { ...base, plan: cached.plan, windows: cached.windows, fetchedAtMs: cached.fetchedAtMs };
  }
  if (nowMs < blockedUntilMs && cached !== null) {
    return { ...base, plan: cached.plan, windows: cached.windows, fetchedAtMs: cached.fetchedAtMs, stale: true };
  }
  const fetched = await fetchClaudeQuota(o, nowMs);
  if (typeof fetched !== 'string') {
    writeOwnQuotaCache(o.appName, fetched);
    return { ...base, plan: fetched.plan, windows: fetched.windows, fetchedAtMs: fetched.fetchedAtMs };
  }
  if (cached === null) return { ...base, error: fetched };
  return {
    ...base,
    plan: cached.plan,
    windows: cached.windows,
    fetchedAtMs: cached.fetchedAtMs,
    stale: true,
    error: fetched,
  };
}

/** One window of the app server's answer (`{usedPercent, windowDurationMins, resetsAt}`). */
function codexWindow(v: unknown): (QuotaWindowView & { windowMinutes: number | null }) | null {
  const o = asRecord(v);
  const percent = quotaNumber(o?.usedPercent);
  if (percent === null) return null;
  return {
    name: '',
    usedPercent: percent,
    resetsAtMs: toEpochMs(o?.resetsAt),
    windowMinutes: quotaNumber(o?.windowDurationMins),
  };
}

/** Fold the answer into windows to show. Which of primary and secondary is which is **not
 *  fixed**, so they are sorted by their actual length. */
function codexWindows(rateLimits: Record<string, unknown>): QuotaWindowView[] {
  const { fiveHour, weekly } = classifyQuotaWindows([
    codexWindow(rateLimits.primary),
    codexWindow(rateLimits.secondary),
  ]);
  const out: QuotaWindowView[] = [];
  // The length was only needed for sorting, so it does not travel on.
  if (fiveHour) {
    out.push({ name: QUOTA_WINDOW_NAMES.fiveHour, usedPercent: fiveHour.usedPercent, resetsAtMs: fiveHour.resetsAtMs });
  }
  if (weekly)
    out.push({ name: QUOTA_WINDOW_NAMES.weekly, usedPercent: weekly.usedPercent, resetsAtMs: weekly.resetsAtMs });
  return out;
}

/** The Codex card. */
async function codexCard(o: QuotaClient): Promise<QuotaCard> {
  const base: QuotaCard = { label: 'Codex', plan: null, windows: [], error: null, fetchedAtMs: null, stale: false };
  const result = await readCodexRateLimits(o.client ?? clientName(o.appName));
  if (result.kind === 'timed-out') return { ...base, error: 'codex app-server timed out' };
  if (result.kind === 'cannot-start') return { ...base, error: `cannot start codex (${result.message})` };
  if (result.kind === 'no-rate-limits') return { ...base, error: 'no rateLimits in the response' };
  const plan = typeof result.rateLimits.planType === 'string' ? result.rateLimits.planType : null;
  return {
    ...base,
    plan: plan === null ? null : plan.charAt(0).toUpperCase() + plan.slice(1),
    windows: codexWindows(result.rateLimits),
    fetchedAtMs: Date.now(),
  };
}

let cache: { atMs: number; cards: QuotaCard[] } | null = null;

/** The quota cards. Within `ttlMs` the previous answer is returned as is. */
export async function watchQuotaCards(o: QuotaClient & { nowMs: number; ttlMs: number }): Promise<QuotaCard[]> {
  if (cache !== null && o.nowMs - cache.atMs < o.ttlMs) return cache.cards;
  const cards = await Promise.all([claudeCard(o, o.nowMs), codexCard(o)]);
  cache = { atMs: o.nowMs, cards };
  return cards;
}
