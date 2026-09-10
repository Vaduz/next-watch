import { describe, expect, it } from 'bun:test';
import { painter } from '../term/index.js';
import { describeIncoming, summarizePaths } from './incoming.js';
import { watchLayout } from './layout.js';

const plain = painter(false);
/** A 120-column terminal, so a 118-wide frame. */
const LAYOUT = watchLayout(120);
const NOW = Date.parse('2026-08-19T10:42:07Z');

describe('summarizePaths', () => {
  it('folds paths to their top directory and counts them', () => {
    expect(summarizePaths(['cli/a.ts', 'cli/b.ts', 'lib/c.ts', 'README.md'])).toBe('cli/ 2 · lib/ 1 · README.md 1');
  });
});

describe('describeIncoming', () => {
  const view = {
    nowMs: NOW,
    fromSha: 'd29fbda3aaaa',
    toSha: 'a1b2c3d4eeee',
    commits: [
      {
        sha: 'a1b2c3d4eeee',
        subject: 'feat: rework the panel layout (#531)',
        author: 'Satoru Yoshihara',
        atMs: NOW - 120_000,
      },
    ],
    totalCommits: 4,
    files: ['cli/dev/watch.ts', 'lib/devtools/devWatchView.ts'],
    totalFiles: 12,
    insertions: 240,
    deletions: 33,
    plan: 'rebuild and restart admin',
  };

  it('says in the heading what arrived and how far it moved', () => {
    const { head } = describeIncoming(view, plain, LAYOUT);
    expect(head).toContain('pulled 4 commit(s)');
    expect(head).toContain('d29fbda -> a1b2c3d');
  });

  it('lists the subject, the author, the size of the diff and what follows', () => {
    const text = describeIncoming(view, plain, LAYOUT).details.join('\n');
    expect(text).toContain('feat: rework the panel layout (#531)');
    expect(text).toContain('Satoru Yoshihara');
    expect(text).toContain('12 file(s)  +240 -33');
    expect(text).toContain('-> rebuild and restart admin');
  });

  it('announces the commits it left out rather than dropping them silently', () => {
    expect(describeIncoming(view, plain, LAYOUT).details.join('\n')).toContain('3 more commits');
  });

  it('adds no timestamp or indent, which is the caller stacking these', () => {
    const { head, details } = describeIncoming(view, plain, LAYOUT);
    expect(head.startsWith(' ')).toBe(false);
    for (const line of details) expect(line.startsWith('  ')).toBe(false);
  });
});
