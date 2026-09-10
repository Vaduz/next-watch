import { describe, expect, it } from 'bun:test';
import { paneBudget, scrollMaxOf, visibleSlice, watchLayout } from './layout.js';

describe('watchLayout', () => {
  it('takes the frame width from the terminal, minus the borders', () => {
    expect(watchLayout(120).width).toBe(118);
  });

  it('falls back to a default when the width cannot be read (a pipe, a redirect)', () => {
    expect(watchLayout(undefined).width).toBe(98);
  });

  it('keeps a minimum width on a narrow terminal', () => {
    expect(watchLayout(40).width).toBe(72);
  });

  it('gives the spare width of a wide terminal to the name columns', () => {
    expect(watchLayout(200).subject).toBeGreaterThan(watchLayout(100).subject);
    expect(watchLayout(200).service).toBeGreaterThan(watchLayout(100).service);
  });
});

describe('paneBudget', () => {
  const have = { event: 30, admin: 30, web: 30 };

  it('uses an explicit row count, capped by what the pane holds', () => {
    expect(paneBudget(watchLayout(120, 40, 5, 3), 20, have)).toEqual({ event: 5, admin: 3, web: 3 });
    expect(paneBudget(watchLayout(120, 40, 5, 3), 20, { event: 2, admin: 1, web: 0 })).toEqual({
      event: 2,
      admin: 1,
      web: 0,
    });
  });

  it('divides the remaining height otherwise, weighted towards the events', () => {
    // Height 40, body 20 rows, frame 7 rows -> 13 rows split as event 7 and access 3 + 3.
    const budget = paneBudget(watchLayout(120, 40), 20, have);
    expect(budget.event).toBe(7);
    expect(budget.admin).toBe(3);
    expect(budget.web).toBe(3);
    expect(budget.event + budget.admin + budget.web).toBeLessThanOrEqual(13);
  });

  it('gives every pane nothing when the body already fills the terminal', () => {
    expect(paneBudget(watchLayout(120, 20), 30, have)).toEqual({ event: 0, admin: 0, web: 0 });
  });

  it('caps the automatic split however tall the terminal is', () => {
    const budget = paneBudget(watchLayout(120, 300), 10, { event: 999, admin: 999, web: 999 });
    expect(budget.event).toBe(20);
    expect(budget.admin).toBe(20);
  });

  it('drops a pane asked for zero rows', () => {
    expect(paneBudget(watchLayout(120, 40, 0, 0), 10, have)).toEqual({ event: 0, admin: 0, web: 0 });
  });
});

// The split used to be written for exactly two access panes. These pin it at other counts.
describe('paneBudget with a different number of servers', () => {
  it('gives the events the whole height when there is only the event pane', () => {
    // Height 40, body 20, frame 5 (one pane) -> all 15 rows go to the events.
    const budget = paneBudget(watchLayout(120, 40), 20, { event: 30 });
    expect(budget).toEqual({ event: 15 });
  });

  it('gives one access pane the whole remainder rather than half of it', () => {
    const budget = paneBudget(watchLayout(120, 40), 20, { event: 30, web: 30 });
    // Height 40, body 20, frame 6 (two panes) -> 14 rows: event 7, then all 7 to the one pane.
    expect(budget.event).toBe(7);
    expect(budget.web).toBe(7);
  });

  it('divides the remainder among however many access panes there are', () => {
    const budget = paneBudget(watchLayout(120, 40), 10, { event: 30, a: 30, b: 30, c: 30, d: 30 });
    const access = [budget.a, budget.b, budget.c, budget.d];
    expect(new Set(access).size).toBe(1);
    expect(budget.event + access.reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(
      40 - 10 - (4 + 5), // height - body - frame chrome for five panes
    );
  });

  it('gives a pane nothing when it holds nothing, whatever the split says', () => {
    expect(paneBudget(watchLayout(120, 40), 10, { event: 30, a: 0, b: 4 })).toMatchObject({ a: 0, b: 4 });
  });
});

describe('visibleSlice / scrollMaxOf', () => {
  const rows = [1, 2, 3, 4, 5];

  it('takes from the end when nothing is scrolled back', () => {
    expect(visibleSlice(rows, 2, 0)).toEqual([4, 5]);
  });

  it('moves towards the older rows as it scrolls back', () => {
    expect(visibleSlice(rows, 2, 2)).toEqual([2, 3]);
  });

  it('does not scroll past what exists', () => {
    expect(visibleSlice(rows, 2, 99)).toEqual([1, 2]);
  });

  it('shows nothing for a pane with no rows', () => {
    expect(visibleSlice(rows, 0, 0)).toEqual([]);
  });

  it('cannot scroll a pane whose rows all fit', () => {
    expect(scrollMaxOf(3, 5)).toBe(0);
    expect(scrollMaxOf(30, 5)).toBe(25);
  });
});

describe('paneBudget when one pane fills the frame', () => {
  const have = { event: 100, admin: 100, web: 100 };

  it('gives the whole frame to the focused pane', () => {
    const budget = paneBudget(watchLayout(120, 40), 20, have, 'admin');
    expect(budget.event).toBe(0);
    expect(budget.web).toBe(0);
    expect(budget.admin).toBeGreaterThan(20);
  });

  it('ignores the body height, because the body is not drawn', () => {
    const layout = watchLayout(120, 40);
    expect(paneBudget(layout, 30, have, 'event')).toEqual(paneBudget(layout, 5, have, 'event'));
  });

  it('still shows no more rows than the pane holds', () => {
    expect(paneBudget(watchLayout(120, 60), 0, { event: 3, admin: 0, web: 0 }, 'event').event).toBe(3);
  });
});
