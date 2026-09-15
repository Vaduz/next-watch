import { describe, expect, it } from 'bun:test';
import { actionLabel, helpLines, parseWatchCommand, shortcutVerb, verbHint, verbLabel, HELP_WIDTH } from './verbs.js';
import { watchTargets } from './targets.js';
import { displayWidth } from '../term/textWidth.js';
import type { WatchTarget } from '../watchTargets.js';
import type { WatchPanel } from '../types.js';

const NOW = Date.parse('2026-08-21T10:42:07Z');

/** Which verbs a target has is decided from its state in `targets.ts`, so real targets are
 *  built here and read back. `targets.test.ts` has the same fixture: each child is meant to be
 *  readable on its own. */
function panel(over: Partial<WatchPanel> = {}): WatchPanel {
  return {
    nowMs: NOW,
    startedAtMs: NOW - 60_000,
    repo: { root: '/home/x/site', branch: 'main', head: 'a'.repeat(40), behind: 0 },
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
        uptimeSeconds: 10,
        logFiles: [],
      },
      { server: 'admin', state: 'down', url: ':4321', mode: null, owner: null, uptimeSeconds: null, logFiles: [] },
    ],
    tasks: [
      {
        id: 'ec58774e',
        label: 'build:site',
        pid: 4001,
        state: 'running',
        elapsedSeconds: 90,
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
    events: [],
    access: { admin: { file: null, rows: [] }, web: { file: null, rows: [] } },
    quotas: [],
    sessions: [
      {
        pid: 111,
        agent: 'claude',
        name: 'other',
        tree: 'site-2',
        status: 'busy',
        model: 'opus-5',
        contextTokens: 1,
        idleSeconds: 1,
        statusAtMs: NOW,
        version: '2.1.236',
        pane: '%3',
        resume: 'claude --resume 50b3c80e-859e-4bdb-9de4-f3cce3d9f3d9',
      },
      {
        pid: 222,
        agent: 'claude',
        name: 'mine',
        tree: 'site',
        status: 'idle',
        model: 'opus-5',
        contextTokens: 1,
        idleSeconds: 1,
        statusAtMs: NOW,
        version: '2.1.236',
        self: true,
      },
    ],
    services: [
      {
        name: 'Claude',
        pageUrl: 'https://status.claude.com',
        indicator: 'none',
        description: 'ok',
        degraded: [],
        error: null,
      },
    ],
    versions: [
      { name: 'claude', version: '2.1.236', error: null, latest: '2.1.236', latestError: null },
      { name: 'codex', version: null, error: 'not found', latest: null, latestError: null },
    ],
    ...over,
  };
}

const find = (targets: readonly WatchTarget[], key: string): WatchTarget => {
  const hit = targets.find(t => t.key === key);
  if (hit === undefined) throw new Error(`no target ${key}`);
  return hit;
};

describe('parseWatchCommand', () => {
  const targets = watchTargets(panel());
  const web = find(targets, 'server:web');

  it('passes a verb the target has straight through, ignoring case and surrounding space', () => {
    expect(parseWatchCommand('  Restart ', web)).toEqual({ kind: 'run', target: web, verb: 'restart' });
  });

  it('accepts quit and help anywhere, including with nothing selected', () => {
    expect(parseWatchCommand('quit', null).kind).toBe('quit');
    expect(parseWatchCommand('q', web).kind).toBe('quit');
    expect(parseWatchCommand('help', null).kind).toBe('help');
  });

  it('does nothing on an empty line', () => {
    expect(parseWatchCommand('   ', web).kind).toBe('none');
  });

  it('says to press Tab first when nothing is selected', () => {
    const parsed = parseWatchCommand('restart', null);
    expect(parsed.kind).toBe('error');
    if (parsed.kind === 'error') expect(parsed.message).toContain('Tab');
  });

  it('refuses a verb the target does not have, listing the ones it does', () => {
    const parsed = parseWatchCommand('update', web);
    expect(parsed.kind).toBe('error');
    if (parsed.kind === 'error') expect(parsed.message).toContain('restart | stop');
  });

  it('refuses with the reason when the target has no verbs at all', () => {
    const parsed = parseWatchCommand('stop', find(targets, 'session:222'));
    expect(parsed.kind).toBe('error');
    if (parsed.kind === 'error') expect(parsed.message).toContain('this is the session running the watcher');
  });
});

describe('verbLabel / shortcutVerb', () => {
  const labels: { verb: string; want: string }[] = [
    { verb: 'restart', want: '(r)estart' },
    { verb: 'stop', want: '(s)top' },
    { verb: 'kill', want: '(k)ill' },
    { verb: 'open', want: '(o)pen' },
    { verb: 'update', want: '(u)pdate' },
    { verb: 'add', want: '(a)dd' },
    { verb: 'help', want: '(h)elp' },
    { verb: 'quit', want: '(q)uit' },
  ];
  for (const c of labels) {
    it(`shows ${c.verb} as ${c.want}`, () => {
      expect(verbLabel(c.verb)).toBe(c.want);
    });
  }

  it('takes an interior letter for start, because stop already has the first one', () => {
    expect(verbLabel('start')).toBe('st(a)rt');
  });

  it('leaves a verb with no shortcut alone', () => {
    expect(verbLabel('frobnicate')).toBe('frobnicate');
  });

  it('resolves a keypress against the verbs that target actually has', () => {
    const targets = watchTargets(panel());
    expect(shortcutVerb(find(targets, 'server:web'), 'r')).toBe('restart');
    expect(shortcutVerb(find(targets, 'server:web'), 's')).toBe('stop');
    expect(shortcutVerb(find(targets, 'server:admin'), 'a')).toBe('start');
    expect(shortcutVerb(find(targets, 'task:ec58774e'), 'k')).toBe('kill');
    expect(shortcutVerb(find(targets, 'service:Claude'), 'o')).toBe('open');
    expect(shortcutVerb(find(targets, 'tool:claude'), 'u')).toBe('update');
    expect(shortcutVerb(find(targets, 'pane:event'), 'f')).toBe('focus');
  });

  it('is case-insensitive', () => {
    expect(shortcutVerb(find(watchTargets(panel()), 'tool:claude'), 'U')).toBe('update');
  });

  it('does not resolve a letter to a verb the target lacks (s on a stopped server is not stop)', () => {
    const admin = find(watchTargets(panel()), 'server:admin');
    expect(shortcutVerb(admin, 's')).toBeNull();
    expect(shortcutVerb(admin, 'r')).toBeNull();
  });

  it('answers help and quit with nothing selected', () => {
    expect(shortcutVerb(null, 'h')).toBe('help');
    expect(shortcutVerb(null, 'q')).toBe('quit');
  });

  it('returns null for anything else, which falls through to the command line', () => {
    expect(shortcutVerb(find(watchTargets(panel()), 'server:web'), 'z')).toBeNull();
  });
});

describe('verbHint', () => {
  it('shows the key bindings when nothing is selected', () => {
    expect(verbHint(null)).toContain('Tab');
    expect(verbHint(null)).toContain('(q)uit');
  });

  it('lists the verbs with their shortcuts when something is', () => {
    expect(verbHint(find(watchTargets(panel()), 'server:web'))).toBe('server:web  (r)estart | (s)top');
  });

  it('offers focus on a pane', () => {
    expect(verbHint(find(watchTargets(panel()), 'pane:event'))).toBe('pane:event  (f)ocus');
  });

  it('shows the reason when there is nothing to do', () => {
    expect(verbHint(find(watchTargets(panel()), 'session:222'))).toContain('this is the session running the watcher');
  });
});

describe('helpLines', () => {
  it('covers the key bindings and the verbs each kind has', () => {
    const text = helpLines().join('\n');
    for (const word of ['Tab', '(r)estart', '(k)ill', '(o)pen', '(u)pdate', '(q)uit']) expect(text).toContain(word);
  });

  // ⚠️ The rule that has to survive the next rewording. These lines are printed inside the
  // frame, where anything longer wraps and costs a row; in `--help`, where yargs indents them
  // by two; and in the README, which GitHub scrolls sideways past about ninety columns. The
  // table is one row per line so a failure names the line that grew.
  describe(`every line fits in ${HELP_WIDTH} columns`, () => {
    for (const [at, line] of helpLines().entries()) {
      it(`line ${at + 1}: ${line.slice(0, 32)}...`, () => {
        // Counted as the terminal counts it: `·` is three bytes and one column.
        expect(displayWidth(line)).toBeLessThanOrEqual(HELP_WIDTH);
      });
    }
  });

  // The `--help` epilogue indents every line by two, so the widest line plus that indent is
  // what a person with an 80-column terminal actually sees.
  it('still fits once --help has indented it', () => {
    const widest = Math.max(...helpLines().map(displayWidth));

    expect(widest + 2).toBeLessThanOrEqual(HELP_WIDTH);
  });

  it('says nothing twice, so a split line is a continuation and not a repeat', () => {
    const lines = helpLines();

    expect(new Set(lines).size).toBe(lines.length);
  });
});

describe('actionLabel', () => {
  it('drops the kind prefix and reads as verb plus name', () => {
    expect(actionLabel({ key: 'server:admin', kind: 'server', id: 'admin', verbs: ['restart'] }, 'restart')).toBe(
      'restart admin',
    );
  });

  it('drops only the first prefix when the key holds another colon', () => {
    expect(actionLabel({ key: 'session:claude:4321', kind: 'session', id: '4321', verbs: ['stop'] }, 'stop')).toBe(
      'stop claude:4321',
    );
  });
});
