/** Small pure helpers shared by the rest of the package.
 *
 *  They live here rather than in `io/` because none of them touches a process, a terminal or
 *  the network — which is what makes them testable as a table. */

/** Read an unknown value as an object. **Arrays do not pass**: looking up `items[0]` by key is
 *  a mistake, so an array counts as the wrong shape and falls to `null`. Callers use `??` to
 *  reach their default instead of carrying an `undefined` further in. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Wait for the given number of milliseconds. **Zero or less resolves without a timer.**
 *  Callers that take a delay from the outside pass 0 in tests to mean "do not wait"; going
 *  through `setTimeout(r, 0)` would still cost one extra event-loop turn per call. */
export function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise<void>(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

/** Format elapsed seconds as `h:mm:ss` / `m:ss` / `s`. Negative and non-finite input is `0`.
 *
 *  **Seconds are never dropped.** A dashboard that hides them once a minute has passed cannot
 *  show whether a job that takes ninety seconds is still moving. */
export function formatClockElapsed(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '0';
  const total = Math.floor(seconds);
  const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  if (m > 0) return `${m}:${pad(s)}`;
  return String(s);
}
