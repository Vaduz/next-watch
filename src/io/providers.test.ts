// The switches. What matters here is the shape of "off", because that is what makes a section
// disappear: the loop draws a section only where there is a reader for it, so **off has to mean
// no function at all**, not a function returning nothing.
import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProviders, zeroConfigProviders, type WatchProviders } from './providers.js';

const build = (providers: Parameters<typeof buildProviders>[0]['providers']): ReturnType<typeof buildProviders> =>
  buildProviders({ appName: 'site', providers });

describe('buildProviders', () => {
  it('gives nothing at all when nothing is switched on', () => {
    const p = build({});

    expect(p.sessions).toBeUndefined();
    expect(p.quotas).toBeUndefined();
    expect(p.services).toBeUndefined();
    expect(p.toolVersions).toBeUndefined();
    expect(p.sshAgent).toBeUndefined();
    expect(p.autoUpdate).toEqual([]);
    expect(p.quotaSession).toBeNull();
  });

  it('gives a reader only for the section that was switched on', () => {
    expect(build({ agentSessions: true }).sessions).toBeTypeOf('function');
    expect(build({ agentSessions: true }).quotas).toBeUndefined();
    expect(build({ quota: true }).quotas).toBeTypeOf('function');
    expect(build({ quota: true }).sshAgent).toBeUndefined();
    expect(build({ sshAgent: true }).sshAgent).toBeTypeOf('function');
    expect(build({ services: true }).services).toBeTypeOf('function');
    expect(build({ tools: true }).toolVersions).toBeTypeOf('function');
  });

  it('switching one off explicitly is the same as leaving it out', () => {
    const p = build({ agentSessions: false, quota: false, services: false, tools: false, sshAgent: false });

    expect(p.sessions).toBeUndefined();
    expect(p.services).toBeUndefined();
    expect(p.toolVersions).toBeUndefined();
    expect(p.quotaSession).toBeNull();
  });

  it('updates the default CLIs itself, and only those asked for in a given list', () => {
    expect(build({ tools: true }).autoUpdate).toEqual(['claude', 'codex']);
    expect(build({ tools: [{ command: 'claude', repo: 'anthropics/claude-code' }] }).autoUpdate).toEqual([]);
    expect(build({ tools: [{ command: 'codex', repo: 'openai/codex', autoUpdate: true }] }).autoUpdate).toEqual([
      'codex',
    ]);
  });

  it('opens the quota window in a sandbox named after the application, or wherever it is told', () => {
    expect(build({ quotaSession: true }).quotaSession?.cwd).toBe(join(tmpdir(), 'site'));
    expect(build({ quotaSession: { cwd: '/tmp/elsewhere' } }).quotaSession?.cwd).toBe('/tmp/elsewhere');
  });

  it('can open the quota window without drawing the quota section', () => {
    // The two read the same figures through the same cache, so one does not imply the other.
    const p = build({ quotaSession: true });

    expect(p.quotas).toBeUndefined();
    expect(p.quotaSession?.read).toBeTypeOf('function');
  });
});

// What a run with no config file draws. The line that matters is the one between a section that
// only looks and the one that spends: everything is on, and only `quotaSession` waits to be
// asked for.
describe('zeroConfigProviders', () => {
  const cases: [name: string, quotaSession: boolean, expected: WatchProviders][] = [
    [
      'every section that only looks is on, and the one that spends is not',
      false,
      { agentSessions: true, quota: true, quotaSession: false, services: true, tools: true, sshAgent: true },
    ],
    [
      'the quota session, once it has been asked for',
      true,
      { agentSessions: true, quota: true, quotaSession: true, services: true, tools: true, sshAgent: true },
    ],
  ];

  for (const [name, quotaSession, expected] of cases) {
    it(name, () => {
      expect(zeroConfigProviders({ quotaSession })).toEqual(expected);
    });
  }

  it('turns into the readers the loop wants, sandbox and all', () => {
    const off = buildProviders({ appName: 'site', providers: zeroConfigProviders({ quotaSession: false }) });
    const on = buildProviders({ appName: 'site', providers: zeroConfigProviders({ quotaSession: true }) });

    expect(off.sessions).toBeTypeOf('function');
    expect(off.quotas).toBeTypeOf('function');
    expect(off.services).toBeTypeOf('function');
    expect(off.toolVersions).toBeTypeOf('function');
    expect(off.sshAgent).toBeTypeOf('function');
    // Nothing is started on the watcher's own initiative until the flag is given.
    expect(off.quotaSession).toBeNull();
    expect(on.quotaSession?.cwd).toBe(join(tmpdir(), 'site'));
  });

  it('keeps the documented default for installing new CLI releases', () => {
    // `tools` is unchanged by the absence of a config file: it reports and installs, as the
    // README says it does. The opt-in one is the session, not the update.
    const p = buildProviders({ appName: 'site', providers: zeroConfigProviders({ quotaSession: false }) });

    expect(p.autoUpdate).toEqual(['claude', 'codex']);
  });
});
