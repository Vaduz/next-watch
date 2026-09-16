// Whether the five-hour window is open, and whether to open it.
//
// ⚠️ The rows that matter are the two backends' **different shapes for a window that is not
// running**, both measured on 2026-09-16:
//
//   - Claude gives a fixed boundary: closed shows a reset that has passed, open shows the
//     boundary the running window ends at.
//   - Codex gives none until something is running: with nothing open it answers `0%` used and a
//     reset **exactly five hours from the moment it was asked**, which moves with the clock. Two
//     readings 85 seconds apart came back 85 seconds apart; one message froze it.
//
// So a reset in the future does not mean open, and the percentage says nothing at all — one
// `hi` rounds to 0%.
import { describe, expect, it } from 'bun:test';
import {
  QUOTA_SESSION_MAX_FAILURES,
  QUOTA_WINDOW_MS,
  closedShape,
  quotaSessionOpen,
  quotaSessionToStart,
  type ClosedShape,
  type QuotaSessionHistory,
  type QuotaSessionStart,
} from './session.js';
import type { QuotaCard, QuotaWindowView } from '../types.js';

const NOW = Date.parse('2026-09-16T17:00:00+09:00');
const MINUTE = 60_000;

const window = (usedPercent: number, resetsAtMs: number | null): QuotaWindowView => ({
  name: '5h',
  usedPercent,
  resetsAtMs,
});

/** A window that is genuinely running: it ends less than a full window from when it was read. */
const running = window(26, NOW + 2 * 60 * MINUTE);
/** Codex with nothing running: five hours from the moment the figures were read, nothing used. */
const notStarted = window(0, NOW + QUOTA_WINDOW_MS);
/** Claude with nothing running: the boundary has gone by. */
const spent = window(37, NOW - MINUTE);

describe('closedShape', () => {
  const cases: {
    name: string;
    window: QuotaWindowView | null;
    fetchedAtMs: number | null;
    want: ClosedShape | null;
  }[] = [
    { name: 'no window in the card at all', window: null, fetchedAtMs: NOW, want: 'missing' },
    { name: 'a window with no reset time', window: window(0, null), fetchedAtMs: NOW, want: 'no-reset' },
    { name: "Claude's spent window, whose boundary has passed", window: spent, fetchedAtMs: NOW, want: 'reset-passed' },
    {
      // The row the whole rule exists for.
      name: "Codex's shape with nothing running: five hours ahead, 0% used",
      window: notStarted,
      fetchedAtMs: NOW,
      want: 'not-started',
    },
    {
      // The measured value was 1.6 seconds short of five hours — the round trip.
      name: 'the same, a round trip short of exactly five hours',
      window: window(0, NOW + QUOTA_WINDOW_MS - 1_600),
      fetchedAtMs: NOW,
      want: 'not-started',
    },
    {
      // ⚠️ The row that says why the reset is measured from when the figures were **read**. A
      // minute-old cache of Codex's not-running shape says "five hours from a minute ago";
      // measured against the current time that is four hours fifty-nine, which reads as a window
      // that has been running for a minute — and Codex would never be sent to again.
      name: 'the same, read from a cache a minute old',
      window: window(0, NOW - MINUTE + QUOTA_WINDOW_MS),
      fetchedAtMs: NOW - MINUTE,
      want: 'not-started',
    },
    { name: 'a window running with two hours to go', window: running, fetchedAtMs: NOW, want: null },
    {
      // The percentage decides nothing: one `hi` rounds to zero, which is what made the old
      // rule send again ten minutes after every send.
      name: 'a window running with nothing used yet',
      window: window(0, NOW + 4 * 60 * MINUTE),
      fetchedAtMs: NOW,
      want: null,
    },
    { name: 'a window running and nearly full', window: window(98, NOW + MINUTE), fetchedAtMs: NOW, want: null },
  ];
  for (const c of cases) {
    it(`${c.name} -> ${String(c.want)}`, () => {
      expect(closedShape(c.window, NOW, c.fetchedAtMs)).toBe(c.want);
    });
  }

  it('falls back to the current time where the card does not say when it was read', () => {
    expect(closedShape(notStarted, NOW, null)).toBe('not-started');
    // And with nothing to date them by, figures old enough to have drifted read as open. There
    // is nothing better to do: every card this package builds carries the time it was read.
    expect(closedShape(window(0, NOW - MINUTE + QUOTA_WINDOW_MS), NOW, null)).toBeNull();
  });
});

describe('quotaSessionOpen', () => {
  const opened = { atMs: NOW - MINUTE, resetsAtMs: NOW - MINUTE + QUOTA_WINDOW_MS };

  it('is open when the figures say so', () => {
    expect(quotaSessionOpen({ window: running, nowMs: NOW, fetchedAtMs: NOW, opened: null })).toBe(true);
  });

  it('is closed when they say so and this watch has opened nothing', () => {
    expect(quotaSessionOpen({ window: notStarted, nowMs: NOW, fetchedAtMs: NOW, opened: null })).toBe(false);
  });

  // ⚠️ The figures are cached for up to a minute and the endpoint lags behind the message. A
  // window this watch opened is believed until the clock says it has ended.
  it('is open while a window this watch opened is still running, whatever the figures say', () => {
    expect(quotaSessionOpen({ window: notStarted, nowMs: NOW, fetchedAtMs: NOW, opened })).toBe(true);
  });

  it('is closed again once that window has ended', () => {
    const over = { atMs: NOW - QUOTA_WINDOW_MS - MINUTE, resetsAtMs: NOW - MINUTE };
    expect(quotaSessionOpen({ window: notStarted, nowMs: NOW, fetchedAtMs: NOW, opened: over })).toBe(false);
  });
});

describe('quotaSessionToStart', () => {
  const clean: QuotaSessionHistory = { opened: null, failures: 0, retryAtMs: null, sending: false };

  const card = (windows: QuotaWindowView[], fetchedAtMs: number | null = NOW): QuotaCard[] => [
    { label: 'Claude', plan: 'Max 5x', windows, error: null, fetchedAtMs, stale: false },
  ];

  const ask = (
    windows: QuotaWindowView[],
    history: Partial<QuotaSessionHistory> = {},
    fetchedAtMs = NOW,
  ): QuotaSessionStart | null =>
    quotaSessionToStart({
      cards: card(windows, fetchedAtMs),
      label: 'Claude',
      nowMs: NOW,
      history: { ...clean, ...history },
    });

  const cases: { name: string; windows: QuotaWindowView[]; history?: Partial<QuotaSessionHistory>; send: boolean }[] = [
    { name: "Claude's window has been spent", windows: [spent], send: true },
    { name: 'the window has no reset time', windows: [window(0, null)], send: true },
    { name: "Codex's shape with nothing running", windows: [notStarted], send: true },
    { name: 'a window is running', windows: [running], send: false },
    { name: 'a window is running with nothing used', windows: [window(0, NOW + 4 * 60 * MINUTE)], send: false },
    {
      // Once per window, by construction. This is the repeat the issue was about: four messages
      // went into one window overnight.
      name: 'this watch opened a window that is still running',
      windows: [notStarted],
      history: { opened: { atMs: NOW - MINUTE, resetsAtMs: NOW + QUOTA_WINDOW_MS - MINUTE } },
      send: false,
    },
    {
      name: 'the window this watch opened has ended',
      windows: [spent],
      history: { opened: { atMs: NOW - QUOTA_WINDOW_MS, resetsAtMs: NOW - MINUTE } },
      send: true,
    },
    { name: 'an attempt is already in flight', windows: [spent], history: { sending: true }, send: false },
    {
      name: 'a failed attempt is not due to be retried yet',
      windows: [spent],
      history: { failures: 1, retryAtMs: NOW + MINUTE },
      send: false,
    },
    {
      name: 'the retry is due',
      windows: [spent],
      history: { failures: 1, retryAtMs: NOW - MINUTE },
      send: true,
    },
    {
      // Ten minutes apart, so this is half an hour of trying. A CLI that has failed three times
      // will fail the fourth, and the log would carry it for the rest of the day.
      name: 'too many have failed in a row',
      windows: [spent],
      history: { failures: QUOTA_SESSION_MAX_FAILURES, retryAtMs: null },
      send: false,
    },
  ];
  for (const c of cases) {
    it(`${c.send ? 'sends' : 'does not send'} when ${c.name}`, () => {
      expect(ask(c.windows, c.history) !== null).toBe(c.send);
    });
  }

  it('says nothing at all about a backend it has no card for', () => {
    expect(quotaSessionToStart({ cards: [], label: 'Claude', nowMs: NOW, history: clean })).toBeNull();
  });

  // An unreadable window and a closed one look the same, and the answer when it is unknown is no.
  it('says nothing about a card whose windows could not be read', () => {
    expect(ask([])).toBeNull();
  });

  it('hands back the window to remember, five hours from the send', () => {
    expect(ask([spent])?.opened).toEqual({ atMs: NOW, resetsAtMs: NOW + QUOTA_WINDOW_MS });
  });

  const reasons: { name: string; windows: QuotaWindowView[]; says: string }[] = [
    { name: 'a spent window', windows: [spent], says: '5h window reset 1min ago, 37% used' },
    { name: 'no reset time', windows: [window(4, null)], says: '5h window has no reset time, 4% used' },
    { name: "Codex's not-yet-running shape", windows: [notStarted], says: '5h window has not started, 0% used' },
  ];
  for (const c of reasons) {
    it(`puts the evidence for ${c.name} in the event`, () => {
      expect(ask(c.windows)?.why).toBe(c.says);
    });
  }
});
