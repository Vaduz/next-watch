/** Finding the live Claude Code sessions **on the filesystem**.
 *
 *  Two sources, both written by the CLI itself:
 *
 *   1. `~/.claude/sessions/<pid>.json` — pid, cwd, session name, state (busy / idle / shell /
 *      waiting).
 *   2. `~/.claude/projects/<slug>/<sessionId>.jsonl` — the conversation. Only its **tail** is
 *      read, for the model and how much context the last reply carried.
 *
 *  **A json file existing does not mean the session is alive.** The files of sessions that died
 *  stay behind, so the pid has to be alive *and* the process at that pid has to be a `claude`
 *  (over a watch lasting days, pids are reused).
 *
 *  ⚠️ **The transcript is never read whole.** One of them passes 1.7MB, and this runs every
 *  time the panel is drawn; reading all of it would make the watcher heavy. A fixed amount of
 *  the tail is enough (`TRANSCRIPT_TAIL_BYTES`). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAlive, type ProcInfo } from '../processes.js';
import { readTail } from '../fileWindow.js';
import {
  claudeResumeCommand,
  isInteractiveSession,
  parseAgentSession,
  toSessionRow,
  type AgentSessionRecord,
} from '../../core/sessions/claude.js';
import { restartablePane, type TmuxPane } from '../../core/tmuxPanes.js';
import type { AgentSessionRow } from '../../core/types.js';
import { asRecord } from '../../core/util.js';

/** How much of the transcript's tail to read. One recent reply is all this needs. */
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

const claudeHome = (): string => path.join(os.homedir(), '.claude');

/** Read `~/.claude/sessions/*.json`. Anything unreadable or malformed is skipped in silence. */
function readSessionRecords(): AgentSessionRecord[] {
  const dir = path.join(claudeHome(), 'sessions');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: AgentSessionRecord[] = [];
  for (const name of names) {
    // The same directory also holds `<pid>.<hex>.key`, so the extension decides.
    if (!name.endsWith('.json')) continue;
    try {
      const record = parseAgentSession(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (record !== null) out.push(record);
    } catch {
      /* skip what cannot be read */
    }
  }
  return out;
}

/** The pids that are alive **and are a claude** (see the file's note on reused pids). */
function livePids(records: readonly AgentSessionRecord[], procs: readonly ProcInfo[]): Set<number> {
  const candidates = records.filter(r => isAlive(r.pid)).map(r => r.pid);
  if (!candidates.length) return new Set();
  const commands = new Map(procs.map(p => [p.pid, p.command]));
  return new Set(
    candidates.filter(pid => {
      const command = commands.get(pid);
      // Where ps could not be read, being alive is enough: a missing column beats a missing
      // section.
      return command === undefined || /(^|\/)claude(\s|$)/.test(command);
    }),
  );
}

/** Where the transcript is. The project slug is the cwd with its separators replaced. */
function transcriptPath(cwd: string, sessionId: string): string {
  const slug = cwd.replace(/[/.]/g, '-');
  return path.join(claudeHome(), 'projects', slug, `${sessionId}.jsonl`);
}

/** What was read from a transcript, kept so the same tail is not re-read every second. The key
 *  is the file's size: a conversation that has not grown gives the same answer. */
const tipCache = new Map<string, { size: number; tip: TranscriptTip }>();

interface TranscriptTip {
  model: string | null;
  contextTokens: number | null;
}

/** The model and the context size from the **last reply on the main thread**.
 *
 *  Lines marked `isSidechain` (a subagent) carry their own usage and would be mixed in. The
 *  context figure is `input + cache_creation + cache_read` — what that reply read, which is a
 *  guide to how full the window is, not an exact remainder. */
function transcriptTip(text: string): TranscriptTip {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"usage"') || line.includes('"isSidechain":true')) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const tip = tipFromRecord(record);
    if (tip !== null) return tip;
  }
  return { model: null, contextTokens: null };
}

function tipFromRecord(record: unknown): TranscriptTip | null {
  const m = asRecord(asRecord(record)?.message);
  if (m === null) return null;
  const usage = asRecord(m.usage);
  if (usage === null) return null;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const total = n(usage.input_tokens) + n(usage.cache_creation_input_tokens) + n(usage.cache_read_input_tokens);
  return {
    model: typeof m.model === 'string' ? m.model : null,
    contextTokens: total > 0 ? total : null,
  };
}

/** The model and context size, re-read only when the file has grown. */
function cachedTip(cwd: string, sessionId: string): TranscriptTip {
  const file = transcriptPath(cwd, sessionId);
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { model: null, contextTokens: null };
  }
  const cached = tipCache.get(file);
  if (cached?.size === size) return cached.tip;
  const tip = transcriptTip(readTail(file, TRANSCRIPT_TAIL_BYTES));
  tipCache.set(file, { size, tip });
  return tip;
}

/** Whether the conversation is still on disk. **`--resume` is what reads that file**, so
 *  offering to restart a session without one leaves nothing behind in the pane but a CLI
 *  error. */
function hasTranscript(cwd: string, sessionId: string): boolean {
  try {
    return fs.statSync(transcriptPath(cwd, sessionId)).size > 0;
  } catch {
    return false;
  }
}

/** Whether this session can be restarted: which pane it runs in, and what to type there. */
function restartWay(
  r: AgentSessionRecord,
  procs: readonly ProcInfo[],
  panes: readonly TmuxPane[],
): { pane: string | null; resume: string | null } {
  return {
    pane: restartablePane(panes, procs, r.pid)?.pane.id ?? null,
    resume: hasTranscript(r.cwd, r.sessionId) ? claudeResumeCommand(r.sessionId) : null,
  };
}

/** The live interactive sessions as rows, **with the watcher's own marked**.
 *
 *  `procs`, `own` (the pids of this process's ancestors) and `panes` are passed in, so ps and
 *  tmux are each run once per look rather than once per agent. */
export function liveClaudeSessions(
  nowMs: number,
  procs: readonly ProcInfo[],
  own: ReadonlySet<number>,
  panes: readonly TmuxPane[] = [],
): AgentSessionRow[] {
  const records = readSessionRecords().filter(isInteractiveSession);
  const alive = livePids(records, procs);
  return records
    .filter(r => alive.has(r.pid))
    .map(r =>
      toSessionRow(r, nowMs, {
        ...cachedTip(r.cwd, r.sessionId),
        self: own.has(r.pid),
        ...restartWay(r, procs, panes),
      }),
    );
}
