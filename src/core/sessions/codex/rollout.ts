/** **One line of a rollout**, and the `session_meta` on the first line.
 *
 *  This is where the file's shape is understood; what to take out of it — the name, the state,
 *  the context size — belongs to `tip.ts`. */
import { asRecord } from '../../util.js';
import { str } from '../codex.js';

/** What is read out of the first line. */
export interface CodexSessionMeta {
  /** This thread's id. **`id`, not `session_id`**: a subagent's `session_id` is its parent's. */
  threadId: string;
  cwd: string;
  /** The CLI version it started with. */
  cliVersion: string | null;
  /** Where it came from: a person's terminal, or a programmatic invocation. */
  originator: string | null;
  /** Whether a person is talking to it, or it is a subagent. */
  threadSource: string | null;
  parentThreadId: string | null;
  startedAtMs: number | null;
}

/** Read one line. Null unless it has the `{ timestamp, type, payload }` shape. */
export function parseRolloutLine(
  line: string,
): { atMs: number | null; type: string; payload: Record<string, unknown> } | null {
  if (line === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const o = asRecord(parsed);
  if (o === null) return null;
  const type = str(o.type);
  const payload = asRecord(o.payload);
  if (type === null || payload === null) return null;
  const at = str(o.timestamp);
  const atMs = at === null ? null : Date.parse(at);
  return { atMs: atMs === null || Number.isNaN(atMs) ? null : atMs, type, payload };
}

/** Read the first line. Without a readable thread id it is **not a session** and returns null. */
export function parseCodexSessionMeta(line: string): CodexSessionMeta | null {
  const record = parseRolloutLine(line);
  if (record?.type !== 'session_meta') return null;
  const p = record.payload;
  const threadId = str(p.id) ?? str(p.session_id);
  if (threadId === null) return null;
  const startedAt = str(p.timestamp);
  const startedAtMs = startedAt === null ? null : Date.parse(startedAt);
  return {
    threadId,
    cwd: str(p.cwd) ?? '',
    cliVersion: str(p.cli_version),
    originator: str(p.originator),
    threadSource: str(p.thread_source),
    parentThreadId: str(p.parent_thread_id),
    startedAtMs: startedAtMs === null || Number.isNaN(startedAtMs) ? null : startedAtMs,
  };
}

/** Whether a thread belongs in the list: programmatic invocations and subagents are dropped,
 *  for the reasons in the parent module. */
export function isInteractiveCodexSession(m: CodexSessionMeta): boolean {
  return m.originator !== 'codex_exec' && m.threadSource !== 'subagent' && m.parentThreadId === null;
}
