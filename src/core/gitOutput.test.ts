import { describe, expect, it } from 'bun:test';
import { parseCommitLog, parsePorcelain, parseShortstat } from './gitOutput.js';

describe('parsePorcelain', () => {
  it('drops the status code and returns the path', () => {
    expect(parsePorcelain(' M data/db.sqlite3\n?? data/images/801.jpg\n')).toEqual([
      'data/db.sqlite3',
      'data/images/801.jpg',
    ]);
  });

  it('takes the new side of a rename', () => {
    expect(parsePorcelain('R  lib/old.ts -> lib/new.ts')).toEqual(['lib/new.ts']);
  });
});

describe('parseCommitLog', () => {
  const FS = '\u001f';
  const RS = '\u001e';
  const log =
    ['a1b2c3d', 'feat(admin): strike through a retracted row (#531)', 'Satoru Yoshihara', '1787134995'].join(FS) +
    RS +
    '\n' +
    ['3fc5a7a', 'docs: add a source to the licence table (#537)', 'Satoru Yoshihara', '1787131395'].join(FS) +
    RS +
    '\n';

  it('splits a subject containing spaces and brackets, being delimited by control characters', () => {
    const commits = parseCommitLog(log);
    expect(commits).toHaveLength(2);
    expect(commits[0]?.sha).toBe('a1b2c3d');
    expect(commits[0]?.subject).toBe('feat(admin): strike through a retracted row (#531)');
    expect(commits[0]?.author).toBe('Satoru Yoshihara');
    expect(commits[0]?.atMs).toBe(1787134995000);
  });

  it('drops an incomplete record, these being for display and not for the decision', () => {
    expect(parseCommitLog('sha-only' + RS)).toEqual([]);
    expect(parseCommitLog('')).toEqual([]);
  });
});

describe('parseShortstat', () => {
  it('reads the file count and the two totals', () => {
    expect(parseShortstat(' 12 files changed, 240 insertions(+), 33 deletions(-)')).toEqual({
      files: 12,
      insertions: 240,
      deletions: 33,
    });
  });

  it('matches the singular form and a one-sided change', () => {
    expect(parseShortstat(' 1 file changed, 2 insertions(+)')).toEqual({ files: 1, insertions: 2, deletions: 0 });
  });

  it('falls back to zero, which only makes the display say zero', () => {
    expect(parseShortstat('')).toEqual({ files: 0, insertions: 0, deletions: 0 });
  });
});
