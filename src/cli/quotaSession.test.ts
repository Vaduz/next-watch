// What the watch actually does with the decision: one look per CLI, arming each schedule once,
// writing back what has fired, saying what it saw, and honouring `--dry-run`. The decision itself
// is a table in `core/quota/schedule.test.ts`; this is the glue around it.
//
// Nothing here reaches the network or spends a message: the quota reader, the sender and the
// "is it installed" answer are all given to the function.
import { describe, expect, it } from 'bun:test';
import { maybeStartQuotaSession, type QuotaSessionScreen } from './quotaSession.js';
import { quotaSessionRows } from './quotaSessionRows.js';
import { initialState, type WatchState } from '../core/watchState.js';
import { clockWithOffset } from '../core/view/index.js';
import { resolveConfig, type ResolvedConfig } from '../config.js';
import type { QuotaSessionSwitch } from '../core/quota/sessionConfig.js';
import type { Mark } from '../core/term/index.js';
import type { QuotaCard } from '../core/types.js';

/** JST, which every time below is written in. */
const JST = 9 * 60;
const at = (day: string, time: string): number => Date.parse(`${day}T${time}+09:00`);

/** A backend's card, with its five-hour window open until `closes` or closed when that is null.
 *
 *  ⚠️ `fetchedAtMs` matters to the decision: what marks a window as **not yet running** is a
 *  reset a whole window ahead of the moment the figures were read. So an open window's figures
 *  are dated halfway through it, which is what a real reading of a running window looks like. */
const HALF_WINDOW_MS = 2.5 * 60 * 60_000;
const card = (label: string, closes: number | null): QuotaCard => ({
  label,
  plan: 'Max 5x',
  windows: [{ name: '5h', usedPercent: closes === null ? 0 : 26, resetsAtMs: closes }],
  error: null,
  fetchedAtMs: closes === null ? at('2026-09-16', '05:00:00') : closes - HALF_WINDOW_MS,
  stale: false,
});

/** Both backends at once, which is what the reader really returns. */
const cards = (claude: number | null, codex: number | null = claude): QuotaCard[] => [
  card('Claude', claude),
  card('Codex', codex),
];

/** The screen, remembering what it was told rather than drawing it. */
function recorder(): QuotaSessionScreen & { said: string[] } {
  const said: string[] = [];
  return {
    said,
    clock: clockWithOffset(JST),
    event: (_atMs: number, _mark: Mark, text: string) => {
      said.push(text);
    },
  };
}

function config(o: { quotaSession: QuotaSessionSwitch; read: () => Promise<QuotaCard[]> }): ResolvedConfig {
  const base = resolveConfig({
    appName: 'site',
    root: '/tmp/next-watch-test',
    timezoneOffsetMinutes: JST,
    pull: { blocked: [] },
    servers: [],
    providers: { quotaSession: o.quotaSession },
  });
  const session = base.providers.quotaSession;
  return {
    ...base,
    // The reader is the one thing a test must not keep: it would go to the usage endpoint.
    providers: { ...base.providers, quotaSession: session === null ? null : { ...session, read: o.read } },
  };
}

/** One look at the clock, with the CLIs it sent to. */
async function look(
  cfg: ResolvedConfig,
  state: WatchState,
  screen: QuotaSessionScreen,
  o: { now: string; day?: string; dryRun?: boolean; missing?: readonly string[]; fails?: boolean },
): Promise<string[]> {
  const sent: string[] = [];
  await maybeStartQuotaSession(cfg, state, screen, () => undefined, {
    nowMs: at(o.day ?? '2026-09-16', o.now),
    dryRun: o.dryRun ?? false,
    installed: command => !(o.missing ?? []).includes(command),
    send: cli => {
      sent.push(cli);
      return Promise.resolve(o.fails === true ? { ok: false, detail: 'exited with 1' } : { ok: true, detail: null });
    },
  });
  // The send is deliberately not awaited by the watcher, so its outcome lands a tick later.
  // Nothing in a test may look at the state before it has.
  await Promise.resolve();
  await Promise.resolve();
  return sent;
}

const freshState = (): WatchState => initialState('a'.repeat(40), at('2026-09-16', '05:00:00'));

describe('maybeStartQuotaSession, on a schedule', () => {
  const closed = (): ResolvedConfig =>
    config({ quotaSession: { at: ['09:00', '14:00'] }, read: () => Promise.resolve(cards(null)) });

  it('does nothing before a listed time, and says when the next one is for each CLI', async () => {
    const screen = recorder();

    expect(await look(closed(), freshState(), screen, { now: '08:00:00' })).toEqual([]);
    expect(screen.said).toEqual([
      'quota: claude next scheduled session 09:00',
      'quota: codex next scheduled session 09:00',
    ]);
  });

  it('makes up nothing for the times that passed before it started', async () => {
    const screen = recorder();

    expect(await look(closed(), freshState(), screen, { now: '15:00:00' })).toEqual([]);
    // Both of today's times are behind, so the next one is tomorrow morning's — and the line
    // says which day, or a schedule with one time a day would read as having fired for nothing.
    expect(screen.said).toEqual([
      'quota: claude next scheduled session 09:00 (tomorrow)',
      'quota: codex next scheduled session 09:00 (tomorrow)',
    ]);
  });

  it('opens both windows at the listed time, once, and says so', async () => {
    const screen = recorder();
    const state = freshState();
    const cfg = closed();

    await look(cfg, state, screen, { now: '08:59:00' });
    const sent = await look(cfg, state, screen, { now: '09:00:04' });

    expect(sent).toEqual(['claude', 'codex']);
    expect(screen.said).toContain('quota: claude 09:00 — opening the window with claude -p "hi" ...');
    expect(screen.said).toContain(
      'quota: codex 09:00 — opening the window with codex exec --skip-git-repo-check "hi" ...',
    );
    expect(screen.said).toContain('quota: codex next scheduled session 14:00');
    // A second look in the same minute sends nothing more.
    expect(await look(cfg, state, screen, { now: '09:00:05' })).toEqual([]);
  });

  it('fires the same time again the next day', async () => {
    const screen = recorder();
    const state = freshState();
    const cfg = closed();

    await look(cfg, state, screen, { now: '09:00:00' });
    expect(await look(cfg, state, screen, { day: '2026-09-17', now: '09:00:00' })).toEqual(['claude', 'codex']);
  });

  it('sends nothing while a window is open, and says until when', async () => {
    const screen = recorder();
    const open = config({
      quotaSession: { at: ['09:00'] },
      read: () => Promise.resolve(cards(at('2026-09-16', '13:12:00'))),
    });

    const sent = await look(open, freshState(), screen, { now: '09:00:02' });

    expect(sent).toEqual([]);
    expect(screen.said).toContain('quota: claude 09:00 — window already open until 13:12, nothing sent');
    expect(screen.said).toContain('quota: codex 09:00 — window already open until 13:12, nothing sent');
  });

  it('decides each CLI on its own window', async () => {
    const screen = recorder();
    // Claude's is open until 13:12; Codex's is shut.
    const mixed = config({
      quotaSession: { at: ['09:00'] },
      read: () => Promise.resolve(cards(at('2026-09-16', '13:12:00'), null)),
    });

    expect(await look(mixed, freshState(), screen, { now: '09:00:02' })).toEqual(['codex']);
  });

  it('sends nothing under --dry-run, and still marks the time as done', async () => {
    const screen = recorder();
    const state = freshState();
    const cfg = closed();

    expect(await look(cfg, state, screen, { now: '09:00:00', dryRun: true })).toEqual([]);
    expect(screen.said).toContain('(dry-run) would open the claude quota window for 09:00');
    // Done is done: dropping the dry-run does not make it fire for the same time.
    expect(await look(cfg, state, screen, { now: '09:01:00' })).toEqual([]);
  });

  it('carries on when the quota cannot be read at all', async () => {
    const screen = recorder();
    const cfg = config({ quotaSession: { at: ['09:00'] }, read: () => Promise.reject(new Error('no credentials')) });

    expect(await look(cfg, freshState(), screen, { now: '09:00:00' })).toEqual([]);
    expect(screen.said).toEqual([]);
  });
});

describe('maybeStartQuotaSession, automatic', () => {
  const auto = (closes: number | null): ResolvedConfig =>
    config({ quotaSession: true, read: () => Promise.resolve(cards(closes)) });

  it('opens a closed window whenever it finds one, for each CLI', async () => {
    const screen = recorder();

    expect(await look(auto(null), freshState(), screen, { now: '03:00:00' })).toEqual(['claude', 'codex']);
    expect(screen.said[0]).toContain('Claude quota session is closed');
    expect(screen.said[1]).toContain('codex exec --skip-git-repo-check "hi"');
  });

  it('leaves an open one alone', async () => {
    const screen = recorder();

    expect(await look(auto(at('2026-09-16', '13:12:00')), freshState(), screen, { now: '09:00:00' })).toEqual([]);
    expect(screen.said).toEqual([]);
  });

  // ⚠️ This was a real gap: `--dry-run` promises the run changes nothing, and this is the one
  // thing here that spends something.
  it('sends nothing under --dry-run', async () => {
    const screen = recorder();

    expect(await look(auto(null), freshState(), screen, { now: '03:00:00', dryRun: true })).toEqual([]);
    expect(screen.said).toEqual([
      '(dry-run) would open the claude quota window',
      '(dry-run) would open the codex quota window',
    ]);
  });

  it('obeys a switch given per CLI', async () => {
    const screen = recorder();
    const cfg = config({ quotaSession: { claude: false, codex: true }, read: () => Promise.resolve(cards(null)) });

    expect(await look(cfg, freshState(), screen, { now: '03:00:00' })).toEqual(['codex']);
  });

  // ⚠️ **The repeat this whole change is about.** Four messages went into one window overnight:
  // the send worked, the figures still read as closed for a while afterwards, and ten minutes
  // later the same window was opened again. What was sent to is now remembered from the clock,
  // so the figures catching up decides nothing.
  it('sends once per window, however long the figures take to agree', async () => {
    const screen = recorder();
    const state = freshState();
    const cfg = auto(null);

    expect(await look(cfg, state, screen, { now: '03:00:00' })).toEqual(['claude', 'codex']);
    expect(await look(cfg, state, screen, { now: '03:10:00' })).toEqual([]);
    expect(await look(cfg, state, screen, { now: '07:00:00' })).toEqual([]);
    // Five hours on, that window has ended and the next one is this watch's to open again.
    expect(await look(cfg, state, screen, { now: '08:01:00' })).toEqual(['claude', 'codex']);
  });

  const failing = (o: { now: string }, state: WatchState, screen: ReturnType<typeof recorder>): Promise<string[]> =>
    look(auto(null), state, screen, { ...o, fails: true });

  it('tries a failed send again, but not before the retry is due', async () => {
    const screen = recorder();
    const state = freshState();

    expect(await failing({ now: '03:00:00' }, state, screen)).toEqual(['claude', 'codex']);
    // Ten minutes is the gap; a second look a minute later must not start another attempt.
    expect(await failing({ now: '03:01:00' }, state, screen)).toEqual([]);
    expect(await failing({ now: '03:11:00' }, state, screen)).toEqual(['claude', 'codex']);
  });

  it('gives up after three in a row, and says so once', async () => {
    const screen = recorder();
    const state = freshState();

    for (const now of ['03:00:00', '03:11:00', '03:22:00']) await failing({ now }, state, screen);
    expect(await failing({ now: '03:33:00' }, state, screen)).toEqual([]);
    expect(await failing({ now: '05:00:00' }, state, screen)).toEqual([]);

    const gaveUp = screen.said.filter(l => l.includes('nothing more until a window opens'));
    expect(gaveUp).toEqual([
      'quota: claude failed 3 times, nothing more until a window opens',
      'quota: codex failed 3 times, nothing more until a window opens',
    ]);
  });

  // Whatever was wrong, something opened a window. The count exists to stop a broken CLI being
  // run once a second, not to remember it for the rest of the day.
  it('starts counting again once a window is open, whoever opened it', async () => {
    const screen = recorder();
    const state = freshState();

    for (const now of ['03:00:00', '03:11:00', '03:22:00']) await failing({ now }, state, screen);
    await look(auto(at('2026-09-16', '13:12:00')), state, screen, { now: '09:00:00' });

    expect(await failing({ now: '14:00:00' }, state, screen)).toEqual(['claude', 'codex']);
  });

  it('reports the failure under the service row, with the time of the next attempt', async () => {
    const screen = recorder();
    const state = freshState();

    await failing({ now: '03:00:00' }, state, screen);

    const row = quotaSessionRows(auto(null), state, at('2026-09-16', '03:00:30')).find(r => r.cli === 'claude');
    expect(row?.sending).toBe(false);
    expect(row?.lastFailure?.detail).toBe('exited with 1');
    expect(row?.gaveUp).toBe(false);
    expect(row?.retryAtMs).not.toBeNull();
  });
});

describe('maybeStartQuotaSession, a CLI that is not installed', () => {
  const auto = (): ResolvedConfig => config({ quotaSession: true, read: () => Promise.resolve(cards(null)) });

  it('says so once, sends nothing to it, and carries on with the other', async () => {
    const screen = recorder();
    const state = freshState();
    const cfg = auto();

    expect(await look(cfg, state, screen, { now: '03:00:00', missing: ['codex'] })).toEqual(['claude']);
    expect(screen.said).toContain('quota: codex not installed, no session for it');

    // Said once. A line about it every second would bury everything else.
    const before = screen.said.length;
    await look(cfg, state, screen, { now: '03:00:01', missing: ['codex'] });
    expect(screen.said.slice(before)).not.toContain('quota: codex not installed, no session for it');
  });

  it('draws it as off, with the reason', async () => {
    const screen = recorder();
    const state = freshState();
    const cfg = auto();

    await look(cfg, state, screen, { now: '03:00:00', missing: ['codex'] });

    const codex = quotaSessionRows(cfg, state, at('2026-09-16', '03:00:00')).find(r => r.cli === 'codex');
    expect(codex?.mode).toBe('off');
    expect(codex?.note).toBe('not installed');
  });
});

describe('quotaSessionRows', () => {
  const now = at('2026-09-16', '09:02:00');

  it('draws a row for every CLI, off included, so the setting is never invisible', () => {
    const cfg = config({ quotaSession: false, read: () => Promise.resolve([]) });

    expect(quotaSessionRows(cfg, freshState(), now)).toEqual([
      {
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
      },
      {
        cli: 'codex',
        mode: 'off',
        note: null,
        window: null,
        nextAtMinutes: null,
        sentAtMs: null,
        sending: false,
        lastFailure: null,
        retryAtMs: null,
        gaveUp: false,
      },
    ]);
  });

  it('carries what the last look saw, so the line needs no quota section', async () => {
    const screen = recorder();
    const state = freshState();
    const cfg = config({
      quotaSession: { claude: { at: ['09:00', '14:00'] }, codex: false },
      read: () => Promise.resolve(cards(at('2026-09-16', '13:12:00'))),
    });

    await look(cfg, state, screen, { now: '09:02:00' });

    expect(quotaSessionRows(cfg, state, now)).toEqual([
      {
        cli: 'claude',
        mode: 'manual',
        note: null,
        window: { open: true, closesAtMs: at('2026-09-16', '13:12:00') },
        nextAtMinutes: 840,
        sentAtMs: null,
        sending: false,
        lastFailure: null,
        retryAtMs: null,
        gaveUp: false,
      },
      {
        cli: 'codex',
        mode: 'off',
        note: null,
        window: null,
        nextAtMinutes: null,
        sentAtMs: null,
        sending: false,
        lastFailure: null,
        retryAtMs: null,
        gaveUp: false,
      },
    ]);
  });
});
