// The flags. What is checked here is the part a host can change: a caller that builds its own
// config must not be offered a `--config` flag that would then be ignored — a listed flag that
// does nothing is worse than no flag at all.
import { describe, expect, it } from 'bun:test';
import { checkScheduleTimes, parseArgs, DEFAULT_CONFIG } from './args.js';

describe('parseArgs', () => {
  it('reads the config path when the flag is there', () => {
    expect(parseArgs({}, ['--config', 'other.mjs']).config).toBe('other.mjs');
    expect(parseArgs({}, []).config).toBe(DEFAULT_CONFIG);
  });

  it('refuses --config when the caller supplies its own config', () => {
    // yargs exits the process on a strict-mode failure, so what is checked is that the option
    // is gone from the parsed shape rather than the exit itself.
    expect(parseArgs({ config: false }, []).config).toBe(DEFAULT_CONFIG);
    expect(parseArgs({ config: false }, ['--interval', '5']).interval).toBe(5);
  });

  it('keeps a sample interval of at least a second, however it is asked', () => {
    expect(parseArgs({}, ['--sample', '0']).sample).toBe(1);
    expect(parseArgs({}, ['--sample', '-3']).sample).toBe(1);
  });

  it('leaves the pane heights null so the terminal decides', () => {
    const a = parseArgs({}, []);
    expect(a.log).toBeNull();
    expect(a.access).toBeNull();
    expect(parseArgs({}, ['--log', '0']).log).toBe(0);
  });
  // yargs prints the version and exits, so what is checked here is that the option is accepted
  // and that parsing the rest is unaffected. That `main` passes a number at all is the fix:
  // yargs' own guess reads whichever package.json owns the node_modules tree, which for an
  // installed next-watch is the consuming project's.
  it('takes a version from the caller without disturbing the other flags', () => {
    expect(parseArgs({ version: '9.9.9' }, ['--interval', '7']).interval).toBe(7);
    expect(parseArgs({ version: '9.9.9' }, []).config).toBe(DEFAULT_CONFIG);
  });
});

// `--start` is a repeatable list next to flags that take no value, which is the shape yargs
// gets wrong when left to itself.
describe('parseArgs, the quota-session schedule', () => {
  const cases: [name: string, argv: string[], want: string[]][] = [
    ['nothing named leaves the automatic mode', ['--start', 'dev'], []],
    ['one time', ['--quota-session-at', '09:00'], ['09:00']],
    [
      'a comma-separated list, which is what a person reaches for',
      ['--quota-session-at', '09:00,14:00'],
      ['09:00', '14:00'],
    ],
    [
      'the flag repeated, which is what a script reaches for',
      ['--quota-session-at', '09:00', '--quota-session-at', '14:00'],
      ['09:00', '14:00'],
    ],
    // ⚠️ The reason `nargs: 1` is set here too: a greedy list reads `--once` as a time.
    ['a boolean flag after the list is not swallowed', ['--quota-session-at', '09:00', '--once'], ['09:00']],
  ];

  for (const [name, argv, want] of cases) {
    it(name, () => {
      expect(parseArgs({}, argv).quotaSessionAt).toEqual(want);
    });
  }

  it('does not swallow the flags that follow it', () => {
    const a = parseArgs({}, ['--quota-session-at', '09:00,14:00', '--once', '--interval', '5']);

    expect(a.once).toBe(true);
    expect(a.interval).toBe(5);
  });

  // Refused while the arguments are read, not at nine o'clock: the times are looked at once, at
  // startup, and a watch that starts and then quietly never opens a window is the worst outcome.
  // yargs answers a failed check by printing usage and exiting the process, so the check itself
  // is what is held to a table here.
  const refused: [name: string, times: string][] = [
    ['a single-digit hour', '9:00'],
    ['an hour that does not exist', '24:00'],
    ['a duplicate', '09:00,09:00'],
  ];
  for (const [name, times] of refused) {
    it(`refuses ${name}, naming the flag rather than the config file`, () => {
      expect(() => checkScheduleTimes({ 'quota-session-at': [times] })).toThrow('--quota-session-at');
    });
  }

  it('passes a list it can read', () => {
    expect(checkScheduleTimes({ 'quota-session-at': ['09:00,14:00'] })).toBe(true);
    expect(checkScheduleTimes({})).toBe(true);
  });
});

describe('parseArgs, the zero-config flags', () => {
  const cases: [name: string, argv: string[], start: string[], build: string | null, quotaSession: boolean][] = [
    ['nothing named', [], [], null, false],
    ['one script', ['--start', 'dev'], ['dev'], null, false],
    [
      'two scripts keep the order they were given',
      ['--start', 'web', '--start', 'admin'],
      ['web', 'admin'],
      null,
      false,
    ],
    ['a build script', ['--start', 'start', '--build', 'build'], ['start'], 'build', false],
    // ⚠️ The reason `nargs: 1` is set. A greedy list reads this as the scripts `dev` and
    // `--once`, and then `once` is false and a server is named after a flag.
    ['a boolean flag after the list is not swallowed', ['--start', 'dev', '--once'], ['dev'], null, false],
    ['the quota session is off unless it is asked for', ['--start', 'dev'], ['dev'], null, false],
    ['the quota session, asked for', ['--start', 'dev', '--quota-session'], ['dev'], null, true],
  ];

  for (const [name, argv, start, build, quotaSession] of cases) {
    it(name, () => {
      const a = parseArgs({}, argv);

      expect(a.start).toEqual(start);
      expect(a.build).toBe(build);
      expect(a.quotaSession).toBe(quotaSession);
    });
  }

  it('leaves the flags that follow a list alone', () => {
    const a = parseArgs({}, ['--start', 'dev', '--once', '--dry-run', '--interval', '5']);

    expect(a.once).toBe(true);
    expect(a.dryRun).toBe(true);
    expect(a.interval).toBe(5);
  });
});
