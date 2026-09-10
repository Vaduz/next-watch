import { describe, expect, it } from 'bun:test';
import {
  accessClass,
  accessRows,
  formatMs,
  parseAccessLine,
  stampFinalLine,
  type AccessClass,
  type AccessRow,
} from './accessLog.js';

/** Copied from a real dev server log (2026-08-20). */
const WEB_LOG = [
  ' ▲ Next.js 16.3.1',
  ' - Local:         http://localhost:3000',
  ' ✓ Ready in 318ms',
  '',
  ' GET / 200 in 2.5s (next.js: 1718ms, application-code: 738ms)',
  ' GET /easy/ 200 in 741ms (next.js: 53ms, application-code: 688ms)',
  ' GET /missing/ 404 in 12ms',
].join('\n');

describe('parseAccessLine', () => {
  it('reads method, path, status and duration', () => {
    expect(parseAccessLine(' GET /easy/ 200 in 741ms (next.js: 53ms)')).toEqual({
      atMs: null,
      method: 'GET',
      target: '/easy/',
      status: 200,
      ms: 741,
    });
  });

  it('takes the time from the caller, because the line has none', () => {
    expect(parseAccessLine(' GET / 200 in 5ms', 1_700_000)?.atMs).toBe(1_700_000);
  });

  it('converts a duration written in seconds to milliseconds', () => {
    expect(parseAccessLine(' GET / 200 in 2.5s')?.ms).toBe(2500);
  });

  it('picks up methods other than GET', () => {
    expect(parseAccessLine(' POST /api/tasks 500 in 30ms')?.status).toBe(500);
  });

  const notRequests = [' ✓ Ready in 318ms', '▲ Next.js 16.3.1', '--- start 2026-08-19T17:29:59.290Z port=4321 ---'];
  for (const line of notRequests) {
    it(`returns null for a line that is not a request: ${line.trim().slice(0, 20)}`, () => {
      expect(parseAccessLine(line)).toBeNull();
    });
  }
});

describe('accessRows', () => {
  it('returns only the access rows, oldest first', () => {
    const rows = accessRows(WEB_LOG, 10);
    expect(rows.map(r => r.target)).toEqual(['/', '/easy/', '/missing/']);
  });

  it('cuts from the newest end when there are more than the limit', () => {
    expect(accessRows(WEB_LOG, 2).map(r => r.target)).toEqual(['/easy/', '/missing/']);
  });

  // A server in production mode writes no request lines, so a pane that insisted on them
  // would always be empty.
  it('falls back to the raw log when there is not a single access row', () => {
    const raw = ['✓ Ready in 75ms', '--- start 2026-08-19T18:15:22.286Z port=4321 ---'].join('\n');
    const rows = accessRows(raw, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.method).toBeNull();
    expect(rows[0]?.target).toContain('start 2026-08-19');
  });

  it('returns nothing for a limit of zero', () => {
    expect(accessRows(WEB_LOG, 0)).toEqual([]);
  });

  it('returns nothing for an empty log', () => {
    expect(accessRows('', 5)).toEqual([]);
  });
});

describe('accessClass', () => {
  const cases: { status: number | null; want: AccessClass }[] = [
    { status: 200, want: 'ok' },
    { status: 304, want: 'redirect' },
    { status: 404, want: 'clientError' },
    { status: 500, want: 'serverError' },
    { status: null, want: 'unknown' },
  ];
  for (const c of cases) {
    it(`${String(c.status)} is ${c.want}`, () => {
      expect(accessClass(c.status)).toBe(c.want);
    });
  }
});

describe('formatMs', () => {
  it('switches to seconds at one second', () => {
    expect(formatMs(741)).toBe('741ms');
    expect(formatMs(2500)).toBe('2.5s');
    expect(formatMs(null)).toBe('');
  });
});

describe('stampFinalLine', () => {
  const rows = (text: string): AccessRow[] => accessRows(text, 10, null);

  it('stamps only the last row, leaving the rest without a time', () => {
    const text = ' GET /a/ 200 in 5ms\n GET /b/ 200 in 7ms\n';
    expect(stampFinalLine(rows(text), text, 9_000).map(r => [r.target, r.atMs])).toEqual([
      ['/a/', null],
      ['/b/', 9_000],
    ]);
  });

  it('stamps nothing when the file ends in decoration that is not the last row shown', () => {
    const text = ' GET /a/ 200 in 5ms\n ✓ Compiled /easy in 120ms\n';
    expect(stampFinalLine(rows(text), text, 9_000).map(r => r.atMs)).toEqual([null]);
  });

  it('stamps the last row in the raw fallback too', () => {
    const text = '--- start 2026-08-20T02:00:00.000Z port=4321 ---\n';
    expect(stampFinalLine(rows(text), text, 9_000).map(r => r.atMs)).toEqual([9_000]);
  });

  it('does nothing when there are no rows', () => {
    expect(stampFinalLine([], '', 9_000)).toEqual([]);
  });
});
