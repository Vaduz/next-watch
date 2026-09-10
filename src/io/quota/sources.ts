/** **Where the quota figures come from**: the credentials on disk, the usage endpoint, and one
 *  round trip through the Codex app server.
 *
 *  ⚠️ This holds the fetching only. How long a figure stays fresh, how long to back off, and
 *  what to say when it fails all stay with the caller — a page that refreshes when someone
 *  looks at it and a watcher that runs unattended for days need different tuning. Failures come
 *  back **as a shape**, and turning one into a sentence is the caller's job. */
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeCredentialSources, pickClaudeCredentials } from '../../core/quota/credentials.js';
import { retryAfterMs } from '../../core/quota/value.js';
import {
  claudeRateLimitsOf,
  codexInitializeLine,
  codexRateLimitsStep,
  consumeJsonLines,
} from '../../core/quota/protocol.js';
import { fetchWithTimeout, type FetchLike } from '../http.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const FETCH_TIMEOUT_MS = 5_000;
const APP_SERVER_TIMEOUT_MS = 10_000;
/** On macOS the CLI keeps its credentials in the login keychain rather than in a file. The
 *  service name is the one the CLI itself uses. */
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const KEYCHAIN_TIMEOUT_MS = 5_000;

/** The OAuth token and plan name. With nothing readable, `credentials` is null and `tried` says
 *  where it looked. */
export function readClaudeCredentials(): ReturnType<typeof pickClaudeCredentials> {
  return pickClaudeCredentials(claudeCredentialSources(process.platform, credentialReaders()));
}

/** The actual reads. Which of them to try, in which order, is decided in `core/`.
 *  **Looking only at the file is wrong on macOS**: since the CLI moved to the keychain there is
 *  no `~/.claude/.credentials.json` there, and the whole quota section would disappear. */
function credentialReaders(): { file: () => string | null; keychain: () => string | null } {
  return {
    file: () => readOrNull(() => readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8')),
    // Only stdout is taken. Neither `security`'s stderr nor the thrown error is passed on:
    // this path holds the credentials themselves, so a failure names the source and no more.
    keychain: () =>
      readOrNull(() =>
        execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
          encoding: 'utf8',
          timeout: KEYCHAIN_TIMEOUT_MS,
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      ),
  };
}

function readOrNull(read: () => string): string | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/** What the usage endpoint said. A 429 is **the endpoint's own rate limit, not an exhausted
 *  quota**, so it is kept apart from other HTTP errors: the caller decides how long not to ask
 *  again. */
export type ClaudeUsageResult =
  | { kind: 'ok'; rateLimits: Record<string, unknown> }
  | { kind: 'rate-limited'; retryAfterMs: number }
  | { kind: 'http-error'; status: number }
  | { kind: 'failed'; message: string };

/** Ask the usage endpoint once. The token never reaches a log. `fallbackBackoffMs` is how long
 *  to wait when `Retry-After` could not be read. */
export async function fetchClaudeUsage(
  token: string,
  o: { nowMs: number; fallbackBackoffMs: number; userAgent: string; fetchImpl?: FetchLike },
): Promise<ClaudeUsageResult> {
  try {
    return await fetchWithTimeout(
      {
        url: USAGE_URL,
        userAgent: o.userAgent,
        timeoutMs: FETCH_TIMEOUT_MS,
        fetchImpl: o.fetchImpl,
        init: { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' } },
      },
      async res => {
        if (res.status === 429) {
          const wait = retryAfterMs(res.headers.get('retry-after'), o.nowMs, o.fallbackBackoffMs);
          return { kind: 'rate-limited', retryAfterMs: wait };
        }
        if (!res.ok) return { kind: 'http-error', status: res.status };
        return { kind: 'ok', rateLimits: claudeRateLimitsOf(await res.json()) };
      },
    );
  } catch (e) {
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}

export type CodexRateLimitsResult =
  | { kind: 'ok'; rateLimits: Record<string, unknown> }
  | { kind: 'no-rate-limits' }
  | { kind: 'timed-out' }
  | { kind: 'cannot-start'; message: string };

/** One round trip through `codex app-server` for the quota (the CLI holds its own credentials,
 *  so nothing here reads them). **It always ends** — the timeout kills it. This is not a
 *  supported interface, so a failure comes back as a reason and the caller leaves the card out
 *  quietly. */
export function readCodexRateLimits(clientName: string): Promise<CodexRateLimitsResult> {
  return new Promise(resolve => {
    let settled = false;
    const done = (result: CodexRateLimitsResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill();
      resolve(result);
    };
    const proc = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => {
      done({ kind: 'timed-out' });
    }, APP_SERVER_TIMEOUT_MS);
    proc.on('error', e => {
      done({ kind: 'cannot-start', message: e.message });
    });
    let buf = '';
    proc.stdout.on('data', (d: Buffer) => {
      buf = consumeJsonLines(buf + d.toString(), msg => {
        const step = codexRateLimitsStep(msg);
        if (step === null) return;
        if (step.kind === 'send') for (const line of step.lines) proc.stdin.write(line);
        if (step.kind === 'done') done({ kind: 'ok', rateLimits: step.rateLimits });
        if (step.kind === 'failed') done({ kind: 'no-rate-limits' });
      });
    });
    proc.stdin.write(codexInitializeLine(clientName));
  });
}
