/** Reading a statuspage.io `summary.json`. Pure; nothing here touches the network.
 *
 *  Many services publish through statuspage.io, and `/api/v2/summary.json` has the same shape
 *  for all of them. The watcher reads it on a slow interval so that "is this machine broken or
 *  is the service down" can be answered on the spot.
 *
 *  What is shown is the overall indicator and **only the names of the components that are not
 *  operational**. Listing them all runs past twenty rows of things nobody reads while
 *  everything works. */
import { asRecord } from './util.js';
import type { ServiceCard } from './types.js';

/** The `status.indicator`. An unfamiliar value falls to `unknown`. */
const INDICATORS = ['none', 'minor', 'major', 'critical', 'maintenance'] as const;

type Indicator = ServiceCard['indicator'];

function toIndicator(v: unknown): Indicator {
  return typeof v === 'string' && (INDICATORS as readonly string[]).includes(v) ? (v as Indicator) : 'unknown';
}

/** The names of the components that are not operational. Group rows do not count. */
function degradedComponents(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const c = asRecord(item);
    if (c === null || c.group === true) continue;
    const status = typeof c.status === 'string' ? c.status : '';
    const name = typeof c.name === 'string' ? c.name : '';
    if (status && status !== 'operational' && name) out.push(`${name} (${status})`);
  }
  return out;
}

/** Fold one summary into a card. An unreadable response still returns a card, with the reason
 *  in `error`: the row is never dropped. */
export function parseServiceSummary(name: string, pageUrl: string, raw: string): ServiceCard {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unavailableService(name, pageUrl, 'could not read the response');
  }
  const root = asRecord(parsed);
  const status = asRecord(root?.status);
  if (root === null || status === null) return unavailableService(name, pageUrl, 'no status in the response');
  return {
    name,
    pageUrl,
    indicator: toIndicator(status.indicator),
    description: typeof status.description === 'string' ? status.description : '',
    degraded: degradedComponents(root.components),
    error: null,
  };
}

/** The card for a service that could not be reached. **The row stays**, or nobody would
 *  notice that it is not being watched. */
export function unavailableService(name: string, pageUrl: string, reason: string): ServiceCard {
  return { name, pageUrl, indicator: 'unknown', description: '', degraded: [], error: reason };
}
