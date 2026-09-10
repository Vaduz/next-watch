/** The file holding the **last quota figures that were fetched successfully**.
 *
 *  `oauth/usage` returns 429 for reasons that have nothing to do with how much quota is left,
 *  so the fewer times it is asked the better. Anything else on the machine that reads the same
 *  quota (an admin page, say) can write the shared file, and the watcher reads it rather than
 *  asking again.
 *
 *  ⚠️ **The watcher only reads the shared file.** What it fetches itself goes to a file of its
 *  own, so it never overwrites another program's copy.
 *
 *  It lives under the temp directory because it is worth minutes at most and belongs in no
 *  repository. A file in an older or broken shape quietly reads as nothing, which just means
 *  the caller fetches for itself. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { quotaNumber } from '../../core/quota/value.js';
import { asRecord } from '../../core/util.js';

/** The names of the windows. **These are keys inside the file**, so every program sharing it
 *  has to spell them the same way. */
export const QUOTA_WINDOW_NAMES = { fiveHour: '5h', weekly: '7d', fable: 'Fable 7d' } as const;

/** How long each window is, in minutes. It follows from the name, so the file does not carry
 *  it. */
export const QUOTA_WINDOW_MINUTES: Record<string, number> = {
  [QUOTA_WINDOW_NAMES.fiveHour]: 300,
  [QUOTA_WINDOW_NAMES.weekly]: 10080,
  [QUOTA_WINDOW_NAMES.fable]: 10080,
};

/** One window. `resetsAtMs` is epoch **milliseconds**. */
export interface CachedQuotaWindow {
  name: string;
  usedPercent: number;
  resetsAtMs: number | null;
}

export interface CachedClaudeQuota {
  fetchedAtMs: number;
  plan: string | null;
  windows: CachedQuotaWindow[];
}

/** Where both files live. The directory is named after the host application, so two
 *  applications watching on one machine do not read each other's figures. */
const cacheDir = (appName: string): string => join(tmpdir(), `${appName}-cache`);

/** The copy every program on this machine shares. The name is part of that agreement, so it
 *  does not change. **The watcher only reads it**; the program that refreshes it on a schedule
 *  of its own is the one that writes. */
const sharedFile = (appName: string): string => join(cacheDir(appName), 'claude-quota.json');

/** Where the watcher puts what it fetched itself. */
const ownFile = (appName: string): string => join(cacheDir(appName), 'next-watch-claude-quota.json');

export function readSharedQuotaCache(appName: string): CachedClaudeQuota | null {
  return readQuotaCache(sharedFile(appName));
}

/** Write the shared copy. **Only the program that refreshes it on its own schedule calls this**
 *  — a watcher writing here would overwrite figures that program had just fetched. */
export function writeSharedQuotaCache(appName: string, value: CachedClaudeQuota): void {
  writeQuotaCache(sharedFile(appName), value);
}

export function readOwnQuotaCache(appName: string): CachedClaudeQuota | null {
  return readQuotaCache(ownFile(appName));
}

export function writeOwnQuotaCache(appName: string, value: CachedClaudeQuota): void {
  writeQuotaCache(ownFile(appName), value);
}

function readQuotaCache(file: string): CachedClaudeQuota | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null; // missing / broken / an older shape
  }
  return parseCachedQuota(parsed);
}

/** Let through only what can be read. A file with **no** window at all counts as no value:
 *  a card with no windows is a heading with nothing under it. */
export function parseCachedQuota(value: unknown): CachedClaudeQuota | null {
  const o = asRecord(value);
  const fetchedAtMs = quotaNumber(o?.fetchedAtMs);
  if (o === null || fetchedAtMs === null || !Array.isArray(o.windows)) return null;
  const windows = o.windows.flatMap(w => {
    const win = asRecord(w);
    const usedPercent = quotaNumber(win?.usedPercent);
    if (win === null || usedPercent === null || typeof win.name !== 'string') return [];
    return [{ name: win.name, usedPercent, resetsAtMs: quotaNumber(win.resetsAtMs) }];
  });
  if (!windows.length) return null;
  return { fetchedAtMs, plan: typeof o.plan === 'string' ? o.plan : null, windows };
}

function writeQuotaCache(file: string, value: CachedClaudeQuota): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  } catch {
    /* failing to write still leaves the figures usable in this process */
  }
}
