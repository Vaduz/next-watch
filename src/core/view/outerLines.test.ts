import { describe, expect, it } from 'bun:test';
import { painter } from '../term/index.js';
import { displayWidth } from '../term/index.js';
import { renderBanner, renderBottomLine } from './outerLines.js';

const plain = painter(false);
const NOW = Date.parse('2026-08-19T10:42:07Z');

describe('renderBanner', () => {
  it('states the interval and the panel period', () => {
    const text = renderBanner(
      {
        nowMs: NOW,
        root: '/r',
        branch: 'main',
        head: 'abcdef1234',
        intervalSeconds: 60,
        dryRun: true,
        panelSeconds: 0,
        remote: 'origin/main',
      },
      plain,
    ).join('\n');
    expect(text).toContain('git every 60s');
    expect(text).toContain('no panel');
    expect(text).toContain('dry-run');
    expect(text).toContain('watching origin/main');
  });
});

describe('renderBottomLine', () => {
  const base = { input: null, status: null, busy: null, flash: null, hint: 'Tab select', frame: 0 };

  it('shows only the controls while nothing is happening, repeating no time or uptime', () => {
    expect(renderBottomLine(base, plain, 80)).toEqual(['  ⠋ Tab select']);
  });

  it('becomes the command line while something is being typed', () => {
    const lines = renderBottomLine({ ...base, input: 'rest', hint: 'server:web  restart | stop' }, plain, 80);
    expect(lines.join('\n')).toContain('> rest');
    expect(lines.join('\n')).toContain('restart | stop');
  });

  it('gives a running action priority, so it does not go quiet for tens of seconds', () => {
    const lines = renderBottomLine({ ...base, input: 'x', busy: 'restart admin' }, plain, 80);
    expect(lines.join('\n')).toContain('busy: restart admin');
    expect(lines.join('\n')).not.toContain('> x');
  });

  it('shows a typo in place of the controls', () => {
    expect(renderBottomLine({ ...base, status: 'nothing selected' }, plain, 80).join('\n')).toContain(
      'nothing selected',
    );
  });

  it('never exceeds the width and wraps the overflow rather than losing it', () => {
    const lines = renderBottomLine({ ...base, hint: 'x'.repeat(200) }, plain, 40);
    for (const l of lines) expect(displayWidth(l)).toBeLessThanOrEqual(40);
    expect(lines.join('').replace(/\s/g, '')).toContain('x'.repeat(200));
  });

  it("shows a finished action's result in place of the controls, with the event log's glyph", () => {
    const done = renderBottomLine({ ...base, flash: { text: 'update tool:codex done 12.4s', ok: true } }, plain, 80);
    expect(done).toEqual(['  » update tool:codex done 12.4s']);
    const failed = renderBottomLine(
      { ...base, flash: { text: 'update tool:codex failed 1.2s', ok: false } },
      plain,
      80,
    );
    expect(failed).toEqual(['  ✕ update tool:codex failed 1.2s']);
  });

  it('lets a typo win over a finished result, because the keypress is newer', () => {
    const lines = renderBottomLine(
      { ...base, status: 'nothing selected', flash: { text: 'restart admin done 8.1s', ok: true } },
      plain,
      80,
    );
    expect(lines.join('\n')).toContain('nothing selected');
    expect(lines.join('\n')).not.toContain('restart admin done');
  });

  it('truncates a result to one row instead of wrapping, so the panel does not jump', () => {
    const lines = renderBottomLine({ ...base, flash: { text: `update ${'x'.repeat(200)}`, ok: false } }, plain, 40);
    expect(lines).toHaveLength(1);
    expect(displayWidth(lines[0] ?? '')).toBeLessThanOrEqual(40);
  });
});
