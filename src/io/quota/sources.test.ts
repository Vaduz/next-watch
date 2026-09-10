// Fetching the quota from outside. The 429 rule is fixed here, because a 429 from this endpoint
// says nothing about how much quota is left — it is the endpoint's own limit — and treating it
// as an ordinary HTTP error would make the caller give up on the figures instead of waiting.
//
// The real endpoint is never called: `fetch` is replaced.
import { describe, expect, it } from 'bun:test';
import { fetchClaudeUsage } from './sources.js';
import type { FetchLike } from '../http.js';

const NOW = 1_800_000_000_000;
const OPTS = { nowMs: NOW, fallbackBackoffMs: 5 * 60_000, userAgent: 'test-agent' };

describe('fetchClaudeUsage', () => {
  it('sends the token as a bearer and returns what rate_limits held', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const impl: FetchLike = (url, init) => {
      seen.push({ url, init });
      return Promise.resolve(Response.json({ rate_limits: { five_hour: { utilization: 40 } } }));
    };

    const result = await fetchClaudeUsage('tok', { ...OPTS, fetchImpl: impl });

    expect(result).toEqual({ kind: 'ok', rateLimits: { five_hour: { utilization: 40 } } });
    expect(seen[0].url).toBe('https://api.anthropic.com/api/oauth/usage');
    const headers = seen[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['anthropic-beta']).toBe('oauth-2025-04-20');
    // Whoever is asking has to say so, or the request is anonymous to the other end.
    expect(headers['user-agent']).toBe('test-agent');
  });

  it('turns a 429 into how long to wait, apart from the other HTTP errors', async () => {
    const impl: FetchLike = () => Promise.resolve(new Response('', { status: 429, headers: { 'retry-after': '120' } }));

    const result = await fetchClaudeUsage('tok', { ...OPTS, fetchImpl: impl });

    expect(result).toEqual({ kind: 'rate-limited', retryAfterMs: 120_000 });
  });

  it('waits the caller default when the 429 gave no Retry-After', async () => {
    const impl: FetchLike = () => Promise.resolve(new Response('', { status: 429 }));

    const result = await fetchClaudeUsage('tok', { ...OPTS, fetchImpl: impl });

    expect(result).toEqual({ kind: 'rate-limited', retryAfterMs: 5 * 60_000 });
  });

  it('returns the status of any other HTTP error, and leaves the wording to the caller', async () => {
    const impl: FetchLike = () => Promise.resolve(new Response('', { status: 503 }));

    expect(await fetchClaudeUsage('tok', { ...OPTS, fetchImpl: impl })).toEqual({
      kind: 'http-error',
      status: 503,
    });
  });

  it('returns the reason rather than throwing when the connection fails', async () => {
    const impl: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));

    expect(await fetchClaudeUsage('tok', { ...OPTS, fetchImpl: impl })).toEqual({
      kind: 'failed',
      message: 'ECONNREFUSED',
    });
  });

  it('turns a timeout into a reason rather than an exception (the timeout itself is http.test.ts)', async () => {
    const impl: FetchLike = () => Promise.reject(new Error('The operation was aborted.'));

    expect(await fetchClaudeUsage('tok', { ...OPTS, fetchImpl: impl })).toMatchObject({ kind: 'failed' });
  });
});
