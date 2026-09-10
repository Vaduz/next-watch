import { describe, expect, it } from 'bun:test';
import type { CodexSessionMeta } from './rollout.js';
import { toCodexSessionRow } from './row.js';

const meta = (over: Partial<CodexSessionMeta> = {}): CodexSessionMeta => ({
  threadId: '01a02588-fc7c-7070-b611-629df45b305e',
  cwd: '/home/user/site',
  cliVersion: '0.149.0',
  originator: 'codex-tui',
  threadSource: 'user',
  parentThreadId: null,
  startedAtMs: Date.parse('2026-08-21T18:15:29.669Z'),
  ...over,
});

describe('toCodexSessionRow', () => {
  const NOW = Date.parse('2026-08-21T18:32:30.000Z');

  it('folds into one row: the tree, the elapsed time, the version it started with', () => {
    const tip = {
      status: 'busy',
      statusAtMs: Date.parse('2026-08-21T18:32:00.000Z'),
      model: 'gpt-5.6-sol',
      contextTokens: 86472,
    };
    const row = toCodexSessionRow(meta(), 2133881, tip, NOW, { name: 'fix the 404', self: false });
    expect(row).toMatchObject({
      pid: 2133881,
      agent: 'codex',
      name: 'fix the 404',
      tree: 'site',
      status: 'busy',
      model: 'gpt-5.6-sol',
      contextTokens: 86472,
      idleSeconds: 30,
      version: '0.149.0',
    });
  });

  it('carries the tmux pane and the line to type there, which a restart needs', () => {
    const tip = { status: 'idle', statusAtMs: null, model: null, contextTokens: null };
    const row = toCodexSessionRow(meta(), 2133881, tip, NOW, { name: null, self: false, pane: '%2' });
    expect(row.pane).toBe('%2');
    // The rollout is an open file, so having read it means there is something to resume.
    expect(row.resume).toBe('codex resume 01a02588-fc7c-7070-b611-629df45b305e');
  });

  it('has a null pane outside tmux, so no restart verb is offered', () => {
    const tip = { status: 'idle', statusAtMs: null, model: null, contextTokens: null };
    expect(toCodexSessionRow(meta(), 2133881, tip, NOW, { name: null, self: false }).pane).toBeNull();
  });

  it('falls back to the head of the thread id, since unnamed rows cannot be told apart', () => {
    const tip = { status: '?', statusAtMs: null, model: null, contextTokens: null };
    const row = toCodexSessionRow(meta(), 1, tip, NOW, { name: null, self: false });
    expect(row.name).toBe('(01a02588)');
    // With no status timestamp, the elapsed time is measured from when it started.
    expect(row.idleSeconds).toBe(Math.round((NOW - (meta().startedAtMs ?? 0)) / 1000));
  });
});
