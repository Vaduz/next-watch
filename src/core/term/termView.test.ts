// The vocabulary the screen is drawn with: colour, columns, the frame, one event row.
import { describe, expect, it } from 'bun:test';
import { bar, clockAt, eventLine, formatUptime, painter, renderCells } from './termView.js';
import { displayWidth } from './textWidth.js';

const plain = painter(false);
/** 2026-08-19 19:42:07 at UTC+9. */
const NOW = Date.parse('2026-08-19T10:42:07Z');
const JST = 9 * 60;

describe('painter', () => {
  it('passes text through when colour is off, so nothing reaches a pipe', () => {
    expect(plain('up', 'ok')).toBe('up');
  });

  it('wraps text in escapes when colour is on, without changing its width', () => {
    const colored = painter(true)('up', 'ok');
    expect(colored).not.toBe('up');
    expect(displayWidth(colored)).toBe(2);
  });
});

describe('clockAt', () => {
  it('uses the given offset rather than the host time zone', () => {
    expect(clockAt(NOW, JST)).toBe('19:42:07');
    expect(clockAt(NOW, 0)).toBe('10:42:07');
    expect(clockAt(NOW, -5 * 60)).toBe('05:42:07');
  });
});

describe('bar', () => {
  it('keeps the same width at every percentage, so the column never steps', () => {
    for (const percent of [0, 3, 26, 50, 99, 100]) {
      expect(displayWidth(bar(percent, 12))).toBe(12);
    }
  });

  it('does not break the width above 100', () => {
    expect(displayWidth(bar(130, 8))).toBe(8);
  });
});

describe('formatUptime', () => {
  it('shows at most two units', () => {
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(32 * 60)).toBe('32m');
    expect(formatUptime(3600 + 22 * 60)).toBe('1h22m');
    expect(formatUptime(3 * 86400 + 4 * 3600)).toBe('3d4h');
  });

  it('drops the smaller unit when it is zero', () => {
    expect(formatUptime(2 * 3600)).toBe('2h');
    expect(formatUptime(2 * 86400)).toBe('2d');
  });

  it('has no answer for missing or negative input', () => {
    expect(formatUptime(null)).toBe('-');
    expect(formatUptime(-1)).toBe('-');
  });
});

describe('renderCells', () => {
  it('lines up the start of each column even when a cell contains CJK', () => {
    const lines = renderCells(
      [
        [{ text: 'admin' }, { text: 'prod' }],
        [{ text: '見張り' }, { text: 'dev' }],
      ],
      plain,
    );
    const heads = lines.map(l => displayWidth(l.slice(0, l.lastIndexOf(' ') + 1)));
    expect(heads[0]).toBe(heads[1]);
  });
});

describe('eventLine', () => {
  it('is time, mark and text, and nothing else prints in another shape', () => {
    expect(eventLine(clockAt(NOW, JST), 'change', 'pulled 4 commits', plain)).toBe('  19:42:07 ⇣ pulled 4 commits');
  });

  it('gives each kind its own glyph, so the left edge alone reads', () => {
    const marks = ['change', 'step', 'task', 'session', 'prompt', 'rename', 'warn', 'error', 'info'] as const;
    const glyphs = marks.map(m => eventLine('19:42:07', m, 'x', plain).slice(11, 12));
    expect(new Set(glyphs).size).toBe(marks.length);
  });
});
