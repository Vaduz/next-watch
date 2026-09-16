import { describe, expect, it } from 'bun:test';
import {
  armSchedule,
  formatScheduleTime,
  nextScheduleTime,
  parseScheduleTimes,
  scheduleTick,
  type FiredTimes,
} from './schedule.js';

/** The watch's clock for these tables: JST, nine hours ahead. A non-zero offset is the point —
 *  with zero, a wrong answer that used UTC would still look right. */
const JST = 540;
/** A negative one, for the same reason in the other direction (US Eastern, standard time). */
const EST = -300;

/** A wall-clock time in the watch's zone, as epoch ms. */
const at = (day: string, time: string, offset = JST): number => {
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const zone = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return Date.parse(`${day}T${time}${zone}`);
};

const MINUTES = { '00:00': 0, '06:00': 360, '09:00': 540, '14:00': 840, '23:59': 1439 };

describe('parseScheduleTimes', () => {
  const good: { at: string[]; want: number[]; why: string }[] = [
    { at: ['09:00'], want: [540], why: 'one time' },
    { at: ['14:00', '06:00', '21:30'], want: [360, 840, 1290], why: 'sorted, whatever order they were written in' },
    { at: ['00:00', '23:59'], want: [0, 1439], why: 'both ends of the day' },
    { at: [' 09:00 '], want: [540], why: 'surrounding space' },
  ];
  for (const c of good) {
    it(`reads ${JSON.stringify(c.at)}: ${c.why}`, () => {
      expect(parseScheduleTimes(c.at, 'config')).toEqual(c.want);
    });
  }

  const bad: { at: unknown[]; says: string; why: string }[] = [
    { at: [], says: 'at least one time', why: 'an empty list says nothing at all' },
    { at: ['9:00'], says: 'not "9:00"', why: 'a single-digit hour' },
    { at: ['24:00'], says: 'is not a time', why: 'there is no 24th hour' },
    { at: ['12:60'], says: 'is not a time', why: 'there is no 60th minute' },
    { at: ['09:00:00'], says: 'is not a time', why: 'seconds are not a thing a schedule has' },
    { at: ['noon'], says: 'is not a time', why: 'a word' },
    { at: ['09:00', '09:00'], says: 'listed twice', why: 'a duplicate' },
    { at: [900], says: 'as strings', why: 'a number' },
  ];
  for (const c of bad) {
    it(`refuses ${JSON.stringify(c.at)}: ${c.why}`, () => {
      expect(() => parseScheduleTimes(c.at, '/tmp/next-watch.config.mjs')).toThrow(c.says);
    });
  }

  it('names the source, because the file and the flag are both possible', () => {
    expect(() => parseScheduleTimes(['nope'], '--quota-session-at')).toThrow('--quota-session-at');
  });
});

describe('formatScheduleTime', () => {
  for (const [text, minutes] of Object.entries(MINUTES)) {
    it(`writes ${minutes} as ${text}`, () => {
      expect(formatScheduleTime(minutes)).toBe(text);
    });
  }
});

describe('armSchedule', () => {
  const cases: { now: string; at: number[]; want: FiredTimes; why: string }[] = [
    {
      now: '15:00:00',
      at: [360, 540, 840],
      want: { 360: '2026-09-16', 540: '2026-09-16', 840: '2026-09-16' },
      why: 'a watch started in the afternoon does not make up the morning',
    },
    {
      now: '08:59:00',
      at: [360, 540],
      want: { 360: '2026-09-16' },
      why: 'the one still ahead is left alone',
    },
    {
      now: '09:00:30',
      at: [540],
      want: {},
      why: 'still inside the 09:00 minute, so 09:00 has not passed and will fire',
    },
    { now: '00:00:00', at: [0], want: {}, why: 'midnight exactly, at the moment it is due' },
    {
      now: '23:59:59',
      at: [0, 1439],
      want: { 0: '2026-09-16' },
      why: "this morning's midnight is behind; 23:59 is this minute, so it still fires",
    },
  ];
  for (const c of cases) {
    it(`${c.now}: ${c.why}`, () => {
      expect(armSchedule(c.at, at('2026-09-16', c.now), JST)).toEqual(c.want);
    });
  }

  it('uses the watch clock, not the host, so a negative offset gets its own day', () => {
    // 2026-09-16T01:00Z is still 2026-09-15 21:00 in New York.
    expect(armSchedule([540], Date.parse('2026-09-16T01:00:00Z'), EST)).toEqual({ 540: '2026-09-15' });
  });
});

describe('scheduleTick', () => {
  const AT = [360, 540, 840];
  const tick = (o: {
    now: string;
    fired?: FiredTimes;
    windowOpen?: boolean;
    day?: string;
  }): ReturnType<typeof scheduleTick> =>
    scheduleTick({
      at: AT,
      fired: o.fired ?? {},
      nowMs: at(o.day ?? '2026-09-16', o.now),
      offsetMinutes: JST,
      windowOpen: o.windowOpen ?? false,
    });

  it('does nothing before the first listed time', () => {
    expect(tick({ now: '05:59:59' })).toEqual({ kind: 'idle' });
  });

  it('fires at the listed time', () => {
    expect(tick({ now: '06:00:00' })).toEqual({ kind: 'open', at: 360, fired: { 360: '2026-09-16' } });
  });

  it('fires on a look that lands minutes late, and says which time it was', () => {
    expect(tick({ now: '06:07:00' })).toEqual({ kind: 'open', at: 360, fired: { 360: '2026-09-16' } });
  });

  it('does not fire the same time twice in a day', () => {
    expect(tick({ now: '06:30:00', fired: { 360: '2026-09-16' } })).toEqual({ kind: 'idle' });
  });

  it('fires the same time again the next day', () => {
    expect(tick({ now: '06:00:00', day: '2026-09-17', fired: { 360: '2026-09-16' } })).toEqual({
      kind: 'open',
      at: 360,
      fired: { 360: '2026-09-17' },
    });
  });

  it('sends nothing while the window is open, and still marks the time as done', () => {
    expect(tick({ now: '09:00:00', fired: { 360: '2026-09-16' }, windowOpen: true })).toEqual({
      kind: 'skip',
      at: 540,
      fired: { 360: '2026-09-16', 540: '2026-09-16' },
    });
  });

  it('acts once on the latest when several are due, marking them all', () => {
    // A machine asleep from 05:00 to 15:00: three times came round, and one window is what they
    // add up to.
    expect(tick({ now: '15:00:00' })).toEqual({
      kind: 'open',
      at: 840,
      fired: { 360: '2026-09-16', 540: '2026-09-16', 840: '2026-09-16' },
    });
  });

  it('crosses midnight: yesterday having fired says nothing about today', () => {
    const yesterday = { 0: '2026-09-16' };
    const action = scheduleTick({
      at: [0],
      fired: yesterday,
      nowMs: at('2026-09-17', '00:00:10'),
      offsetMinutes: JST,
      windowOpen: false,
    });
    expect(action).toEqual({ kind: 'open', at: 0, fired: { 0: '2026-09-17' } });
  });

  it('leaves the map it was given alone', () => {
    const fired: FiredTimes = {};
    tick({ now: '06:00:00', fired });
    expect(fired).toEqual({});
  });
});

describe('nextScheduleTime', () => {
  const AT = [360, 540, 840];
  const cases: { now: string; want: number | null; why: string }[] = [
    { now: '00:30:00', want: 360, why: 'before them all' },
    { now: '06:00:00', want: 540, why: 'the one just fired is behind; the next is next' },
    { now: '07:00:00', want: 540, why: 'between two' },
    { now: '23:00:00', want: 360, why: 'past the last, so tomorrow morning' },
  ];
  for (const c of cases) {
    it(`${c.now} -> ${String(c.want)}: ${c.why}`, () => {
      expect(nextScheduleTime(AT, at('2026-09-16', c.now), JST)).toBe(c.want);
    });
  }

  it('has no answer for an empty list', () => {
    expect(nextScheduleTime([], Date.now(), JST)).toBeNull();
  });
});
