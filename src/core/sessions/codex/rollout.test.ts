import { describe, expect, it } from 'bun:test';
import { isInteractiveCodexSession, parseCodexSessionMeta, type CodexSessionMeta } from './rollout.js';

/** A real first line, reduced to the fields that are read. The real one carries kilobytes of
 *  base instructions, none of which matter here. */
const META = JSON.stringify({
  timestamp: '2026-08-21T18:16:00.375Z',
  ordinal: 0,
  type: 'session_meta',
  payload: {
    session_id: '01a02588-fc7c-7070-b611-629df45b305e',
    id: '01a02588-fc7c-7070-b611-629df45b305e',
    timestamp: '2026-08-21T18:15:29.669Z',
    cwd: '/home/user/site',
    originator: 'codex-tui',
    cli_version: '0.149.0',
    source: 'cli',
    thread_source: 'user',
    model_provider: 'openai',
  },
});

/** The first line of a subagent, written by the same process at the same time. Its
 *  `session_id` is **the parent's id**. */
const SUBAGENT_META = JSON.stringify({
  timestamp: '2026-08-21T18:16:22.024Z',
  type: 'session_meta',
  payload: {
    session_id: '01a02588-fc7c-7070-b611-629df45b305e',
    id: '01a02588-fcdf-75d2-a2c8-d8bf27455d4d',
    parent_thread_id: '01a02588-fc7c-7070-b611-629df45b305e',
    cwd: '/home/user/site',
    originator: 'codex-tui',
    cli_version: '0.149.0',
    source: { subagent: { other: 'guardian' } },
    thread_source: 'subagent',
  },
});

const line = (type: string, payload: object, timestamp = '2026-08-21T18:32:00.000Z'): string =>
  JSON.stringify({ timestamp, type, payload });

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

describe('parseCodexSessionMeta', () => {
  it('reads the cwd, the version and the origin from a real first line', () => {
    const m = parseCodexSessionMeta(META);
    expect(m?.threadId).toBe('01a02588-fc7c-7070-b611-629df45b305e');
    expect(m?.cwd).toBe('/home/user/site');
    expect(m?.cliVersion).toBe('0.149.0');
    expect(m?.startedAtMs).toBe(Date.parse('2026-08-21T18:15:29.669Z'));
  });

  it("takes a subagent's own id, not its parent's, which would collapse two into one", () => {
    expect(parseCodexSessionMeta(SUBAGENT_META)?.threadId).toBe('01a02588-fcdf-75d2-a2c8-d8bf27455d4d');
  });

  const rejected: { name: string; raw: string }[] = [
    { name: 'not json', raw: 'not json' },
    { name: 'empty', raw: '' },
    { name: 'not a session_meta', raw: line('event_msg', { type: 'task_started' }) },
    { name: 'no id', raw: line('session_meta', { cwd: '/x' }) },
  ];
  for (const { name, raw } of rejected) {
    it(`is not a session: ${name}`, () => {
      expect(parseCodexSessionMeta(raw)).toBeNull();
    });
  }
});

describe('isInteractiveCodexSession', () => {
  it('lists a terminal with a person at it', () => {
    expect(isInteractiveCodexSession(meta())).toBe(true);
  });

  it('does not list a programmatic invocation', () => {
    expect(isInteractiveCodexSession(meta({ originator: 'codex_exec' }))).toBe(false);
  });

  it('does not list a subagent, which would show one process as two rows', () => {
    expect(isInteractiveCodexSession(meta({ threadSource: 'subagent', parentThreadId: 'p' }))).toBe(false);
  });
});
