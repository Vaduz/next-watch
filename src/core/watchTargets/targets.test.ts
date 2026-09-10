import { describe, expect, it } from 'bun:test';
import { resolveSelection, stepSelection, tabTargets, watchTargets } from './targets.js';
import { shortcutVerb } from './verbs.js';
import type { WatchTarget } from '../watchTargets.js';
import type { WatchPanel } from '../types.js';

const NOW = Date.parse('2026-08-21T10:42:07Z');

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

describe('watchTargets', () => {
  it('is ordered the way the screen is (servers, tasks, sessions, services, CLIs, panes)', () => {
    expect(watchTargets(panel({ ssh: { state: 'empty', keys: 0, error: null } })).map(t => t.key)).toEqual([
      'ssh:agent',
      'server:web',
      'server:admin',
      'task:ec58774e',
      'task:426d18c4',
      'session:111',
      'session:222',
      'service:Claude',
      'tool:claude',
      'tool:codex',
      'pane:event',
      'pane:admin',
      'pane:web',
    ]);
  });

  // The panes come from the panel, not from a constant, so a repository with a different
  // number of servers gets a different number of panes.
  it('has one pane per server plus the event log, however many servers there are', () => {
    const one = watchTargets(panel({ access: { web: { file: null, rows: [] } } }));
    expect(one.filter(t => t.kind === 'pane').map(t => t.id)).toEqual(['event', 'web']);

    const three = watchTargets(
      panel({
        access: {
          web: { file: null, rows: [] },
          admin: { file: null, rows: [] },
          docs: { file: null, rows: [] },
        },
      }),
    );
    expect(three.filter(t => t.kind === 'pane').map(t => t.id)).toEqual(['event', 'web', 'admin', 'docs']);
  });

  it('offers no pane but the event log when no server has an access pane', () => {
    expect(
      watchTargets(panel({ access: {} }))
        .filter(t => t.kind === 'pane')
        .map(t => t.id),
    ).toEqual(['event']);
  });

  it('offers ssh (a)dd only while the agent has no key', () => {
    const withCard = (ssh: WatchPanel['ssh']): WatchTarget => find(watchTargets(panel({ ssh })), 'ssh:agent');
    expect(withCard({ state: 'empty', keys: 0, error: null }).verbs).toEqual(['add']);
    // With a key loaded there is nothing to do; with no agent there is nowhere to add one.
    expect(withCard({ state: 'loaded', keys: 2, error: null }).verbs).toEqual([]);
    expect(withCard({ state: 'loaded', keys: 2, error: null }).note).toBe('2 key(s) loaded');
    expect(withCard({ state: 'no-agent', keys: 0, error: 'no agent' }).verbs).toEqual([]);
    expect(withCard({ state: 'no-agent', keys: 0, error: 'no agent' }).note).toBe('no agent');
  });

  it('omits the ssh row entirely when the agent has not been read', () => {
    expect(watchTargets(panel()).some(t => t.key === 'ssh:agent')).toBe(false);
  });

  it('never puts start on the ssh target, because it would clash with add', () => {
    const target = find(watchTargets(panel({ ssh: { state: 'empty', keys: 0, error: null } })), 'ssh:agent');
    expect(target.verbs).not.toContain('start');
    expect(shortcutVerb(target, 'a')).toBe('add');
  });

  it('offers a server only what its state allows, so a stopped server has no stop', () => {
    const targets = watchTargets(panel());
    expect(find(targets, 'server:web').verbs).toEqual(['restart', 'stop']);
    expect(find(targets, 'server:admin').verbs).toEqual(['start']);
  });

  it('cannot stop a finished task, and says why on the spot', () => {
    const targets = watchTargets(panel());
    expect(find(targets, 'task:ec58774e').verbs).toEqual(['kill', 'stop']);
    expect(find(targets, 'task:426d18c4').verbs).toEqual([]);
    expect(find(targets, 'task:426d18c4').note).toBe('already failed');
  });

  it('cannot stop its own session, which would take the watcher with it', () => {
    const targets = watchTargets(panel());
    expect(find(targets, 'session:111').verbs).toEqual(['restart', 'stop']);
    expect(find(targets, 'session:222').verbs).toEqual([]);
  });

  it('cannot restart a session outside tmux, because there is nowhere to type', () => {
    const sessions = (panel().sessions ?? []).map(s => (s.pid === 111 ? { ...s, pane: null } : s));
    expect(find(watchTargets(panel({ sessions })), 'session:111').verbs).toEqual(['stop']);
  });

  it('cannot restart a session with no resume command, because it could not come back', () => {
    const sessions = (panel().sessions ?? []).map(s => (s.pid === 111 ? { ...s, resume: null } : s));
    expect(find(watchTargets(panel({ sessions })), 'session:111').verbs).toEqual(['stop']);
  });

  it('carries the resume line on the target that will use it', () => {
    const target = find(watchTargets(panel()), 'session:111');
    expect(target.resume).toBe('claude --resume 50b3c80e-859e-4bdb-9de4-f3cce3d9f3d9');
    expect(shortcutVerb(target, 'r')).toBe('restart');
  });

  it('cannot update a CLI that is not installed', () => {
    const targets = watchTargets(panel());
    expect(find(targets, 'tool:claude').verbs).toEqual(['update']);
    expect(find(targets, 'tool:codex').verbs).toEqual([]);
  });

  it('points a service at its human-readable page, not at the summary JSON', () => {
    expect(find(watchTargets(panel()), 'service:Claude').url).toBe('https://status.claude.com');
  });

  it('carries the signal target along', () => {
    expect(find(watchTargets(panel()), 'task:ec58774e').pid).toBe(4001);
    expect(find(watchTargets(panel()), 'session:111').pid).toBe(111);
    expect(find(watchTargets(panel()), 'session:111').pane).toBe('%3');
  });
});

describe('stepSelection', () => {
  const targets = watchTargets(panel());

  it('enters from whichever end matches the direction when nothing is selected', () => {
    expect(stepSelection(targets, null, 0, 1).key).toBe('server:web');
    expect(stepSelection(targets, null, 0, -1).key).toBe('pane:web');
  });

  it('moves forward on Tab and back on Shift-Tab', () => {
    expect(stepSelection(targets, 'server:web', 0, 1).key).toBe('server:admin');
    expect(stepSelection(targets, 'server:admin', 1, -1).key).toBe('server:web');
  });

  it('wraps at the ends, so a held key never does nothing', () => {
    expect(stepSelection(targets, 'pane:web', targets.length - 1, 1).key).toBe('server:web');
    expect(stepSelection(targets, 'server:web', 0, -1).key).toBe('pane:web');
  });

  it('selects nothing when there is nothing to select', () => {
    expect(stepSelection([], null, 0, 1)).toEqual({ key: null, index: 0 });
  });
});

describe('resolveSelection', () => {
  const targets = watchTargets(panel());

  it('keeps pointing at the same thing while it exists, whatever moved around it', () => {
    expect(resolveSelection(targets, 'session:111', 0).key).toBe('session:111');
  });

  it('moves to whatever is at the same position when the selection disappears', () => {
    const gone = watchTargets(panel({ sessions: [] }));
    // It was at index 4 (session:111). With the sessions gone, the service is there instead.
    expect(resolveSelection(gone, 'session:111', 4).key).toBe('service:Claude');
  });

  it('clamps a position past the end back to the end', () => {
    expect(resolveSelection(targets, 'task:gone', 999).key).toBe('pane:web');
  });
});

describe('tabTargets', () => {
  const all = watchTargets(panel());

  it('reaches everything normally', () => {
    expect(tabTargets(all, null)).toHaveLength(all.length);
  });

  it('reaches only the panes while one fills the frame, so nothing off screen can be acted on', () => {
    expect(tabTargets(all, 'web').map(t => t.key)).toEqual(['pane:event', 'pane:admin', 'pane:web']);
  });
});
