import { describe, expect, it } from 'bun:test';
import { type WatchPanel } from './types.js';
import { painter } from './term/index.js';
import { clockWithOffset } from './view/index.js';
import { watchLayout } from './view/layout.js';
import { SaidOnce, initialState, nextSelection, panelDue } from './watchState.js';
import { initialUi, type WatchUi } from './watchInteraction.js';

const plain = painter(false);
/** A 120-column terminal, so a 118-wide frame. */
const LAYOUT = watchLayout(120);
const NOW = Date.parse('2026-08-19T10:42:07Z');
const CLOCK = clockWithOffset(9 * 60);

/** `nextSelection` with the clock supplied. */
const selectionFor = (p: WatchPanel, ui: WatchUi): ReturnType<typeof nextSelection> =>
  nextSelection(p, plain, LAYOUT, CLOCK, ui);

/** The smallest panel that still has things to select: two servers, one task, the panes. */
function panel(overrides: Partial<WatchPanel> = {}): WatchPanel {
  return {
    nowMs: NOW,
    startedAtMs: NOW - 4_320_000,
    repo: { root: '/home/user/site', branch: 'main', head: 'a1b2c3d4eeee', behind: 0 },
    lastPull: null,
    nextCheckSeconds: 42,
    ssh: null,
    servers: [
      {
        server: 'web',
        state: 'up',
        url: 'http://localhost:3000',
        mode: 'dev',
        owner: 'user',
        uptimeSeconds: 4300,
        logFiles: [],
      },
      { server: 'admin', state: 'down', url: ':4321', mode: null, owner: null, uptimeSeconds: null, logFiles: [] },
    ],
    tasks: [
      {
        id: 'ec58774e',
        label: 'build:site --limit 3',
        pid: 4001,
        state: 'running',
        elapsedSeconds: 740,
        endedSecondsAgo: null,
      },
    ],
    access: {
      admin: { file: '/tmp/admin.log', rows: [] },
      web: { file: '/tmp/web.log', rows: [] },
    },
    events: [],
    quotas: [],
    sessions: [],
    services: [],
    versions: [],
    ...overrides,
  };
}

const events = (n: number): WatchPanel['events'] =>
  Array.from({ length: n }, (_, i) => ({ atMs: NOW - (n - i) * 1_000, mark: 'info' as const, text: `event ${i}` }));

describe('initialState', () => {
  it('takes the time from its argument rather than reading a clock', () => {
    const state = initialState('a1b2c3d', 1_000);
    expect(state.startedAtMs).toBe(1_000);
    expect(state.nextGitCheckAtMs).toBe(1_000);
    expect(state.repo).toEqual({ head: 'a1b2c3d', behind: 0 });
  });

  it('starts the two difference-based fields at null, so the first tick says nothing', () => {
    const state = initialState('a1b2c3d', NOW);
    expect(state.versions).toBeNull();
    expect(state.ssh).toBeNull();
  });

  it('starts as though no panel has been drawn, so the first one is due at once', () => {
    // Zero makes `panelDue` true immediately after startup, so the first panel appears.
    expect(initialState('a1b2c3d', NOW).lastPanelAtMs).toBe(0);
    expect(panelDue(600, initialState('a1b2c3d', NOW).lastPanelAtMs, NOW)).toBe(true);
  });
});

describe('panelDue', () => {
  it('never redraws when the period is zero, however much time has passed', () => {
    expect(panelDue(0, 0, NOW)).toBe(false);
  });

  it('redraws exactly at the period, the boundary being inclusive', () => {
    expect(panelDue(600, NOW - 600_000, NOW)).toBe(true);
    expect(panelDue(600, NOW - 599_999, NOW)).toBe(false);
  });
});

describe('nextSelection', () => {
  it('leaves nothing selected until something is, rather than placing a cursor', () => {
    const next = selectionFor(panel(), initialUi());
    expect(next.targets.length).toBeGreaterThan(0);
    expect(next.selected).toBeNull();
    expect(next.index).toBe(0);
  });

  it('keeps the selection while what was selected still exists', () => {
    const first = selectionFor(panel(), initialUi());
    const held = first.targets[1]?.key ?? '';
    const next = selectionFor(panel(), { ...initialUi(), selected: held, index: 1 });
    expect(next.selected).toBe(held);
  });

  it('moves to a neighbour when the selected task disappears, not back to the top', () => {
    const withTask = selectionFor(panel(), initialUi());
    const taskKey = withTask.targets.find(t => t.kind === 'task')?.key;
    expect(taskKey).toBeDefined();
    const index = withTask.targets.findIndex(t => t.key === taskKey);
    const gone = selectionFor(panel({ tasks: [] }), { ...initialUi(), selected: taskKey ?? null, index });
    expect(gone.selected).not.toBe(taskKey);
    // It stays near where the selection was, rather than rewinding to index 0.
    expect(gone.index).toBeGreaterThan(0);
  });

  it('derives the scroll limit from the entries shown, which is at most the total', () => {
    const few = selectionFor(panel({ events: events(3) }), initialUi());
    const many = selectionFor(panel({ events: events(400) }), initialUi());
    // Three entries fit, so there is nowhere to scroll; four hundred do not.
    expect(few.scrollMax.event).toBe(0);
    expect(many.scrollMax.event).toBeGreaterThan(0);
    expect(many.scrollMax.event).toBeLessThan(400);
  });

  it('cannot scroll a pane whose access log is empty', () => {
    const next = selectionFor(panel(), initialUi());
    expect(next.scrollMax.admin).toBe(0);
    expect(next.scrollMax.web).toBe(0);
  });
});

describe('SaidOnce', () => {
  it('says the same state only once', () => {
    const said = new SaidOnce();
    expect(said.fresh('behind 3')).toBe(true);
    expect(said.fresh('behind 3')).toBe(false);
  });

  it('speaks again when the state changes', () => {
    const said = new SaidOnce();
    said.fresh('behind 3');
    expect(said.fresh('behind 4')).toBe(true);
    // And again on the way back, because what is worth saying is the moment it changed.
    expect(said.fresh('behind 3')).toBe(true);
  });

  it('speaks again after a clear, even for the same state', () => {
    const said = new SaidOnce();
    said.fresh('behind 3');
    said.clear();
    expect(said.fresh('behind 3')).toBe(true);
  });
});
