// The shape of the shared cache file. Another program on the machine writes it and the watcher
// reads it, so "an unreadable shape reads as nothing" is the rule that keeps them independent:
// whichever side is on an older shape, the other one just fetches for itself.
//
// ⚠️ The reading and writing themselves touch a real file under the temp directory, which is
// the one in use, so they are not called here. Only the shape check is exercised.
import { describe, expect, it } from 'bun:test';
import { parseCachedQuota, QUOTA_WINDOW_MINUTES, QUOTA_WINDOW_NAMES } from './cache.js';

const VALID = {
  fetchedAtMs: 1_800_000_000_000,
  plan: 'Max (5x)',
  windows: [
    { name: '5h', usedPercent: 12.5, resetsAtMs: 1_800_003_600_000 },
    { name: '7d', usedPercent: 40, resetsAtMs: null },
  ],
};

describe('parseCachedQuota', () => {
  it('lets a readable file through unchanged', () => {
    expect(parseCachedQuota(VALID)).toEqual(VALID);
  });

  it('drops only the broken windows and keeps the rest', () => {
    const parsed = parseCachedQuota({
      ...VALID,
      windows: [...VALID.windows, { name: 'x' }, { usedPercent: 1 }, null],
    });

    expect(parsed?.windows).toEqual(VALID.windows);
  });

  it('reads as nothing when no window survives (a card with no windows says nothing)', () => {
    expect(parseCachedQuota({ ...VALID, windows: [] })).toBeNull();
    expect(parseCachedQuota({ ...VALID, windows: [{ name: 'x' }] })).toBeNull();
  });

  it('reads as nothing without a timestamp, without an array of windows, or given something else', () => {
    expect(parseCachedQuota({ plan: null, windows: VALID.windows })).toBeNull();
    expect(parseCachedQuota({ fetchedAtMs: 1, plan: null, windows: 'nope' })).toBeNull();
    expect(parseCachedQuota(null)).toBeNull();
    expect(parseCachedQuota([VALID])).toBeNull();
  });

  it('reads an older shape as nothing rather than half of it', () => {
    // This happens once, right after the shape changes. Unreadable means the caller fetches.
    const old = { fetchedAtMs: 1, value: { backend: 'cli', fiveHour: { usedPercent: 1 } } };
    expect(parseCachedQuota(old)).toBeNull();
  });

  it('takes the plan only when it is a string', () => {
    expect(parseCachedQuota({ ...VALID, plan: 42 })?.plan).toBeNull();
  });
});

describe('the window names and lengths', () => {
  it('gives every name a length, so a reader can get the duration back from the name alone', () => {
    for (const name of Object.values(QUOTA_WINDOW_NAMES)) {
      expect(QUOTA_WINDOW_MINUTES[name]).toBeGreaterThan(0);
    }
    expect(QUOTA_WINDOW_MINUTES[QUOTA_WINDOW_NAMES.fiveHour]).toBe(300);
    expect(QUOTA_WINDOW_MINUTES[QUOTA_WINDOW_NAMES.weekly]).toBe(10080);
  });
});
