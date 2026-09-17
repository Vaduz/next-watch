// A session that is not in a tmux pane says so, because the restart verb it is missing would
// otherwise look like a bug in the watcher rather than a fact about the session.
import { describe, expect, it } from 'bun:test';
import { NO_TMUX_NOTE, sessionRestartNote } from './sessionNote.js';
import { sessionBlock } from './blocks.js';
import { watchTargets } from '../watchTargets/targets.js';
import type { AgentSessionRow, WatchPanel } from '../types.js';
import type { WatchView } from './index.js';

const session = (over: Partial<AgentSessionRow> = {}): AgentSessionRow => ({
  pid: 3658196,
  agent: 'claude',
  name: 'fix the panel layout',
  tree: 'site',
  status: 'idle',
  model: 'opus-5',
  contextTokens: 31_000,
  idleSeconds: 24,
  statusAtMs: 1_000,
  version: '2.1.273',
  ...over,
});

describe('sessionRestartNote', () => {
  const cases: { name: string; row: AgentSessionRow; want: string | null }[] = [
    { name: 'in a tmux pane', row: session({ pane: '%3', resume: 'claude --resume abc' }), want: null },
    { name: 'not in a tmux pane', row: session({ pane: null }), want: NO_TMUX_NOTE },
    // ⚠️ A machine with no tmux at all answers the same, because `paneOfPid` finds no pane
    // either way. The note names what is missing rather than guessing which caused it.
    {
      name: 'tmux not installed, so no pane was found for anything',
      row: session({ pane: undefined }),
      want: NO_TMUX_NOTE,
    },
    {
      // It is offered no verbs at all, so naming one it does not have would only confuse.
      name: "the watcher's own session",
      row: session({ self: true, pane: null }),
      want: null,
    },
    {
      // A pane with nothing to type back is still a pane: the note is about tmux, and this row
      // is missing its resume command instead, which is not something tmux would fix.
      name: 'in a pane but with no resume command',
      row: session({ pane: '%3', resume: null }),
      want: null,
    },
  ];
  for (const c of cases) {
    it(`${c.name} -> ${String(c.want)}`, () => {
      expect(sessionRestartNote(c.row)).toBe(c.want);
    });
  }
});

const view: WatchView = { selected: null, focus: null, index: 0 } as unknown as WatchView;
const plain = (text: string): string => text;

describe('sessionBlock, the note under a row', () => {
  const panel = (sessions: AgentSessionRow[]): WatchPanel => ({ sessions, versions: [] }) as unknown as WatchPanel;

  it('hangs the note under the SESSION column, on its own line', () => {
    const lines = sessionBlock(panel([session({ pane: null })]), plain, view);

    expect(lines).toHaveLength(4); // heading, title, metadata, note
    expect(lines[3]).toContain(NO_TMUX_NOTE);
    expect(lines[3].startsWith(' '.repeat(10))).toBe(true);
  });

  it('says nothing for a session that has a pane', () => {
    const lines = sessionBlock(panel([session({ pane: '%3', resume: 'claude --resume abc' })]), plain, view);

    expect(lines).toHaveLength(3);
    expect(lines.join('\n')).not.toContain('tmux');
  });

  // ⚠️ The reason the note is a line of its own rather than a word in `STATUS`: `renderCells`
  // pads every column to its widest cell, so one session's note would widen that column on every
  // row of the table.
  it('does not widen the STATUS column for the rows that have no note', () => {
    const both = sessionBlock(
      panel([session({ pane: null }), session({ pid: 2, pane: '%3', resume: 'x' })]),
      plain,
      view,
    );
    const only = sessionBlock(panel([session({ pid: 2, pane: '%3', resume: 'x' })]), plain, view);

    expect(both[0]).toBe(only[0]);
  });
});

describe('the restart verb and the note agree', () => {
  const targetsFor = (row: AgentSessionRow): readonly string[] => {
    const panel = {
      ssh: null,
      servers: [],
      tasks: [],
      sessions: [row],
      services: [],
      versions: [],
      access: {},
    } as unknown as WatchPanel;
    return watchTargets(panel).find(t => t.kind === 'session')?.verbs ?? [];
  };

  it('offers restart exactly when there is no note', () => {
    const inPane = session({ pane: '%3', resume: 'claude --resume abc' });
    const outside = session({ pane: null });

    expect(targetsFor(inPane)).toContain('restart');
    expect(sessionRestartNote(inPane)).toBeNull();
    expect(targetsFor(outside)).not.toContain('restart');
    expect(sessionRestartNote(outside)).toBe(NO_TMUX_NOTE);
    // Stopping one still works wherever it runs.
    expect(targetsFor(outside)).toContain('stop');
  });
});
