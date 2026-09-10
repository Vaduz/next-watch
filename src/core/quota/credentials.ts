// Reading the OAuth credentials of a subscription CLI.
//
// Actually reading a source (a file, the macOS keychain) is passed in, so this stays pure and
// holds only "which to try first" and "what to take out of the JSON".
//
// **The token must never reach a log or a screen.** This layer assembles the value and prints
// nothing.
//
// ⚠️ No Node import may appear here: this is part of `next-watch/quota`.

import { asRecord } from '../util.js';

/** What a quota request needs. `plan` is the plan's display name, or null when unknown. */
export interface ClaudeCredentials {
  token: string;
  plan: string | null;
}

/** One place credentials can come from. `read` returns null when it cannot read, and never
 *  throws. */
export interface CredentialSource {
  /** The name shown when nothing worked, so a person can see where it looked. */
  name: string;
  read: () => string | null;
}

/** The token and plan name out of a source's raw text. Null when it is not JSON or the token
 *  is empty, which means this source cannot be used. */
export function parseClaudeCredentials(raw: string): ClaudeCredentials | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // `JSON.parse` accepts 'null' and '"a string"' too, so this checks for an object first.
  const oauth = asRecord(asRecord(parsed)?.claudeAiOauth) ?? {};
  const token = typeof oauth.accessToken === 'string' ? oauth.accessToken : '';
  if (!token) return null;
  return { token, plan: planLabel(oauth) };
}

/** The plan name: the subscription type, plus the multiplier at the end of the rate-limit
 *  tier (`default_claude_max_5x` gives `5x`). */
function planLabel(oauth: Record<string, unknown>): string | null {
  const sub = typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : '';
  if (!sub) return null;
  const tier = typeof oauth.rateLimitTier === 'string' ? oauth.rateLimitTier : '';
  const mult = /_(\d+x)$/.exec(tier)?.[1];
  return sub.charAt(0).toUpperCase() + sub.slice(1) + (mult ? ` ${mult}` : '');
}

/** The names of the sources. These appear verbatim in the failure message, so they are also
 *  wording a person reads. */
const FILE_SOURCE_NAME = '~/.claude/.credentials.json';
const KEYCHAIN_SOURCE_NAME = 'Keychain';

/** The sources in the order to try them: the file first, then the login keychain on macOS.
 *  The actual reading is passed in, so this decides only what to try where and in what order.
 *
 *  **The file stays first on every platform.** The keychain was added because the macOS CLI
 *  moved its credentials there; **Linux and Windows have nothing but the file**. Getting that
 *  backwards loses the quota entirely on those platforms, and since a backend that cannot be
 *  read is quietly left out, the screen would never say so. */
export function claudeCredentialSources(
  // A plain string, not `NodeJS.Platform`: this module is `next-watch/quota`, which a browser
  // imports, and naming a Node type here would put `@types/node` in that page's way.
  platform: string,
  readers: { file: () => string | null; keychain: () => string | null },
): CredentialSource[] {
  const sources: CredentialSource[] = [{ name: FILE_SOURCE_NAME, read: readers.file }];
  if (platform === 'darwin') {
    sources.push({ name: KEYCHAIN_SOURCE_NAME, read: readers.keychain });
  }
  return sources;
}

/** Try each source in turn and return the first usable credentials.
 *  **A source that could be read but holds no token counts as unusable**, so a leftover empty
 *  credentials file does not stop the keychain from being tried. */
export function pickClaudeCredentials(
  sources: CredentialSource[],
): { credentials: ClaudeCredentials; from: string } | { credentials: null; tried: string[] } {
  const tried: string[] = [];
  for (const source of sources) {
    tried.push(source.name);
    const raw = source.read();
    if (raw === null) continue;
    const credentials = parseClaudeCredentials(raw);
    if (credentials !== null) return { credentials, from: source.name };
  }
  return { credentials: null, tried };
}
