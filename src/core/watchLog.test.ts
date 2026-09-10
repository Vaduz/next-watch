import { describe, expect, it } from 'bun:test';
import { decodeWatchEvent, decodeWatchLog, encodeWatchEvent } from './watchLog.js';
import type { WatchEvent } from './types.js';

const NOW = Date.parse('2026-08-20T01:00:00Z');
const event = (over: Partial<WatchEvent> = {}): WatchEvent => ({
  atMs: NOW - 60_000,
  mark: 'task',
  text: 'task started: build',
  ...over,
});

describe('encodeWatchEvent / decodeWatchEvent', () => {
  it('survives a round trip', () => {
    expect(decodeWatchEvent(encodeWatchEvent(event()))).toEqual(event());
  });

  it('keeps an explicit colour', () => {
    const withTone = event({ tone: 'bad' });
    expect(decodeWatchEvent(encodeWatchEvent(withTone))).toEqual(withTone);
  });

  it('stays on one line, so an appended log never interleaves', () => {
    expect(encodeWatchEvent(event({ text: 'text that\nspans two lines' }))).not.toContain('\n');
  });

  const broken: { name: string; line: string }[] = [
    { name: 'not json', line: '{broken' },
    { name: 'no time', line: '{"mark":"task","text":"x"}' },
    { name: 'unreadable time', line: '{"at":"yesterday","mark":"task","text":"x"}' },
    { name: 'unknown mark', line: '{"at":"2026-08-20T01:00:00.000Z","mark":"???","text":"x"}' },
    { name: 'no text', line: '{"at":"2026-08-20T01:00:00.000Z","mark":"task"}' },
    { name: 'an array', line: '[1,2,3]' },
  ];
  for (const c of broken) {
    it(`drops a line it cannot read: ${c.name}`, () => {
      expect(decodeWatchEvent(c.line)).toBeNull();
    });
  }

  it('reads back every mark in MARKS (adding a mark means adding it there too)', () => {
    const bumped = event({ mark: 'version', text: 'claude 2.1.235 -> 2.1.236' });
    expect(decodeWatchEvent(encodeWatchEvent(bumped))).toEqual(bumped);
  });

  it('drops an unknown colour but keeps the row', () => {
    const line = '{"at":"2026-08-20T01:00:00.000Z","mark":"task","text":"x","tone":"rainbow"}';
    expect(decodeWatchEvent(line)?.tone).toBeUndefined();
  });
});

describe('decodeWatchLog', () => {
  const log = [
    encodeWatchEvent(event({ atMs: NOW - 30 * 60_000, text: '30 minutes ago' })),
    '{a broken line}',
    encodeWatchEvent(event({ atMs: NOW - 20 * 60_000, text: '20 minutes ago' })),
    encodeWatchEvent(event({ atMs: NOW - 10 * 60_000, text: '10 minutes ago' })),
    '',
  ].join('\n');

  it('skips broken lines and returns the rest oldest first', () => {
    const events = decodeWatchLog(log, NOW, { limit: 10, withinMs: 60 * 60_000 });
    expect(events.map(e => e.text)).toEqual(['30 minutes ago', '20 minutes ago', '10 minutes ago']);
  });

  // A row shows only HH:MM:SS, so an event from days ago would read as one from today.
  it('leaves out events that are too old', () => {
    const events = decodeWatchLog(log, NOW, { limit: 10, withinMs: 15 * 60_000 });
    expect(events.map(e => e.text)).toEqual(['10 minutes ago']);
  });

  it('caps the count from the newest end', () => {
    const events = decodeWatchLog(log, NOW, { limit: 2, withinMs: 60 * 60_000 });
    expect(events.map(e => e.text)).toEqual(['20 minutes ago', '10 minutes ago']);
  });

  it('returns nothing for an empty log', () => {
    expect(decodeWatchLog('', NOW, { limit: 10, withinMs: 60 * 60_000 })).toEqual([]);
  });
});

describe("the watcher's own marks", () => {
  it('reads back its start, its stop and the commands typed at it', () => {
    for (const mark of ['watch', 'cmd'] as const) {
      const line = encodeWatchEvent({ atMs: Date.parse('2026-08-21T10:00:00Z'), mark, text: 'x' });
      expect(decodeWatchEvent(line)?.mark).toBe(mark);
    }
  });
});
