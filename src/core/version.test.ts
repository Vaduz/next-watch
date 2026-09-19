// Ranking versions. The rows that matter are the ones string comparison gets wrong: `0.9.0`
// against `0.10.0`, and every prerelease against the release it leads to.
import { describe, expect, it } from 'bun:test';
import { compareVersions } from './version.js';
import { parseReleaseTag } from './toolVersionView.js';

const older: { a: string; b: string; why: string }[] = [
  { a: '0.9.0', b: '0.10.0', why: 'the numbers are numbers, not text — this is the one `<` gets backwards' },
  { a: '0.155.0', b: '0.155.1', why: 'the distribution lagging behind the release, 2026-09-18' },
  { a: '1.0.0', b: '2.0.0', why: 'major' },
  { a: '1.9.9', b: '1.10.0', why: 'minor, past nine' },
  { a: '1.0.0-alpha.3', b: '1.0.0', why: 'a prerelease comes before the release it leads to' },
  { a: '1.0.0-alpha', b: '1.0.0-alpha.1', why: 'fewer identifiers rank lower' },
  { a: '1.0.0-alpha.1', b: '1.0.0-alpha.beta', why: 'numeric identifiers rank below alphanumeric' },
  { a: '1.0.0-alpha.beta', b: '1.0.0-beta', why: 'alphanumeric identifiers compare as text' },
  { a: '1.0.0-beta.2', b: '1.0.0-beta.11', why: 'numeric identifiers compare as numbers, not text' },
  { a: '1.0.0-rc.1', b: '1.0.0', why: 'a release candidate is still before the release' },
  { a: '1.0', b: '1.0.1', why: 'a missing place counts as zero' },
];

const same: { a: string; b: string; why: string }[] = [
  { a: '1.0.0', b: '1.0.0', why: 'the same text' },
  { a: '1.0.0+build.7', b: '1.0.0', why: 'build metadata has no place in precedence' },
  { a: '1.0.0+a', b: '1.0.0+b', why: 'and so two builds of one version rank together' },
  { a: '1.0', b: '1.0.0', why: 'a missing place counts as zero' },
  { a: '0.155.1', b: '0.155.1', why: 'what a settled auto-update looks like' },
];

const unreadable: { a: string; b: string; why: string }[] = [
  { a: 'unknown', b: '1.0.0', why: 'not a version at all' },
  { a: '1.0.0', b: '', why: 'empty' },
  { a: 'v1.0.0', b: '1.0.0', why: 'a prefix should have been taken off before this point' },
  { a: '1.0.0 (Claude Code)', b: '1.0.0', why: 'a whole line of output, not a version' },
  { a: '1.0.0-', b: '1.0.0', why: 'a dash with no identifiers after it' },
];

describe('compareVersions', () => {
  for (const c of older) {
    it(`puts ${c.a} before ${c.b} — ${c.why}`, () => {
      expect(compareVersions(c.a, c.b)).toBe(-1);
      // Ranking must not depend on which side it is asked from.
      expect(compareVersions(c.b, c.a)).toBe(1);
    });
  }

  for (const c of same) {
    it(`ranks ${c.a} with ${c.b} — ${c.why}`, () => {
      expect(compareVersions(c.a, c.b)).toBe(0);
      expect(compareVersions(c.b, c.a)).toBe(0);
    });
  }

  for (const c of unreadable) {
    it(`refuses to rank ${JSON.stringify(c.a)} against ${JSON.stringify(c.b)} — ${c.why}`, () => {
      expect(compareVersions(c.a, c.b)).toBeNull();
      expect(compareVersions(c.b, c.a)).toBeNull();
    });
  }

  it('ranks the whole of semver’s own example chain', () => {
    const chain = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];

    for (let i = 0; i + 1 < chain.length; i++) {
      expect(compareVersions(chain[i], chain[i + 1])).toBe(-1);
    }
  });

  it('ranks a release tag once its prefix has been taken off', () => {
    // `latest` reaches a row through `parseReleaseTag`, so the prefix is already gone by the time
    // anything is compared. Ranking the raw tag is what this would look like if it were not.
    const tag = parseReleaseTag('rust-v0.155.1');

    expect(tag).toBe('0.155.1');
    expect(compareVersions('0.155.0', tag ?? '')).toBe(-1);
    expect(compareVersions('0.155.0', 'rust-v0.155.1')).toBeNull();
  });
});
