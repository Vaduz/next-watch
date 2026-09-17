// A live `claude` the CLI wrote no session record for. It is spending the same quota as any
// other session, and the section promises every live session on this machine — so it gets a row,
// with the cells the record would have filled left empty rather than invented.
import { describe, expect, it } from 'bun:test';
import { NO_RECORD_STATUS, isInteractiveClaudeCommand, treeOfCwd, unrecordedSessionRow } from './unrecorded.js';
import { sessionRestartNote, noRecordNote, NO_TMUX_NOTE } from '../view/sessionNote.js';
import { sessionBlock } from '../view/blocks.js';
import { watchTargets } from '../watchTargets/targets.js';
import type { WatchPanel } from '../types.js';
import type { WatchView } from '../view/index.js';

describe('isInteractiveClaudeCommand', () => {
  const cases: { name: string; command: string; want: boolean }[] = [
    { name: 'a bare claude', command: 'claude', want: true },
    { name: 'a full path', command: '/home/user/.local/bin/claude', want: true },
    { name: 'a resumed session', command: 'claude --resume 4d717cc5-942a-496a-a5e8-1e44c364bf66', want: true },
    { name: 'a model chosen on the command line', command: 'claude --model opus-5', want: true },
    // ⚠️ The two rows this filter exists for: next-watch runs both of these itself, and counting
    // either as somebody's session would put the watcher's own work in the table.
    { name: 'the message that opens a quota window', command: 'claude -p hi', want: false },
    { name: 'the same, written out', command: 'claude --print hi', want: false },
    { name: 'the same, with an equals', command: 'claude --print=hi', want: false },
    { name: 'an update the watcher started', command: 'claude update', want: false },
    { name: 'another one-shot subcommand', command: 'claude doctor', want: false },
    { name: 'mcp management', command: 'claude mcp list', want: false },
    // A flag's value is not a subcommand, and a prompt that mentions one is not either.
    { name: 'a flag whose value looks like a subcommand', command: 'claude --model update', want: true },
    { name: 'something else entirely', command: 'node server.mjs', want: false },
    { name: 'a program whose name merely ends in claude', command: 'notclaude', want: false },
    { name: 'nothing at all', command: '', want: false },
  ];
  for (const c of cases) {
    it(`${c.name} -> ${String(c.want)}`, () => {
      expect(isInteractiveClaudeCommand(c.command)).toBe(c.want);
    });
  }
});

describe('treeOfCwd', () => {
  const cases: [cwd: string | null, want: string][] = [
    ['/home/user/Code/site', 'site'],
    ['/home/user/Code/site/', 'site'],
    ['/', '/'],
    [null, '-'],
  ];
  for (const [cwd, want] of cases) {
    it(`${String(cwd)} -> ${want}`, () => {
      expect(treeOfCwd(cwd)).toBe(want);
    });
  }
});

describe('unrecordedSessionRow', () => {
  const row = unrecordedSessionRow({ pid: 871312, cwd: '/tmp/nw-shot/site', startedSecondsAgo: 7200, self: false });

  it('names the process, since there is no session name to use', () => {
    expect(row.name).toBe('(no record) pid 871312');
    expect(row.tree).toBe('site');
    expect(row.agent).toBe('claude');
  });

  it('says why the row is thin rather than inventing a state', () => {
    expect(row.status).toBe(NO_RECORD_STATUS);
  });

  // Everything the record would have carried. Null here becomes an empty cell, not a dash.
  it('leaves the model, context, idle time and version unknown', () => {
    expect([row.model, row.contextTokens, row.idleSeconds, row.version, row.statusAtMs]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(row.unrecorded).toBe(true);
  });

  // ⚠️ No record means no session id, so there is nothing to type into a pane — whether or not
  // the process happens to be inside one.
  it('offers no way to restart it', () => {
    expect(row.pane).toBeNull();
    expect(row.resume).toBeNull();
  });
});

const view: WatchView = { selected: null, focus: null, index: 0 } as unknown as WatchView;
const plain = (text: string): string => text;
const panel = (rows: ReturnType<typeof unrecordedSessionRow>[]): WatchPanel =>
  ({ sessions: rows, versions: [] }) as unknown as WatchPanel;

describe('how the row is drawn', () => {
  const row = unrecordedSessionRow({ pid: 871312, cwd: '/tmp/site', startedSecondsAgo: 7200, self: false });

  it('leaves the unknown cells empty instead of dashing them', () => {
    const lines = sessionBlock(panel([row]), plain, view);

    // The metadata line carries the tree, the agent and the status, and nothing else.
    expect(lines[2]).toContain('site');
    expect(lines[2]).toContain('claude');
    expect(lines[2]).toContain(NO_RECORD_STATUS);
    expect(lines[2]).not.toContain('-');
  });

  it('hangs a note saying why, with how long it has been running', () => {
    const lines = sessionBlock(panel([row]), plain, view);

    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('no session record');
    expect(lines[3]).toContain('started 2h ago');
  });
});

describe('the note replaces the tmux one', () => {
  // ⚠️ Such a session may well be inside a pane. Saying `(r)estart needs tmux` there would name
  // the wrong reason — restart is unavailable because there is no session id to resume.
  it('says nothing about tmux, in a pane or out of one', () => {
    const outside = unrecordedSessionRow({ pid: 1, cwd: '/tmp/site', startedSecondsAgo: 60, self: false });
    const inside = { ...outside, pane: '%3' };

    for (const row of [outside, inside]) {
      const note = sessionRestartNote(row, '1m');
      expect(note).not.toBe(NO_TMUX_NOTE);
      expect(note).not.toContain('tmux');
      expect(note).toBe(noRecordNote('1m'));
    }
  });

  it('drops the elapsed time when it could not be read', () => {
    expect(noRecordNote(null)).toBe('no session record · nothing to resume, so no (r)estart');
  });

  it("says nothing at all about the watcher's own session", () => {
    const self = unrecordedSessionRow({ pid: 1, cwd: '/tmp/site', startedSecondsAgo: 60, self: true });
    expect(sessionRestartNote(self, '1m')).toBeNull();
  });
});

describe('the verbs such a row is offered', () => {
  it('can be stopped but not restarted', () => {
    const row = unrecordedSessionRow({ pid: 871312, cwd: '/tmp/site', startedSecondsAgo: 60, self: false });
    const full = {
      ssh: null,
      servers: [],
      tasks: [],
      sessions: [row],
      services: [],
      versions: [],
      access: {},
    } as unknown as WatchPanel;

    const verbs = watchTargets(full).find(t => t.kind === 'session')?.verbs ?? [];
    expect(verbs).toEqual(['stop']);
  });
});
