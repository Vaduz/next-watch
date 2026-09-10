import { describe, expect, it } from 'bun:test';
import { diffLocalSnapshot, stampEvent, sshAgentEvents, toolVersionEvents, type LocalSnapshot } from './watchEvents.js';
import type { AgentSessionRow, TaskRow, ToolVersionRow, WatchServerRow } from './types.js';

function task(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'ec58774e',
    label: 'build:site --limit 3',
    pid: 4001,
    state: 'running',
    elapsedSeconds: 60,
    endedSecondsAgo: null,
    ...over,
  };
}

function session(over: Partial<AgentSessionRow> = {}): AgentSessionRow {
  return {
    pid: 3658196,
    agent: 'claude',
    name: 'fix the panel layout',
    tree: 'site-2',
    status: 'idle',
    model: 'opus-5',
    contextTokens: 305_000,
    idleSeconds: 30,
    statusAtMs: 1_000,
    version: '2.1.236',
    ...over,
  };
}

const snap = (over: Partial<LocalSnapshot> = {}): LocalSnapshot => ({
  servers: [],
  tasks: [],
  sessions: [],
  ...over,
});

function server(over: Partial<WatchServerRow> = {}): WatchServerRow {
  return {
    server: 'admin',
    state: 'up',
    url: 'http://localhost:4321',
    mode: 'prod',
    owner: 'user',
    uptimeSeconds: 60,
    logFiles: [],
    ...over,
  };
}

describe('diffLocalSnapshot (servers)', () => {
  it('reports a server going down', () => {
    const events = diffLocalSnapshot(
      snap({ servers: [server()] }),
      snap({ servers: [server({ state: 'down', url: ':4321', mode: null, owner: null, uptimeSeconds: null })] }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.text).toContain('admin is down');
  });

  it('reports a server coming up with its URL and mode', () => {
    const events = diffLocalSnapshot(snap({ servers: [server({ state: 'down' })] }), snap({ servers: [server()] }));
    expect(events[0]?.text).toContain('admin is up at http://localhost:4321 (prod)');
    expect(events[0]?.tone).toBe('ok');
  });

  it('says nothing while the state holds, even though uptime moves every tick', () => {
    const before = snap({ servers: [server()] });
    expect(diffLocalSnapshot(before, snap({ servers: [server({ uptimeSeconds: 61 })] }))).toEqual([]);
  });
});

describe('diffLocalSnapshot', () => {
  it('says nothing on the first tick, or everything already there would read as started', () => {
    expect(diffLocalSnapshot(null, snap({ tasks: [task()], sessions: [session()] }))).toEqual([]);
  });

  it('says nothing when nothing changed', () => {
    const s = snap({ tasks: [task()], sessions: [session()] });
    expect(diffLocalSnapshot(s, s)).toEqual([]);
  });

  it('reports a task starting', () => {
    const events = diffLocalSnapshot(snap(), snap({ tasks: [task()] }));
    expect(events).toHaveLength(1);
    expect(events[0]?.mark).toBe('task');
    expect(events[0]?.text).toContain('task started');
    expect(events[0]?.text).toContain('build:site');
  });

  it('reports a task finishing, and colours a failure differently', () => {
    const before = snap({ tasks: [task()] });
    const done = diffLocalSnapshot(before, snap({ tasks: [task({ state: 'done', endedSecondsAgo: 5 })] }));
    expect(done[0]?.text).toContain('task done');
    expect(done[0]?.tone).toBe('dim');
    const failed = diffLocalSnapshot(before, snap({ tasks: [task({ state: 'failed', endedSecondsAgo: 5 })] }));
    expect(failed[0]?.text).toContain('task failed');
    expect(failed[0]?.tone).toBe('bad');
  });

  it('does not repeat itself about a task that is still running', () => {
    const before = snap({ tasks: [task()] });
    expect(diffLocalSnapshot(before, snap({ tasks: [task({ elapsedSeconds: 120 })] }))).toEqual([]);
  });

  it('reports a session starting and ending', () => {
    const started = diffLocalSnapshot(snap(), snap({ sessions: [session()] }));
    expect(started[0]?.mark).toBe('session');
    expect(started[0]?.text).toContain('session started');
    const ended = diffLocalSnapshot(snap({ sessions: [session()] }), snap());
    expect(ended[0]?.mark).toBe('session');
    expect(ended[0]?.text).toContain('session ended');
  });

  it('reports a session being renamed', () => {
    const events = diffLocalSnapshot(
      snap({ sessions: [session({ name: 'site-2-43' })] }),
      snap({ sessions: [session({ name: 'fix the image import' })] }),
    );
    expect(events[0]?.mark).toBe('rename');
    expect(events[0]?.text).toContain('site-2-43 -> fix the image import');
  });

  it('reads idle turning into busy as a prompt starting', () => {
    const events = diffLocalSnapshot(
      snap({ sessions: [session({ status: 'idle' })] }),
      snap({ sessions: [session({ status: 'busy', statusAtMs: 2_000 })] }),
    );
    expect(events[0]?.mark).toBe('prompt');
    expect(events[0]?.text).toContain('prompt running');
  });

  it('reads busy with a newer timestamp as the next prompt', () => {
    const events = diffLocalSnapshot(
      snap({ sessions: [session({ status: 'busy', statusAtMs: 1_000 })] }),
      snap({ sessions: [session({ status: 'busy', statusAtMs: 5_000 })] }),
    );
    expect(events.map(e => e.mark)).toEqual(['prompt']);
  });

  it('says nothing while busy stands still', () => {
    const s = snap({ sessions: [session({ status: 'busy', statusAtMs: 1_000 })] });
    expect(diffLocalSnapshot(s, s)).toEqual([]);
  });

  it('does not announce a prompt twice for a session that has only just appeared', () => {
    const events = diffLocalSnapshot(snap(), snap({ sessions: [session({ status: 'busy' })] }));
    expect(events.map(e => e.mark)).toEqual(['session']);
  });

  it('announces what it dropped rather than cutting silently', () => {
    const many = Array.from({ length: 20 }, (_, i) => task({ id: `t${i}` }));
    const events = diffLocalSnapshot(snap(), snap({ tasks: many }), 5);
    expect(events).toHaveLength(6);
    expect(events[5]?.text).toContain('15 more changes');
  });
});

describe('sshAgentEvents', () => {
  const loaded = { state: 'loaded' as const, keys: 1, error: null };
  const empty = { state: 'empty' as const, keys: 0, error: null };

  it('says nothing on the first tick; the SSH row carries the state at startup', () => {
    expect(sshAgentEvents(null, empty)).toEqual([]);
  });

  it('does not repeat an unchanged state', () => {
    expect(sshAgentEvents(loaded, loaded)).toEqual([]);
  });

  // Otherwise nobody notices until the next fetch fails.
  it('warns in one line when the keys go away', () => {
    const events = sshAgentEvents(loaded, empty);
    expect(events.map(e => e.mark)).toEqual(['warn']);
    expect(events[0]?.text).toContain('no key loaded');
  });

  it('reports a key being added as a step', () => {
    expect(sshAgentEvents(empty, loaded)).toEqual([{ mark: 'step', text: 'ssh-agent: 1 key(s) loaded' }]);
  });

  it('ignores a change in the number of keys, only in whether there are any', () => {
    expect(sshAgentEvents(loaded, { ...loaded, keys: 3 })).toEqual([]);
  });
});

describe('toolVersionEvents', () => {
  const row = (over: Partial<ToolVersionRow> = {}): ToolVersionRow[] => [
    { name: 'claude', version: '2.1.236', error: null, latest: '2.1.236', latestError: null, ...over },
  ];

  it('says nothing on the first tick, which only establishes the baseline', () => {
    expect(toolVersionEvents(null, row())).toEqual([]);
  });

  it('says nothing when nothing changed', () => {
    expect(toolVersionEvents(row(), row())).toEqual([]);
  });

  it('reports an installed version moving, showing both sides', () => {
    const events = toolVersionEvents(row({ version: '2.1.235' }), row());
    expect(events).toEqual([{ mark: 'version', text: 'claude 2.1.235 -> 2.1.236' }]);
  });

  it('warns when a version that used to read stops reading', () => {
    const events = toolVersionEvents(row(), row({ version: null, error: 'spawn claude ENOENT' }));
    expect(events.map(e => e.mark)).toEqual(['warn']);
    expect(events[0]?.text).toContain('spawn claude ENOENT');
  });

  it('does not repeat itself while it stays unreadable', () => {
    const broken = row({ version: null, error: 'spawn claude ENOENT' });
    expect(toolVersionEvents(broken, broken)).toEqual([]);
  });

  it('reports the version once it becomes readable again', () => {
    const events = toolVersionEvents(row({ version: null, error: 'spawn claude ENOENT' }), row());
    expect(events).toEqual([{ mark: 'version', text: 'claude ? -> 2.1.236' }]);
  });

  it('reports a new release next to the installed version', () => {
    const events = toolVersionEvents(row(), row({ latest: '2.1.237' }));
    expect(events).toEqual([{ mark: 'version', text: 'claude 2.1.237 is out (installed 2.1.236)' }]);
  });

  // A value coming back after a failed fetch is not the same as a release appearing.
  it('says nothing the first time upstream can be reached', () => {
    const events = toolVersionEvents(row({ latest: null, latestError: 'GitHub HTTP 403' }), row({ latest: '2.1.237' }));
    expect(events).toEqual([]);
  });

  it('says nothing when upstream could not be reached, leaving the old value in place', () => {
    const events = toolVersionEvents(row(), row({ latestError: 'cannot reach GitHub' }));
    expect(events).toEqual([]);
  });

  it('reports both when the installed version and upstream move together', () => {
    const events = toolVersionEvents(row({ version: '2.1.235' }), row({ latest: '2.1.237' }));
    expect(events.map(e => e.text)).toEqual(['claude 2.1.235 -> 2.1.236', 'claude 2.1.237 is out (installed 2.1.236)']);
  });
});

describe('stampEvent', () => {
  it('attaches a time and changes nothing else', () => {
    expect(stampEvent({ mark: 'task', text: 'x' }, 42)).toEqual({ atMs: 42, mark: 'task', text: 'x' });
  });
});
