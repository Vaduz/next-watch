// Which CLIs the watcher may install, and — the part that has bitten — when it is allowed to try
// a second time.
//
// On 2026-09-18 an update ran against `latest` 0.155.1 and the installer resolved 0.155.0, because
// the distribution had not caught up with the GitHub release two minutes earlier. It exited 0, the
// memo was written against the target version, and nothing tried again for ten hours. The table
// below pins the difference between that case — the installed version *moved* but fell short — and
// the case the memo exists for, where it did not move at all.
import { describe, expect, it } from 'bun:test';
import { isBehind, toolsToAutoUpdate, type AutoUpdateMemo } from './toolVersionView.js';
import type { ToolVersionRow } from './types.js';

const row = (name: string, version: string | null, latest: string | null): ToolVersionRow => ({
  name,
  version,
  error: null,
  latest,
  latestError: null,
});

const standing: { version: string | null; latest: string | null; behind: boolean; why: string }[] = [
  { version: '0.9.0', latest: '0.10.0', behind: true, why: 'the places are numbers, not text' },
  // The other direction of the same row. Text comparison calls this behind as well, because it
  // only ever asks whether the two differ, and that is what sends an install after a version the
  // machine already has.
  { version: '0.10.0', latest: '0.9.0', behind: false, why: 'and so the newer one is not behind' },
  { version: '0.155.0', latest: '0.155.1', behind: true, why: 'the shape of the 2026-09-18 incident' },
  {
    // A machine somebody put a prerelease on by hand. It is ahead of the newest release, and
    // saying `0.155.1 is out` at it every tick was both wrong and the thing that ran installs.
    version: '0.156.0-alpha.7',
    latest: '0.155.1',
    behind: false,
    why: 'the installed version is newer than the newest release',
  },
  { version: '1.0.0-alpha.3', latest: '1.0.0', behind: true, why: 'a prerelease is before its release' },
  { version: '0.155.1', latest: '0.155.1', behind: false, why: 'the same version' },
  // Two builds of one version are one version. `compareVersions` is where that rule lives, and
  // this is what stops a standing being decided by the two strings differing.
  { version: '1.0.0+a', latest: '1.0.0+b', behind: false, why: 'build metadata is not a version difference' },
  { version: null, latest: '0.155.1', behind: false, why: 'the installed version could not be read' },
  { version: '0.155.0', latest: null, behind: false, why: 'upstream could not be read' },
  // Neither ranks against the other, and the screen still owes the person the difference it can
  // see. What must not happen is an install, and `toolsToAutoUpdate` is where that is decided.
  { version: 'nightly', latest: '0.155.1', behind: true, why: 'a difference nothing can rank is still a difference' },
];

describe('isBehind', () => {
  for (const c of standing) {
    it(`says ${c.version} against ${c.latest} is ${c.behind ? '' : 'not '}behind — ${c.why}`, () => {
      expect(isBehind(row('codex', c.version, c.latest))).toBe(c.behind);
    });
  }
});

const cases: { name: string; row: ToolVersionRow; memo: AutoUpdateMemo; picked: string[] }[] = [
  {
    name: 'behind and nothing attempted yet',
    row: row('codex', '0.154.0', '0.155.1'),
    memo: {},
    picked: ['codex'],
  },
  {
    // The 2026-09-18 shape. The installer did work — 0.154.0 became 0.155.0 — it just did not
    // reach the release the watcher had seen, so the next pass must try again.
    name: 'the attempt moved the version but fell short of the target',
    row: row('codex', '0.155.0', '0.155.1'),
    memo: { codex: { latest: '0.155.1', from: '0.154.0' } },
    picked: ['codex'],
  },
  {
    // ⚠️ The reason the memo exists. An update can run, exit 0 and change nothing — an installer
    // that failed quietly, or a distribution that never catches up — and the row stays behind for
    // ever. Picking it again here is how the release API's hourly limit gets burned through, one
    // attempt per tick.
    name: 'the attempt did not move the version at all',
    row: row('codex', '0.154.0', '0.155.1'),
    memo: { codex: { latest: '0.155.1', from: '0.154.0' } },
    picked: [],
  },
  {
    name: 'the attempt reached the target',
    row: row('codex', '0.155.1', '0.155.1'),
    memo: { codex: { latest: '0.155.1', from: '0.154.0' } },
    picked: [],
  },
  {
    // The old key still does this one on its own: upstream moved, so the memo is about a release
    // nobody is aiming at any more, whatever the installed version did.
    name: 'upstream published again while the installed version stood still',
    row: row('codex', '0.154.0', '0.155.2'),
    memo: { codex: { latest: '0.155.1', from: '0.154.0' } },
    picked: ['codex'],
  },
  {
    name: 'not behind and never attempted',
    row: row('codex', '0.155.1', '0.155.1'),
    memo: {},
    picked: [],
  },
  {
    name: 'upstream is unreadable, so nothing is known to be behind',
    row: row('codex', '0.154.0', null),
    memo: {},
    picked: [],
  },
];

describe('toolsToAutoUpdate', () => {
  for (const c of cases) {
    it(`picks ${c.picked.length === 0 ? 'nothing' : c.picked.join(', ')} when ${c.name}`, () => {
      expect(toolsToAutoUpdate([c.row], c.memo)).toEqual(c.picked);
    });
  }

  it('leaves a tool with its own memo alone while picking the one that moved', () => {
    const rows = [row('claude', '2.1.273', '2.1.280'), row('codex', '0.155.0', '0.155.1')];
    const memo: AutoUpdateMemo = {
      claude: { latest: '2.1.280', from: '2.1.273' },
      codex: { latest: '0.155.1', from: '0.154.0' },
    };

    expect(toolsToAutoUpdate(rows, memo)).toEqual(['codex']);
  });
});
