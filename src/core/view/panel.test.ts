// Checked by assembling one panel. How the sections (blocks, lines) and the panes look is
// checked here too, because the only place they appear is inside this one screen.
import { describe, expect, it } from 'bun:test';
import { type AgentSessionRow, type WatchEvent, type WatchPanel } from '../types.js';
import { painter, type Paint } from '../term/index.js';
import { displayWidth } from '../term/index.js';
import { clockWithOffset, type PaneBudget, type PaneName, type WatchLayout, type WatchView } from './index.js';
import { scrollMaxOf, watchLayout } from './layout.js';
import { renderWatchPanel, watchPaneBudget, watchPaneEntries } from './panel.js';

const plain = painter(false);
/** A 120-column terminal, so a 118-wide frame. */
const LAYOUT = watchLayout(120);
/** 2026-08-19 19:42:07 at UTC+9, which is the offset these expectations are written for. */
const NOW = Date.parse('2026-08-19T10:42:07Z');
const CLOCK = clockWithOffset(9 * 60);

/** The three entry points, with the clock supplied. The core takes a clock rather than picking
 *  a time zone, and every expectation below is written for +9. */
const renderPanel = (p: WatchPanel, paint: Paint, layout: WatchLayout, view?: WatchView): string[] =>
  renderWatchPanel(p, paint, layout, CLOCK, view);
const paneEntries = (p: WatchPanel, paint: Paint, layout: WatchLayout, view?: WatchView): PaneBudget =>
  watchPaneEntries(p, paint, layout, CLOCK, view);
const paneBudgetOf = (p: WatchPanel, paint: Paint, layout: WatchLayout, focus?: PaneName | null): PaneBudget =>
  watchPaneBudget(p, paint, layout, CLOCK, focus);

/** The fixture's sessions. The panel type allows null (nobody reading them), which this
 *  fixture never is. */
const fixtureSessions = (): readonly AgentSessionRow[] => panel().sessions ?? [];

function panel(overrides: Partial<WatchPanel> = {}): WatchPanel {
  return {
    nowMs: NOW,
    startedAtMs: NOW - 4_320_000,
    repo: { root: '/home/vaduz/Code/site', branch: 'main', head: 'a1b2c3d4eeee', behind: 0 },
    lastPull: { atMs: NOW - 660_000, commits: 4 },
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
        logFiles: ['/tmp/watch-tasks/dev-web/log.txt'],
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
      {
        id: '426d18c4',
        label: 'test:e2e',
        pid: 4002,
        state: 'failed',
        elapsedSeconds: 62,
        endedSecondsAgo: 300,
      },
    ],
    access: {
      admin: {
        file: '/tmp/watch-tasks/dev-admin/log.txt',
        rows: [{ atMs: null, method: null, target: 'Ready in 75ms', status: null, ms: null }],
      },
      web: {
        file: '/tmp/watch-tasks/dev-web/log.txt',
        rows: [
          { atMs: NOW - 60_000, method: 'GET', target: '/easy/', status: 200, ms: 741 },
          { atMs: NOW - 30_000, method: 'GET', target: '/missing/', status: 404, ms: 12 },
        ],
      },
    },
    events: [
      { atMs: NOW - 900_000, mark: 'change', text: 'pulled 4 commits' },
      { atMs: NOW - 880_000, mark: 'step', text: 'admin build ok 22.4s' },
      { atMs: NOW - 300_000, mark: 'warn', text: 'git fetch failed, still watching' },
    ],
    quotas: [
      {
        label: 'Claude',
        plan: 'Max 5x',
        windows: [{ name: '5h', usedPercent: 26, resetsAtMs: NOW + 3_600_000 }],
        error: null,
        fetchedAtMs: NOW - 90_000,
        stale: false,
      },
    ],
    sessions: [
      {
        pid: 3658196,
        agent: 'claude',
        statusAtMs: NOW - 3_000,
        name: 'fix the panel layout',
        tree: 'site-2',
        status: 'busy',
        model: 'opus-5',
        contextTokens: 305_000,
        idleSeconds: 3,
        version: '2.1.235',
        self: true,
      },
    ],
    services: [
      {
        name: 'Claude',
        pageUrl: 'https://status.claude.com',
        indicator: 'minor',
        description: 'Partially Degraded Service',
        degraded: ['claude.ai (degraded_performance)'],
        error: null,
      },
    ],
    versions: [
      { name: 'claude', version: '2.1.236', error: null, latest: '2.1.236', latestError: null },
      { name: 'codex', version: '0.147.0', error: null, latest: '0.148.0', latestError: null },
    ],
    ...overrides,
  };
}

describe('renderWatchPanel', () => {
  it('draws the frame across the terminal, not around the content', () => {
    const wide = watchLayout(160);
    const lines = renderPanel(panel(), plain, wide).filter(l => l.startsWith('╭') || l.startsWith('╰'));
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(displayWidth(line)).toBe(wide.width);
  });

  it('closes all four sides even on a narrow terminal', () => {
    const narrow = watchLayout(80);
    const lines = renderPanel(panel(), plain, narrow).filter(l => l.length > 0);
    for (const line of lines) expect(displayWidth(line)).toBe(narrow.width);
    expect(lines[0].endsWith('╮')).toBe(true);
    expect(lines[lines.length - 1].endsWith('╯')).toBe(true);
    expect(lines.filter(l => l.startsWith('│')).every(l => l.endsWith('│'))).toBe(true);
  });

  it('folds servers, quotas, sessions and services into one screen', () => {
    const text = renderPanel(panel(), plain, LAYOUT).join('\n');
    expect(text).toContain('next-watch  19:42:07  up 1h12m');
    expect(text).toContain('last pull 19:31:07');
    expect(text).toContain('http://localhost:3000');
    expect(text).toContain('Max 5x');
    expect(text).toContain('site-2');
    expect(text).toContain('305k');
    expect(text).toContain('Partially Degraded Service');
    expect(text).toContain('claude 2.1.236 · codex 0.147.0 (latest 0.148.0)');
  });

  // The order is the point: the name, then which next-watch it is, then the time. `versions`
  // in the body is other people's CLIs and stays where it is.
  it('puts its own version between the name and the clock', () => {
    const text = renderPanel(panel({ selfVersion: '0.1.4' }), plain, LAYOUT).join('\n');
    expect(text).toContain('next-watch 0.1.4  19:42:07  up 1h12m');
  });

  it('titles with the bare name when there is no version to show', () => {
    // Null is a package.json that could not be read; undefined is a host that builds its own
    // panel and never set the field. Neither may leave `next-watch null` on the heading.
    for (const selfVersion of [null, undefined]) {
      const text = renderPanel(panel({ selfVersion }), plain, LAYOUT).join('\n');
      expect(text).toContain('next-watch  19:42:07  up 1h12m');
    }
  });

  it('shows the running tasks and the recently finished ones', () => {
    const text = renderPanel(panel(), plain, LAYOUT).join('\n');
    expect(text).toContain('build:site --limit 3');
    expect(text).toContain('running');
    expect(text).toContain('failed');
    expect(text).toContain('5m ago');
  });

  it('omits the task section entirely when there are none', () => {
    const text = renderPanel(panel({ tasks: [] }), plain, LAYOUT).join('\n');
    expect(text).not.toContain('COMMAND');
  });

  it('keeps a row for a stopped server, rather than saying down by absence', () => {
    const lines = renderPanel(panel(), plain, LAYOUT);
    expect(lines.some(l => l.includes('admin') && l.includes('down'))).toBe(true);
  });

  it('puts the provider and plan on a heading row and indents the windows by two', () => {
    const lines = renderPanel(panel(), plain, LAYOUT).map(l => l.replace(/^│ /, '').replace(/│$/, '').trimEnd());
    const at = lines.findIndex(l => l.startsWith('Claude'));
    expect(lines[at]).toBe('Claude  Max 5x');
    expect(lines[at + 1]).toMatch(/^ {2}5h {2,}26%/);
  });

  it('keeps the row of a backend whose quota could not be read', () => {
    const cards = [
      { label: 'Codex', plan: null, windows: [], error: 'cannot start codex', fetchedAtMs: null, stale: false },
    ];
    expect(renderPanel(panel({ quotas: cards }), plain, LAYOUT).join('\n')).toContain('cannot start codex');
  });

  it('never truncates a session title, putting the metadata on the next row', () => {
    const long = 'add a --watch option to dev:start, then start the watcher once the server is up';
    const p = panel({ sessions: [{ ...fixtureSessions()[0], name: long }] });
    const lines = renderPanel(p, plain, LAYOUT);
    const at = lines.findIndex(l => l.includes('add a --watch option'));
    expect(
      lines
        .slice(at, at + 2)
        .join('')
        .replace(/[│\s]/g, ''),
    ).toContain(long.replace(/\s/g, ''));
    // No metadata on the title row; it goes on the next one.
    expect(lines[at]).not.toContain('claude');
    expect(lines.slice(at, at + 3).join('\n')).toContain('site-2');
  });

  it('never truncates a task command either', () => {
    const long = 'build:site --limit 12 --verbose --from 2026-08-01 --to 2026-08-23';
    const p = panel({ tasks: [{ ...panel().tasks[0], label: long }] });
    const lines = renderPanel(p, plain, LAYOUT);
    const at = lines.findIndex(l => l.includes('build:site'));
    expect(
      lines
        .slice(at, at + 2)
        .join('')
        .replace(/[│\s]/g, ''),
    ).toContain(long.replace(/\s/g, ''));
    // No metadata on the command row; it goes on the next one.
    expect(lines[at]).not.toContain('running');
    expect(lines[at + 1]).toContain('ec58774e');
    expect(lines[at + 1]).toContain('12:20');
  });

  it('puts a task cursor at the left edge of its command row', () => {
    const scroll = { event: 0, admin: 0, web: 0 };
    const lines = renderPanel(panel(), plain, LAYOUT, { selected: 'task:ec58774e', scroll });
    const at = lines.findIndex(l => l.includes('build:site'));
    expect(lines[at]).toContain('› build:site');
    // Not on the metadata row: one cursor per entry.
    expect(lines[at + 1]).not.toContain('›');
  });

  it('says so when there are no live sessions', () => {
    expect(renderPanel(panel({ sessions: [] }), plain, LAYOUT).join('\n')).toContain('no live AI sessions');
  });

  it('puts the countdown on the repository row rather than the bottom line', () => {
    const lines = renderPanel(panel(), plain, LAYOUT);
    const repo = lines.find(l => l.includes('last pull')) ?? '';
    expect(repo).toContain('next git check 42s');
  });

  it('shows no countdown when there is no next check', () => {
    const text = renderPanel(panel({ nextCheckSeconds: null }), plain, LAYOUT).join('\n');
    expect(text).not.toContain('next git check');
  });

  it('says how many commits are waiting to come in', () => {
    const p = panel({ repo: { root: '/x', branch: 'main', head: 'abcdef1234', behind: 3 } });
    expect(renderPanel(p, plain, LAYOUT).join('\n')).toContain('3 commit(s) behind origin/main');
  });
});

describe('colour by state', () => {
  const colored = painter(true);
  const RED = '\u001b[31m';
  const CRIT = '\u001b[1;31m';
  const YELLOW = '\u001b[33m';
  const DIM = '\u001b[2m';
  const line = (needle: string, layout = LAYOUT): string =>
    renderPanel(panel(), colored, layout).find(l => l.includes(needle)) ?? '';

  it('colours a failed task red across the row', () => {
    expect(line('test:e2e')).toContain(RED);
  });

  it('leaves a running task uncoloured, so only the exceptions stand out', () => {
    const running = line('build:site');
    expect(running).not.toContain(RED);
    expect(running).not.toContain(YELLOW);
  });

  it('dims the row of a stopped server', () => {
    expect(line('down')).toContain(DIM);
  });

  it('turns a quota past ninety per cent bold red across the row', () => {
    const p = panel({
      quotas: [
        {
          label: 'Codex',
          plan: 'Plus',
          windows: [{ name: '5h', usedPercent: 94, resetsAtMs: NOW + 600_000 }],
          error: null,
          fetchedAtMs: NOW,
          stale: false,
        },
      ],
    });
    const row = renderPanel(p, colored, LAYOUT).find(l => l.includes('94%')) ?? '';
    expect(row).toContain(CRIT);
  });

  it('does not spread colour to the reset time of a quota with room left', () => {
    const row = renderPanel(panel(), colored, LAYOUT).find(l => l.includes('26%')) ?? '';
    expect(row).not.toContain(RED);
    expect(row).not.toContain(YELLOW);
  });

  it('makes a degraded service stand out across the row', () => {
    expect(line('Partially Degraded Service')).toContain(YELLOW);
  });

  it('leaves no control characters anywhere with colour off', () => {
    for (const l of renderPanel(panel(), plain, LAYOUT)) expect(l).not.toContain('\u001b');
  });
});

describe('the panel height', () => {
  /** A screen loaded with things that wrap: long titles, long commands, long events. */
  const crowded = (): WatchPanel =>
    panel({
      tasks: [
        { ...panel().tasks[0], label: 'build:site --limit 12 --verbose --from 2026-08-01 --dry-run' },
        { ...panel().tasks[1], label: 'test:e2e --grade 3 --limit 8 --verbose --retry 2 --dry-run' },
      ],
      sessions: [
        { ...fixtureSessions()[0], name: 'fix the screen flickering when the panel does not fit the terminal height' },
      ],
      events: Array.from({ length: 30 }, (_, i) => ({
        atMs: NOW - i * 1000,
        mark: 'step' as const,
        text: `${i}: ${'an event body just long enough '.repeat(3)}`,
      })),
    });

  // Not fitting means every redraw scrolls by a screen, which reads as flicker.
  for (const [columns, rows] of [
    [80, 24],
    [100, 30],
    [120, 40],
    [200, 60],
  ] as const) {
    it(`fits a ${columns}x${rows} terminal, counting what wraps`, () => {
      const layout = watchLayout(columns, rows - 1);
      const lines = renderPanel(crowded(), plain, layout);
      expect(lines.length).toBeLessThanOrEqual(layout.height);
      // No row exceeds the width, so nothing wraps further and adds rows.
      for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(layout.width);
    });
  }

  it('grows the event pane into spare height rather than leaving it blank', () => {
    const layout = watchLayout(120, 39);
    const lines = renderPanel(crowded(), plain, layout);
    expect(lines.length).toBeGreaterThanOrEqual(layout.height - 1);
  });
});

describe('the panes', () => {
  it('flows the recent events with the newest at the bottom', () => {
    const lines = renderPanel(panel(), plain, watchLayout(120, 40, 2, 0));
    const log = lines.slice(lines.findIndex(l => l.includes('event log')) + 1, -2);
    expect(log).toHaveLength(2);
    expect(log[0]).toContain('admin build ok');
    expect(log[1]).toContain('git fetch failed');
  });

  it('gives each server its own access section', () => {
    const text = renderPanel(panel(), plain, watchLayout(120, 40)).join('\n');
    expect(text).toContain('admin access');
    expect(text).toContain('web access');
    // The URL, whose length is unbounded, is the last column.
    expect(text).toContain('GET  200  741ms  /easy/');
    expect(text).toContain('404');
  });

  it('names the file each section is reading in its heading', () => {
    const text = renderPanel(panel(), plain, watchLayout(160, 40)).join('\n');
    expect(text).toContain('admin access  /tmp/watch-tasks/dev-admin/log.txt');
    expect(text).toContain('web access  /tmp/watch-tasks/dev-web/log.txt');
  });

  it('leads an access row with when it was seen, blank when unknown', () => {
    const lines = renderPanel(panel(), plain, watchLayout(160, 40));
    const web = lines.find(l => l.includes('/easy/')) ?? '';
    expect(web).toContain('19:41:07');
    const admin = lines.find(l => l.includes('Ready in 75ms')) ?? '';
    expect(admin).not.toMatch(/\d\d:\d\d:\d\d/);
  });

  it('falls back to the raw log for a server with no access rows', () => {
    expect(renderPanel(panel(), plain, watchLayout(120, 40)).join('\n')).toContain('Ready in 75ms');
  });

  it('omits a pane and its divider when it holds nothing', () => {
    const empty = panel({ events: [], access: { admin: { file: null, rows: [] }, web: { file: null, rows: [] } } });
    const lines = renderPanel(empty, plain, watchLayout(120, 40));
    expect(lines.some(l => l.startsWith('├'))).toBe(false);
  });

  it('can still reach the older wrapped events, counting entries not rows', () => {
    const long = (i: number): WatchEvent => ({
      atMs: NOW - i * 1000,
      mark: 'warn',
      text: `#${i} ${'x'.repeat(240)}`,
    });
    const events = [long(5), long(4), long(3), long(2), long(1), long(0)];
    const layout = watchLayout(120, 40);
    const shown = paneEntries(panel({ events }), plain, layout);
    expect(shown.event).toBeGreaterThan(0);
    expect(shown.event).toBeLessThan(events.length);
    // A scroll limit of zero would put the off-screen events out of reach.
    expect(scrollMaxOf(events.length, shown.event)).toBeGreaterThan(0);
    const back = renderPanel(panel({ events }), plain, layout, {
      selected: null,
      scroll: { event: events.length - 1, admin: 0, web: 0 },
      focus: null,
    }).join('\n');
    expect(back).toContain('#5');
  });

  it('fits the whole panel in the terminal height', () => {
    const lines = renderPanel(panel(), plain, watchLayout(120, 40));
    expect(lines.length).toBeLessThanOrEqual(40);
  });

  it('does not overflow a short terminal, so a redraw does not scroll', () => {
    for (const rows of [12, 18, 24, 30]) {
      expect(renderPanel(panel(), plain, watchLayout(120, rows)).length).toBeLessThanOrEqual(rows);
    }
  });

  it('wraps a long event instead of cutting its tail off', () => {
    const text = `git fetch failed: ${'x'.repeat(300)} END`;
    const lines = renderPanel(panel({ events: [{ atMs: NOW, mark: 'warn', text }] }), plain, watchLayout(120, 40));
    const log = lines.slice(lines.findIndex(l => l.includes('event log')) + 1);
    expect(log.join('').replace(/[│\s]/g, '')).toContain('xEND');
    expect(log.join('\n')).not.toContain('…');
  });

  it('still fits the height once events wrap', () => {
    const text = `git fetch failed: ${'x'.repeat(300)}`;
    const events = Array.from({ length: 6 }, (_, i) => ({ atMs: NOW - i * 1000, mark: 'warn' as const, text }));
    for (const rows of [12, 18, 24, 30, 40]) {
      expect(renderPanel(panel({ events }), plain, watchLayout(120, rows)).length).toBeLessThanOrEqual(rows);
    }
  });

  it('closes wrapped rows at the right border too', () => {
    const text = `git fetch failed: ${'x'.repeat(300)}`;
    const wide = watchLayout(120, 40);
    const lines = renderPanel(panel({ events: [{ atMs: NOW, mark: 'warn', text }] }), plain, wide).filter(
      l => l.length > 0,
    );
    for (const l of lines) expect(displayWidth(l)).toBe(wide.width);
  });
});

describe('the ELAPSED column', () => {
  it('keeps the seconds, without which a ninety-second step looks stalled', () => {
    const text = renderPanel(panel(), plain, LAYOUT).join('\n');
    // 740 seconds is 12:20; 62 seconds is 1:02.
    expect(text).toContain('12:20');
    expect(text).toContain('1:02');
  });
});

describe('the cursor', () => {
  const lineWith = (p: WatchPanel, view: { selected: string | null }, needle: string): string => {
    const scroll = { event: 0, admin: 0, web: 0 };
    const hit = renderPanel(p, plain, LAYOUT, { ...view, scroll }).find(l => l.includes(needle));
    return hit ?? '';
  };

  it('shows no cursor when nothing is selected', () => {
    expect(renderPanel(panel(), plain, LAYOUT).join('\n')).not.toContain('›');
  });

  it('puts the cursor only at the left edge of the selected row', () => {
    const p = panel();
    expect(lineWith(p, { selected: 'server:web' }, 'localhost:3000')).toContain('›');
    expect(lineWith(p, { selected: 'server:web' }, ':4321')).not.toContain('›');
  });

  it('selects tasks, sessions and services the same way', () => {
    const p = panel();
    expect(lineWith(p, { selected: 'task:ec58774e' }, 'build:site')).toContain('›');
    expect(lineWith(p, { selected: 'session:3658196' }, 'fix the panel layout')).toContain('›');
    expect(lineWith(p, { selected: 'service:Claude' }, 'Partially Degraded')).toContain('›');
  });

  it('puts ssh-agent on one row beside the repository, cursor before the text', () => {
    const p = panel({ ssh: { state: 'empty', keys: 0, error: null } });
    expect(lineWith(p, { selected: null }, 'SSH')).toContain('no key loaded');
    expect(lineWith(p, { selected: 'ssh:agent' }, 'SSH')).toContain('›ssh-agent');
  });

  it('omits the SSH row when the agent has not been read', () => {
    expect(renderPanel(panel(), plain, LAYOUT).some(l => l.includes('SSH'))).toBe(false);
  });

  it('puts the cursor before a CLI name, that being a row and not a table', () => {
    expect(lineWith(panel(), { selected: 'tool:codex' }, 'TOOL')).toContain('›codex');
  });

  it('shows a pane cursor in its heading', () => {
    // Tasks and sessions take two rows each, so use a height where the panes still appear.
    const lines = renderPanel(panel(), plain, watchLayout(120, 40), {
      selected: 'pane:event',
      scroll: { event: 0, admin: 0, web: 0 },
    });
    expect(lines.some(l => l.includes('› event log'))).toBe(true);
  });
});

describe('scrolling a log back', () => {
  const many = (n: number): WatchPanel =>
    panel({
      // Events are held oldest first; the pane draws from the end.
      events: Array.from({ length: n }, (_, i) => ({
        atMs: NOW - (n - i) * 1000,
        mark: 'info' as const,
        text: `line ${i}`,
      })),
    });

  it('shows older rows when scrolled back, and says so in the heading', () => {
    const p = many(60);
    const layout = watchLayout(120, 40, 5, 0);
    const top = renderPanel(p, plain, layout).join('\n');
    const back = renderPanel(p, plain, layout, {
      selected: null,
      scroll: { event: 10, admin: 0, web: 0 },
    }).join('\n');
    expect(top).toContain('line 59');
    expect(back).not.toContain('line 59');
    expect(back).toContain('line 49');
    expect(back).toContain('↑10');
  });

  it('adds nothing to the heading while not scrolled back', () => {
    expect(renderPanel(many(60), plain, watchLayout(120, 40, 5, 0)).join('\n')).not.toContain('↑');
  });
});

describe('the pane budget', () => {
  it('reports the rows actually drawn, never more than the pane holds', () => {
    const budget = paneBudgetOf(panel(), plain, watchLayout(120, 40));
    expect(budget.event).toBeLessThanOrEqual(panel().events.length);
    expect(budget.admin).toBeLessThanOrEqual(panel().access.admin.rows.length);
  });
});

describe('a pane filling the frame', () => {
  const many = (n: number): WatchPanel =>
    panel({
      events: Array.from({ length: n }, (_, i) => ({
        atMs: NOW - (n - i) * 1000,
        mark: 'info' as const,
        text: `line ${i}`,
      })),
    });

  const view = (focus: 'event' | 'admin' | 'web' | null): WatchView => ({
    selected: focus === null ? null : `pane:${focus}`,
    scroll: { event: 0, admin: 0, web: 0 },
    focus,
  });

  it('hides the body and the other panes, giving one pane the whole frame', () => {
    const text = renderPanel(many(60), plain, watchLayout(120, 40), view('event')).join('\n');
    expect(text).not.toContain('SERVER');
    expect(text).not.toContain('SESSION');
    expect(text).not.toContain('web access');
    expect(text).toContain('event log');
  });

  it('shows more rows once a pane fills the frame', () => {
    const p = many(60);
    const layout = watchLayout(120, 40);
    const count = (v: ReturnType<typeof view>): number =>
      renderPanel(p, plain, layout, v).filter(l => /line \d+/.test(l)).length;
    expect(count(view('event'))).toBeGreaterThan(count(view(null)));
  });

  it('says in the heading that it is focused and how to go back', () => {
    const lines = renderPanel(many(60), plain, watchLayout(120, 40), view('event'));
    expect(lines.some(l => l.includes('focused') && l.includes('Esc'))).toBe(true);
  });

  it('does not draw an empty frame for a focused pane with nothing in it', () => {
    const empty = panel({ access: { admin: { file: null, rows: [] }, web: { file: null, rows: [] } } });
    const text = renderPanel(empty, plain, watchLayout(120, 40), view('web')).join('\n');
    expect(text).toContain('nothing here yet');
  });

  it('keeps all four sides aligned while focused', () => {
    const narrow = watchLayout(80, 30);
    const lines = renderPanel(many(60), plain, narrow, view('event')).filter(l => l.length > 0);
    for (const line of lines) expect(displayWidth(line)).toBe(narrow.width);
  });
});

// The optional sections belong to providers a host switches on. With one off, nothing reads it,
// and the screen must show **no trace of it** — not a heading with nothing under it, and not a
// row saying there is none. Otherwise a watcher that was never asked to look at agent sessions
// would say "no live AI sessions" for as long as it ran.
describe('sections nobody is reading', () => {
  const off = (): WatchPanel => panel({ quotas: [], sessions: null, services: [], versions: [], ssh: null });

  it('draws none of them', () => {
    const text = renderPanel(off(), plain, LAYOUT).join('\n');

    for (const heading of ['SESSION', 'SERVICE', 'TOOL', 'SSH', 'Claude', 'Codex']) {
      expect(text).not.toContain(heading);
    }
  });

  it('still draws the sections that are being read', () => {
    const text = renderPanel(off(), plain, LAYOUT).join('\n');

    expect(text).toContain('SERVER');
    expect(text).toContain('TASK');
  });

  it('says so when the sessions were read and there were none', () => {
    const text = renderPanel(panel({ sessions: [] }), plain, LAYOUT).join('\n');

    expect(text).toContain('no live AI sessions');
  });
});
