/** **When a scheduled quota session fires.** Pure.
 *
 *  `quotaSession: true` opens the five-hour window whenever it is found closed, which keeps one
 *  open around the clock. A person who works office hours does not want that: a window opened at
 *  04:00 is spent by 09:00, and the day holds a fixed number of them. `at: ['09:00', '14:00']`
 *  says when a window should begin instead, and **turns the automatic mode off** — between the
 *  listed times a closed window stays closed.
 *
 *  ⚠️ No clock read. The current time arrives as `nowMs`, and the zone as the watch's
 *  `timezoneOffsetMinutes`, so the times mean what the person reading the screen means by them.
 *
 *  The firing decision takes the window's state as an argument rather than the quota cards, so
 *  the same decision serves any CLI with a five-hour window. */
import { dayAt, minuteOfDayAt } from '../term/index.js';

/** A listed time, as minutes since midnight in the watch's clock. */
export type ScheduledTime = number;

/** Which day each listed time last fired on, keyed by the time. The day is the watch clock's
 *  `YYYY-MM-DD`, which is what makes "once per listed time per day" arithmetic rather than a
 *  timer, and what makes it survive a watch that runs for a week. */
export type FiredTimes = Readonly<Record<number, string>>;

/** 24-hour `HH:MM`, both fields padded. `9:00` is refused rather than read as 09:00: a config
 *  that is written one way in one line and another way in the next is a config whose author is
 *  guessing at the format. */
const TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** Read the listed times, or say what is wrong with them. `where` names the source (the config
 *  file's path, or the flag), because the commonest mistake is not knowing which of the two the
 *  watcher actually read. */
export function parseScheduleTimes(at: readonly unknown[], where: string): ScheduledTime[] {
  if (at.length === 0) {
    throw new Error(`${where}: quotaSession.at needs at least one time, or leave it out for the automatic mode`);
  }
  const minutes: ScheduledTime[] = [];
  for (const raw of at) {
    if (typeof raw !== 'string') {
      throw new Error(`${where}: quotaSession.at takes times as strings like "09:00", not ${JSON.stringify(raw)}`);
    }
    const found = TIME.exec(raw.trim());
    if (found === null) {
      throw new Error(`${where}: "${raw}" is not a time - write it as HH:MM on a 24-hour clock ("09:00", not "9:00")`);
    }
    const value = Number(found[1]) * 60 + Number(found[2]);
    // Two entries for one time would fire once and leave the author believing it fired twice.
    if (minutes.includes(value)) throw new Error(`${where}: "${raw}" is listed twice in quotaSession.at`);
    minutes.push(value);
  }
  return minutes.sort((a, b) => a - b);
}

/** A listed time back as `HH:MM`, which is how the screen and the log say it. */
export function formatScheduleTime(minutes: ScheduledTime): string {
  const hour = Math.floor(minutes / 60);
  return `${String(hour).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The listed times that are already behind the clock, marked as done for today.
 *
 *  ⚠️ **No catch-up.** A watch started at 15:00 must not fire this morning's three times one
 *  after another: they would open one window between them and spend three messages doing it,
 *  and the person who listed 09:00 wanted a window at 09:00, not at 15:00. The times behind the
 *  clock are therefore marked as though they had fired, and the next listed time is the next
 *  thing that happens.
 *
 *  A time counts as behind only once the clock has **moved past its minute**, so a watch started
 *  at 09:00:30 still opens the 09:00 window: the schedule asked for one at 09:00 and none has
 *  been sent. */
export function armSchedule(at: readonly ScheduledTime[], nowMs: number, offsetMinutes: number): FiredTimes {
  const today = dayAt(nowMs, offsetMinutes);
  const now = minuteOfDayAt(nowMs, offsetMinutes);
  const fired: Record<number, string> = {};
  for (const time of at) if (time < now) fired[time] = today;
  return fired;
}

/** What one look at the clock decides. `fired` comes back updated, so the caller writes it back
 *  instead of doing the arithmetic itself. */
export type ScheduleAction =
  | { kind: 'idle' }
  /** A listed time has come round and the window is closed: open it. */
  | { kind: 'open'; at: ScheduledTime; fired: FiredTimes }
  /** The same, but a window is already open. Nothing is sent — a message cannot reset an open
   *  window, so sending would only spend one. */
  | { kind: 'skip'; at: ScheduledTime; fired: FiredTimes };

/** Whether a listed time has come round, and what to do about it.
 *
 *  "At 09:00" means **the first look at or after 09:00 that day**, so a look that lands late
 *  still fires, exactly once. Several due at once means the machine was asleep or suspended
 *  across them; they are all marked as done and only the **latest** is acted on, because one
 *  window is what they add up to. */
export function scheduleTick(o: {
  at: readonly ScheduledTime[];
  fired: FiredTimes;
  nowMs: number;
  offsetMinutes: number;
  /** Whether the five-hour window is open, decided by the caller from whatever it can read. */
  windowOpen: boolean;
}): ScheduleAction {
  const today = dayAt(o.nowMs, o.offsetMinutes);
  const now = minuteOfDayAt(o.nowMs, o.offsetMinutes);
  const due = o.at.filter(time => time <= now && o.fired[time] !== today);
  if (due.length === 0) return { kind: 'idle' };
  const fired: Record<number, string> = { ...o.fired };
  for (const time of due) fired[time] = today;
  return { kind: o.windowOpen ? 'skip' : 'open', at: Math.max(...due), fired };
}

/** The next listed time, today's if one is still ahead and otherwise tomorrow's first. Null
 *  only for an empty list, which the parser refuses anyway. */
export function nextScheduleTime(
  at: readonly ScheduledTime[],
  nowMs: number,
  offsetMinutes: number,
): ScheduledTime | null {
  if (at.length === 0) return null;
  const now = minuteOfDayAt(nowMs, offsetMinutes);
  const ahead = at.filter(time => time > now);
  // Strictly ahead: the minute that has just fired is behind, and its next turn is tomorrow.
  return ahead.length > 0 ? Math.min(...ahead) : Math.min(...at);
}
