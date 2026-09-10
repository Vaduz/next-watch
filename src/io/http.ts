/** The manners for every request that leaves this package, and the name it gives when it does.
 *
 *  Two of them, and both matter because the watcher runs unattended for days:
 *
 *   - **A timeout is not optional.** A server that accepts the connection and then says nothing
 *     would hold the panel open forever, and the watch would go quiet without an error.
 *   - The timer stays armed **until the body has been read**. A server can return headers
 *     quickly and then dribble the body out, so handing the caller a `Response` to read
 *     afterwards would put the slow part outside the timeout. The body reader is passed in
 *     instead, and one `finally` covers both.
 *
 *  Failures are **not** handled here. Whether a miss becomes null, an error card or a thrown
 *  exception differs at every call site, so this throws and the caller decides. */

/** The shape of `fetch`, so a test can pass its own. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** `signal` is made here, so it is not accepted. `headers` are laid over the user-agent. */
export type FetchInit = Omit<RequestInit, 'signal' | 'headers'> & {
  headers?: Record<string, string>;
};

/** How this package names itself to anything it talks to: the host's `appName` and the package,
 *  so a request or a client registration can be traced back to which watcher sent it. */
export const clientName = (appName: string): string => `${appName}-next-watch`;

/** A request that says who it is and gives up after `timeoutMs`. The clock keeps running until
 *  `read` has finished with the body. */
export async function fetchWithTimeout<T>(
  o: { url: string; userAgent: string; timeoutMs: number; init?: FetchInit; fetchImpl?: FetchLike },
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, o.timeoutMs);
  try {
    const send = o.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
    // The default goes first so a caller naming the same header wins.
    const res = await send(o.url, {
      ...o.init,
      signal: controller.signal,
      headers: { 'user-agent': o.userAgent, ...o.init?.headers },
    });
    return await read(res);
  } finally {
    clearTimeout(timer);
  }
}
