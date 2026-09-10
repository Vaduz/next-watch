/** Reading the **public status pages** of the services the machine depends on.
 *
 *  They run on statuspage.io, where `/api/v2/summary.json` returns the same shape for every
 *  page. No authentication, and nothing is sent but a read.
 *
 *  ⚠️ Give the **final URL**. Some of these redirect (`status.anthropic.com` → `status.claude.com`),
 *  and relying on redirects being followed means a configuration that does not follow them
 *  fails silently.
 *
 *  The watcher stays up and calls this repeatedly, so: always a timeout, and never throw — what
 *  could not be fetched becomes a row saying so, and the watch carries on. */
import { parseServiceSummary, unavailableService } from '../core/serviceStatus.js';
import type { ServiceCard } from '../core/types.js';

const FETCH_TIMEOUT_MS = 6_000;

/** One status page. `name` appears on the panel as it is written here, and `page` is what a
 *  person opens — the summary URL is derived from it. */
export interface ServiceSpec {
  name: string;
  page: string;
}

const summaryUrl = (page: string): string => `${page}/api/v2/summary.json`;

async function fetchOne(spec: ServiceSpec): Promise<ServiceCard> {
  try {
    const res = await fetch(summaryUrl(spec.page), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return unavailableService(spec.name, spec.page, `status page returned ${res.status}`);
    return parseServiceSummary(spec.name, spec.page, await res.text());
  } catch (err) {
    return unavailableService(spec.name, spec.page, `cannot reach the status page (${String(err)})`);
  }
}

let cache: { atMs: number; cards: ServiceCard[] } | null = null;

/** The status pages. Within `ttlMs` the previous answer is returned as is. */
export async function serviceStatusCards(o: {
  services: readonly ServiceSpec[];
  nowMs: number;
  ttlMs: number;
}): Promise<ServiceCard[]> {
  if (cache !== null && o.nowMs - cache.atMs < o.ttlMs) return cache.cards;
  const cards = await Promise.all(o.services.map(s => fetchOne(s)));
  cache = { atMs: o.nowMs, cards };
  return cards;
}
