import { describe, expect, it } from 'bun:test';
import { parseProcStartTicks } from './ps.js';

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
