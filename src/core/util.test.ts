import { describe, expect, it } from 'bun:test';
import { asRecord, formatClockElapsed, sleep } from './util.js';

describe('asRecord', () => {
  it('reads a plain object', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });

  // An array would let `items[0]` be read by key, which is the mistake this guards against.
  it('rejects arrays, null and primitives', () => {
    for (const value of [[1, 2], null, undefined, 'x', 3, true]) {
      expect(asRecord(value), JSON.stringify(value ?? null)).toBeNull();
    }
  });
});

describe('sleep', () => {
  it('resolves without a timer when the delay is zero or negative', async () => {
    // Racing against an already-resolved promise is what makes this a real check: a `sleep`
    // that set a timer would lose the race, and the answer would be `same-tick`.
    expect(await Promise.race([sleep(0), Promise.resolve('same-tick')])).toBeUndefined();
    expect(await Promise.race([sleep(-5), Promise.resolve('same-tick')])).toBeUndefined();
  });

  it('waits when the delay is positive', async () => {
    const started = Date.now();
    await sleep(5);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4);
  });
});

describe('formatClockElapsed', () => {
  it('keeps seconds at every scale', () => {
    expect(formatClockElapsed(0)).toBe('0');
    expect(formatClockElapsed(9)).toBe('9');
    expect(formatClockElapsed(90)).toBe('1:30');
    expect(formatClockElapsed(3599)).toBe('59:59');
    expect(formatClockElapsed(3600)).toBe('1:00:00');
    expect(formatClockElapsed(3661)).toBe('1:01:01');
  });

  it('falls back to 0 for missing, negative and non-finite input', () => {
    expect(formatClockElapsed(null)).toBe('0');
    expect(formatClockElapsed(-1)).toBe('0');
    expect(formatClockElapsed(Number.NaN)).toBe('0');
    expect(formatClockElapsed(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('truncates fractional seconds rather than rounding up', () => {
    expect(formatClockElapsed(59.9)).toBe('59');
  });
});
