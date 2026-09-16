import { describe, expect, it } from 'bun:test';
import { parseProcStartTicks, parsePsTable } from './ps.js';

describe('parseProcStartTicks', () => {
  /** Real `/proc/<pid>/stat` lines, trimmed after `starttime` (field 22) — the fields past it
   *  are memory addresses and signal masks that no reader here touches. */
  const cases: [name: string, stat: string, expected: string | null][] = [
    [
      'a plain command',
      '1665838 (claude) S 1241405 1665838 1665838 34816 1665838 4194304 91831 0 6 0 1183 199 0 0 20 0 24 0 4234772',
      '4234772',
    ],
    [
      // The pid a three-month-dead session's file still names. It answers /proc because a
      // thread of tailscaled holds it now, and the tick count is the giveaway.
      'a thread that took the pid over',
      '1094 (tailscaled) S 1 1015 1015 0 -1 4194624 21021 13301 393 35 19148 31763 2 0 20 0 25 0 3580',
      '3580',
    ],
    [
      // Why the cut is at the last `") "` and not the first.
      'a comm with a space and parentheses in it',
      '4242 (tmux: (server)) S 1 4242 4242 0 -1 4194560 900 0 0 0 12 4 0 0 20 0 1 0 987654',
      '987654',
    ],
    ['a line with too few fields', '17 (init) S 1 17 17 0 -1 4194560 900', null],
    ['a line with no comm at all', '17 S 1 17 17 0 -1', null],
    ['nothing', '', null],
  ];

  for (const [name, stat, expected] of cases) {
    it(name, () => {
      expect(parseProcStartTicks(stat)).toBe(expected);
    });
  }
});

describe('parsePsTable', () => {
  /** Real `ps` output, one line per process and no header. */
  const five = [
    '   1665838 1241405 1665838 1665838 node /home/user/.local/bin/claude',
    '   1665900 1665838 1665900 1665838 sh -c bun run dev',
    '   1665901 1665900 1665901 1665901 bun run write-article',
  ].join('\n');

  it('reads the group and the session when they are asked for', () => {
    expect(parsePsTable(five, 2)).toEqual([
      { pid: 1665838, ppid: 1241405, pgid: 1665838, sid: 1665838, command: 'node /home/user/.local/bin/claude' },
      { pid: 1665900, ppid: 1665838, pgid: 1665900, sid: 1665838, command: 'sh -c bun run dev' },
      { pid: 1665901, ppid: 1665900, pgid: 1665901, sid: 1665901, command: 'bun run write-article' },
    ]);
  });

  it('reads the group alone', () => {
    expect(parsePsTable('  42 1 42 bun run dev', 1)).toEqual([{ pid: 42, ppid: 1, pgid: 42, command: 'bun run dev' }]);
  });

  it('reads the three-column form, which is what every ps prints', () => {
    expect(parsePsTable('  42 1 bun run dev')).toEqual([{ pid: 42, ppid: 1, command: 'bun run dev' }]);
  });

  // ⚠️ Why the column count is passed rather than counted: a command line is free to begin with
  // digits, and a parser guessing from the numbers would read `7z` as a session id.
  it('does not mistake a leading number in the command for a column', () => {
    expect(parsePsTable('  42 1 7z a archive.7z big.log', 0)).toEqual([
      { pid: 42, ppid: 1, command: '7z a archive.7z big.log' },
    ]);
  });

  it('skips a line that is not a process row', () => {
    expect(parsePsTable('ps: illegal option\n  42 1 42 42 bun run dev', 2)).toEqual([
      { pid: 42, ppid: 1, pgid: 42, sid: 42, command: 'bun run dev' },
    ]);
  });

  it('skips a row whose session column is not a number', () => {
    expect(parsePsTable('  42 1 42 ? bun run dev', 2)).toEqual([]);
  });
});
