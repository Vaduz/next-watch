// The service table and the session line under each of its rows. The rest of the sections are
// checked by assembling a whole panel; this one is here because the alignment of the second line
// is the thing worth pinning, and it is easier to see on the section alone.
import { describe, expect, it } from 'bun:test';
import { painter, displayWidth } from '../term/index.js';
import { clockWithOffset, type WatchLayout, type WatchView } from './index.js';
import { watchLayout } from './layout.js';
import { serviceBlock } from './services.js';
import type { QuotaSessionModeRow, ServiceCard, WatchPanel } from '../types.js';

const plain = painter(false);
const CLOCK = clockWithOffset(9 * 60);
const NOW = Date.parse('2026-09-16T00:02:00Z');
const NO_VIEW: WatchView = { selected: null, scroll: {}, focus: null };
/** An eighty-column terminal, which is the width the README's capture is taken at. */
const NARROW: WatchLayout = watchLayout(80);

const service = (name: string): ServiceCard => ({
  name,
  pageUrl: `https://status.example/${name}`,
  indicator: 'none',
  description: 'All Systems Operational',
  degraded: [],
  error: null,
});

const session = (over: Partial<QuotaSessionModeRow> = {}): QuotaSessionModeRow => ({
  cli: 'claude',
  mode: 'auto',
  window: { open: true, closesAtMs: Date.parse('2026-09-16T04:12:00Z') },
  nextAtMinutes: null,
  sentAtMs: null,
  ...over,
});

function panel(over: Partial<WatchPanel> = {}): WatchPanel {
  return {
    nowMs: NOW,
    startedAtMs: NOW - 60_000,
    repo: { root: '/tmp/site', branch: 'main', head: 'a'.repeat(40), behind: 0 },
    lastPull: null,
    nextCheckSeconds: 42,
    servers: [],
    tasks: [],
    events: [],
    access: {},
    quotas: [],
    ssh: null,
    sessions: null,
    services: [service('Claude'), service('OpenAI')],
    versions: [],
    ...over,
  };
}

const render = (p: WatchPanel): string[] => serviceBlock(p, plain, NARROW, NO_VIEW, CLOCK);

describe('serviceBlock', () => {
  it('draws the services with no session line when nothing reads that setting', () => {
    expect(render(panel())).toEqual([
      '   SERVICE  Claude  ●  All Systems Operational',
      '            OpenAI  ●  All Systems Operational',
    ]);
  });

  it('hangs the session line under the service name, not under the heading', () => {
    const lines = render(panel({ quotaSessions: [session()] }));

    expect(lines).toEqual([
      '   SERVICE  Claude  ●  All Systems Operational',
      '            session: auto · next refresh when the window closes (13:12)',
      '            OpenAI  ●  All Systems Operational',
    ]);
    // The `s` of `session` sits exactly under the `C` of `Claude`.
    expect(lines[1].indexOf('session')).toBe(lines[0].indexOf('Claude'));
  });

  it('gives each CLI its own line under its own service', () => {
    const lines = render(
      panel({ quotaSessions: [session(), session({ cli: 'codex', mode: 'manual', nextAtMinutes: 840 })] }),
    );

    expect(lines[1]).toContain('when the window closes');
    expect(lines[3]).toContain('next refresh 14:00');
  });

  it('leaves a service the host listed itself alone', () => {
    const lines = render(panel({ services: [service('Vercel')], quotaSessions: [session()] }));

    expect(lines).toHaveLength(1);
  });

  // The README's capture is taken at eighty columns, and the frame costs four of them. A line
  // that grew past this would wrap inside the frame and cost a row on every screen.
  it('fits inside an eighty-column frame', () => {
    const rows = [
      session(),
      session({ mode: 'off', window: null }),
      session({ mode: 'manual', nextAtMinutes: 840, sentAtMs: NOW }),
    ];
    for (const row of rows) {
      for (const line of render(panel({ quotaSessions: [row] }))) {
        expect(displayWidth(line)).toBeLessThanOrEqual(NARROW.width - 4);
      }
    }
  });
});
