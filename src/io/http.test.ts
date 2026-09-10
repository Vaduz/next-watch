// The timeout is the point of this module, so it is what gets checked. Everything the watcher
// sends goes through here, and a server that accepts the connection and then says nothing is
// exactly the case a hand-written `fetch` forgets: the watch would go quiet with no error.
//
// The clock here is real and tiny (a few milliseconds), not a fake one. What is being checked is
// that the abort actually reaches the request, and a fake clock would prove only that a timer
// was set.
import { describe, expect, it } from 'bun:test';
import { fetchWithTimeout, clientName, type FetchLike } from './http.js';

/** A server that answers with neither headers nor a body. It rejects **only** on abort, so the
 *  test hangs if the timeout is not wired to the signal. */
function stallingFetch(): { impl: FetchLike; signal: () => AbortSignal | undefined } {
  let signal: AbortSignal | undefined;
  const impl: FetchLike = (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener('abort', () => {
        reject(new Error('aborted'));
      });
    });
  return { impl, signal: () => signal };
}

const read = (res: Response): Promise<string> => res.text();

/** What a promise rejected with, or null when it did not reject. Written out rather than using
 *  a `.rejects` matcher, whose result is typed as nothing to await. */
const rejection = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

describe('fetchWithTimeout', () => {
  it('gives up on a server that never answers, and aborts the request', async () => {
    const stalling = stallingFetch();

    const error = await rejection(
      fetchWithTimeout({ url: 'https://example.test/', userAgent: 'a', timeoutMs: 5, fetchImpl: stalling.impl }, read),
    );

    expect(error).toBeInstanceOf(Error);
    expect(stalling.signal()?.aborted).toBe(true);
  });

  it('keeps the clock running until the body has been read', async () => {
    // Headers back at once, body never — and the body tied to the signal, the way a real
    // `fetch` ties it. A caller handed the `Response` to read for itself after the call
    // returned would sit on this for ever, which is why the body reader is passed in.
    const impl: FetchLike = (_url, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener('abort', () => {
                controller.error(new Error('aborted'));
              });
            },
          }),
        ),
      );

    const error = await rejection(
      fetchWithTimeout({ url: 'https://example.test/', userAgent: 'a', timeoutMs: 5, fetchImpl: impl }, read),
    );

    expect(error).toBeInstanceOf(Error);
  });

  it('says who is asking, and lets the caller override it', async () => {
    const seen: (Record<string, string> | undefined)[] = [];
    const impl: FetchLike = (_url, init) => {
      seen.push(init?.headers as Record<string, string> | undefined);
      return Promise.resolve(new Response('ok'));
    };

    await fetchWithTimeout(
      { url: 'https://example.test/', userAgent: 'watcher', timeoutMs: 100, fetchImpl: impl },
      read,
    );
    await fetchWithTimeout(
      {
        url: 'https://example.test/',
        userAgent: 'watcher',
        timeoutMs: 100,
        fetchImpl: impl,
        init: { headers: { 'user-agent': 'mine' } },
      },
      read,
    );

    expect(seen[0]?.['user-agent']).toBe('watcher');
    expect(seen[1]?.['user-agent']).toBe('mine');
  });
});

describe('clientName', () => {
  it('names the host application and the package, so a request can be traced back', () => {
    expect(clientName('site')).toBe('site-next-watch');
  });
});
