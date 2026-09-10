/** **The conversation** for reading a quota. Pure.
 *
 *  Two callers can want the same numbers — a web page that reloads and a watcher that runs
 *  unattended for days — and both would otherwise copy out how to read the OAuth usage
 *  response and how to speak the app-server's JSON-RPC. Talking to the outside belongs to
 *  `io/`; **what to send and what to read** lives here, once.
 *
 *  The display shape and the cache's lifetime stay with the caller, because those two callers
 *  are tuned differently.
 *
 *  ⚠️ **No Node import may appear here**: this is part of `next-watch/quota`, which a browser
 *  component imports.
 *
 *  The client name is an argument rather than a literal: it names the host application to the
 *  other end. */

import { asRecord } from '../util.js';

/** The limits themselves, out of an `oauth/usage` response. The observed response nests them
 *  under `rate_limits`, but the CLI's statusline input has them at the top level, so both
 *  shapes are read. */
export function claudeRateLimitsOf(body: unknown): Record<string, unknown> {
  const record = asRecord(body) ?? {};
  return asRecord(record.rate_limits) ?? record;
}

/** Read whatever **complete lines** the buffered stdout holds as JSON, returning the
 *  remainder. Diagnostic lines that are not JSON are skipped: the app-server mixes plain text
 *  in with its messages. */
export function consumeJsonLines(buffered: string, onMessage: (msg: Record<string, unknown>) => void): string {
  let buf = buffered;
  let newline: number;
  while ((newline = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, newline).trim();
    buf = buf.slice(newline + 1);
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = asRecord(parsed);
    if (msg !== null) onMessage(msg);
  }
  return buf;
}

/** The first line sent to the app-server. Both the name and the title identify the caller, so
 *  they come from the caller rather than being written down here. */
export function codexInitializeLine(clientName: string, title = clientName, version = '0.1.0'): string {
  const params = { clientInfo: { name: clientName, title, version } };
  return `${JSON.stringify({ id: 1, method: 'initialize', params })}\n`;
}

/** What to do about one message from the app-server. `null` means keep waiting: the message
 *  was not one of ours. */
export type CodexStep =
  /** The response to `initialize`: notify `initialized`, then ask for the limits. */
  | { kind: 'send'; lines: string[] }
  | { kind: 'done'; rateLimits: Record<string, unknown> }
  | { kind: 'failed'; reason: 'no-rate-limits' };

export function codexRateLimitsStep(msg: Record<string, unknown>): CodexStep | null {
  if (msg.id === 1) {
    return {
      kind: 'send',
      lines: ['{"method":"initialized"}\n', '{"id":2,"method":"account/rateLimits/read","params":{}}\n'],
    };
  }
  if (msg.id !== 2) return null;
  const rateLimits = asRecord(asRecord(msg.result)?.rateLimits);
  return rateLimits === null ? { kind: 'failed', reason: 'no-rate-limits' } : { kind: 'done', rateLimits };
}
