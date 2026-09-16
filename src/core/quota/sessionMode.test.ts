import { describe, expect, it } from 'bun:test';
import { quotaSessionLine, quotaSessionModeRow, quotaSessionUnder } from './sessionMode.js';
import { clockWithOffset } from '../view/index.js';
import type { QuotaSessionModeRow } from '../types.js';

/** 2026-09-16 09:02 at UTC+9, the offset every expectation below is written for. */
const NOW = Date.parse('2026-09-16T00:02:00Z');
const CLOCK = clockWithOffset(9 * 60);
const at = (time: string): number => Date.parse(`2026-09-16T${time}+09:00`);

const row = (over: Partial<QuotaSessionModeRow> = {}): QuotaSessionModeRow => ({
  cli: 'claude',
  mode: 'auto',
  window: null,
  nextAtMinutes: null,
  sentAtMs: null,
  ...over,
});

describe('quotaSessionLine', () => {
  const cases: { want: string; row: Partial<QuotaSessionModeRow>; why: string }[] = [
    {
      want: 'session: off',
      row: { mode: 'off' },
      why: 'the setting exists and is not on, which is worth a line of its own',
    },
    {
      want: 'session: auto · next refresh when the window closes (13:12)',
      row: { mode: 'auto', window: { open: true, closesAtMs: at('13:12:00') } },
      why: 'automatic and a window open: the next one begins when this one ends',
    },
    {
      want: 'session: auto · next refresh when the window closes',
      row: { mode: 'auto', window: { open: true, closesAtMs: null } },
      why: 'open, but the quota gave no reset time',
    },
    {
      want: 'session: auto · next refresh now (window closed, sending)',
      row: { mode: 'auto', window: { open: false, closesAtMs: null }, sending: true },
      why: 'automatic with nothing open is the case it acts on',
    },
    {
      // ⚠️ `sending` used to be shown whenever the window was shut, so a CLI that failed every
      // attempt read as busy sending for ever. It is now shown only while one is in flight.
      want: 'session: auto · next refresh now (window closed)',
      row: { mode: 'auto', window: { open: false, closesAtMs: null } },
      why: 'shut, and nothing in flight at this instant',
    },
    {
      want: 'session: auto · failed 17:08 (exit 1) · retry 17:18',
      row: {
        mode: 'auto',
        window: { open: false, closesAtMs: null },
        lastFailure: { atMs: at('17:08:00'), detail: 'exited with 1' },
        retryAtMs: at('17:18:00'),
      },
      why: 'a failed attempt says so, and when the next one is due',
    },
    {
      want: 'session: auto · failed 17:08 · no more this window',
      row: {
        mode: 'auto',
        window: { open: false, closesAtMs: null },
        lastFailure: { atMs: at('17:08:00'), detail: 'killed by SIGTERM (timed out?)' },
        retryAtMs: null,
        gaveUp: true,
      },
      why: 'after too many in a row there is no next attempt to name',
    },
    {
      want: 'session: manual · failed 09:00 (exit 1) · retry 09:10',
      row: {
        mode: 'manual',
        nextAtMinutes: 840,
        window: { open: false, closesAtMs: null },
        sentAtMs: at('09:00:00'),
        lastFailure: { atMs: at('09:00:00'), detail: 'exited with 1' },
        retryAtMs: at('09:10:00'),
      },
      why: 'a listed time that did not open the window replaces both the next time and the sent tail',
    },
    {
      want: 'session: auto',
      row: { mode: 'auto', window: null },
      why: 'the quota has not been read yet, so it says nothing it does not know',
    },
    {
      want: 'session: manual · next refresh 14:00',
      row: { mode: 'manual', nextAtMinutes: 840 },
      why: 'the schedule, waiting',
    },
    {
      want: 'session: manual · next refresh 14:00 · sent 09:02',
      row: { mode: 'manual', nextAtMinutes: 840, sentAtMs: NOW },
      why: 'just after a firing, since nothing else on the screen would show it happened',
    },
    {
      want: 'session: manual · next refresh 14:00',
      row: { mode: 'manual', nextAtMinutes: 840, sentAtMs: NOW - 11 * 60_000 },
      why: 'the tail ages out, rather than sitting there all day',
    },
    {
      // In the automatic mode the new closing time is the better report of a message sent.
      want: 'session: auto · next refresh when the window closes (13:12)',
      row: { mode: 'auto', window: { open: true, closesAtMs: at('13:12:00') }, sentAtMs: NOW },
      why: 'no `sent` tail in the automatic mode',
    },
  ];
  for (const c of cases) {
    it(`${c.want}: ${c.why}`, () => {
      expect(quotaSessionLine(row(c.row), NOW, CLOCK)).toBe(c.want);
    });
  }

  // The service section indents this line twelve columns, and the frame costs four more, so
  // eighty columns is the number it has to come in under. A rewording that grew past it would
  // wrap and cost a row on every screen.
  it('fits an eighty-column terminal in every shape', () => {
    for (const c of cases) expect(quotaSessionLine(row(c.row), NOW, CLOCK).length + 12 + 4).toBeLessThanOrEqual(80);
  });
});

describe('quotaSessionUnder', () => {
  const rows = [row({ cli: 'claude' }), row({ cli: 'codex', mode: 'off' })];

  it('puts the Claude line under the Claude status page', () => {
    expect(quotaSessionUnder('Claude', rows)?.cli).toBe('claude');
  });

  it('puts the Codex line under OpenAI, which is the page Codex depends on', () => {
    expect(quotaSessionUnder('OpenAI', rows)?.cli).toBe('codex');
  });

  it('gives a service a host listed itself no line at all', () => {
    expect(quotaSessionUnder('Vercel', rows)).toBeNull();
  });

  it('gives a known service with no row of its own no line either', () => {
    expect(quotaSessionUnder('OpenAI', [row({ cli: 'claude' })])).toBeNull();
  });
});

describe('quotaSessionModeRow', () => {
  const build = (o: Partial<Parameters<typeof quotaSessionModeRow>[0]>): QuotaSessionModeRow =>
    quotaSessionModeRow({
      cli: 'claude',
      at: null,
      on: true,
      window: null,
      sentAtMs: null,
      nowMs: NOW,
      offsetMinutes: 9 * 60,
      ...o,
    });

  it('is automatic with no times listed', () => {
    expect(build({}).mode).toBe('auto');
  });

  it('is manual with times, and works out the next one in the watch clock', () => {
    const built = build({ at: [360, 840] });

    expect(built.mode).toBe('manual');
    expect(built.nextAtMinutes).toBe(840);
  });

  it('is off when the switch is, and then carries nothing else', () => {
    const built = build({ at: [840], on: false, window: { open: true, closesAtMs: NOW }, sentAtMs: NOW });

    expect(built).toEqual({
      cli: 'claude',
      mode: 'off',
      note: null,
      window: null,
      nextAtMinutes: null,
      sentAtMs: null,
      sending: false,
      lastFailure: null,
      retryAtMs: null,
      gaveUp: false,
    });
  });

  it('is off when the CLI is not installed, and the line says which of the two it is', () => {
    const built = build({ at: [840], installed: false });

    expect(built.mode).toBe('off');
    expect(quotaSessionLine(built, NOW, CLOCK)).toBe('session: off (not installed)');
  });
});
