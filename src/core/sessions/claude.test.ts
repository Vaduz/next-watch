import { describe, expect, it } from 'bun:test';
import { isClaudeCommand, isLiveSession, parseAgentSession, type AgentSessionRecord } from './claude.js';

/** A real `~/.claude/sessions/<pid>.json`, reduced to the fields that are read. */
const RECORD = JSON.stringify({
  pid: 1094,
  sessionId: '82272d05-92e4-4fdc-9543-f04d9efa97a3',
  cwd: '/home/user/site',
  startedAt: 1781190173847,
  procStart: '1354',
  version: '2.1.172',
  kind: 'interactive',
  entrypoint: 'cli',
  name: 'top-feed-expansion-latest-day',
  updatedAt: 1781236689097,
  status: 'shell',
  statusUpdatedAt: 1781236689097,
});

describe('parseAgentSession', () => {
  it('reads procStart, which the CLI writes as a string of clock ticks', () => {
    expect(parseAgentSession(RECORD)?.procStart).toBe('1354');
  });

  const shapes: [name: string, value: unknown, expected: string | null][] = [
    ['a number is taken too', 4234772, '4234772'],
    ['a record written before the field existed', undefined, null],
    ['something that is not a tick count', 'abc', null],
    ['a negative number', -1, null],
  ];
  for (const [name, value, expected] of shapes) {
    it(`procStart: ${name}`, () => {
      const raw = JSON.stringify({ pid: 1, sessionId: 's', ...(value === undefined ? {} : { procStart: value }) });
      expect(parseAgentSession(raw)?.procStart).toBe(expected);
    });
  }
});

describe('isClaudeCommand', () => {
  const cases: [command: string, expected: boolean][] = [
    ['claude', true],
    ['claude --resume 8bccdc61-b535-49dd-a92c-334cc18b4e78 --fork-session', true],
    ['/usr/local/bin/claude', true],
    // A background session execs the versioned binary, whose last path segment is the version.
    // The old `claude(\s|$)` missed this and dropped the row.
    ['/home/user/.local/share/claude/versions/2.1.267 --session-id 8bccdc61 --permission-mode auto', true],
    ['/home/user/.local/share/claude/versions/2.1.267', true],
    // Not the CLI: the segment is `claude-code`, and a name that merely starts with it.
    ['node /home/user/n_m/@anthropic-ai/claude-code/cli.js', false],
    ['claude-code-mode-host', false],
    ['/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state', false],
    ['/usr/lib/systemd/systemd-timesyncd', false],
  ];
  for (const [command, expected] of cases) {
    it(`${expected ? 'is' : 'is not'} the CLI: ${command.slice(0, 48)}`, () => {
      expect(isClaudeCommand(command)).toBe(expected);
    });
  }
});

const record = (over: Partial<AgentSessionRecord> = {}): AgentSessionRecord => ({
  pid: 1094,
  sessionId: '82272d05-92e4-4fdc-9543-f04d9efa97a3',
  cwd: '/home/user/site',
  name: 'top-feed-expansion-latest-day',
  status: 'shell',
  startedAtMs: 1781190173847,
  statusUpdatedAtMs: 1781236689097,
  kind: 'interactive',
  entrypoint: 'cli',
  version: '2.1.172',
  procStart: '1354',
  ...over,
});

describe('isLiveSession', () => {
  /** Each row names which of the three old ways of saying "alive" it overturns, or which one
   *  it keeps. */
  const cases: [
    name: string,
    over: Partial<AgentSessionRecord>,
    evidence: Parameters<typeof isLiveSession>[1],
    expected: boolean,
  ][] = [
    [
      'a running session',
      { pid: 1665838, procStart: '4234772' },
      { signalable: true, procStartTicks: '4234772', command: 'claude', psFailed: false },
      true,
    ],
    [
      // The bug: EPERM used to read as alive, so a pid taken over by a root daemon's thread
      // kept a session that died in June on screen in September.
      'a pid another user holds now',
      {},
      { signalable: false, procStartTicks: '3580', command: undefined, psFailed: false },
      false,
    ],
    [
      // The same pid, asked the other way: even signalable, the tick counts disagree, so the
      // process at that number is not the one the record describes.
      'a pid reused since the record was written',
      {},
      { signalable: true, procStartTicks: '3580', command: 'claude', psFailed: false },
      false,
    ],
    [
      // ps ran and had nothing for this pid: a thread has no row of its own. This used to pass
      // as "cannot tell, so let it through".
      'a pid ps has no row for',
      {},
      { signalable: true, procStartTicks: '1354', command: undefined, psFailed: false },
      false,
    ],
    [
      // The one case the waiver is really for: with ps failed, no pid has a row, and dropping
      // every session would be worse than trusting the other two checks.
      'a pid ps could not be run for at all',
      {},
      { signalable: true, procStartTicks: '1354', command: undefined, psFailed: true },
      true,
    ],
    [
      'a pid running something else entirely',
      {},
      { signalable: true, procStartTicks: '1354', command: '/usr/sbin/tailscaled', psFailed: false },
      false,
    ],
    [
      'a background session on the versioned binary',
      { pid: 1396556, procStart: '3677647' },
      {
        signalable: true,
        procStartTicks: '3677647',
        command: '/home/user/.local/share/claude/versions/2.1.267 --session-id 8bccdc61',
        psFailed: false,
      },
      true,
    ],
    [
      // Not Linux, or /proc unreadable: the tick check abstains rather than guessing.
      'no /proc to compare against',
      {},
      { signalable: true, procStartTicks: null, command: 'claude', psFailed: false },
      true,
    ],
    [
      'a record written before procStart existed',
      { procStart: null },
      { signalable: true, procStartTicks: '3580', command: 'claude', psFailed: false },
      true,
    ],
  ];

  for (const [name, over, evidence, expected] of cases) {
    it(name, () => {
      expect(isLiveSession(record(over), evidence)).toBe(expected);
    });
  }
});
