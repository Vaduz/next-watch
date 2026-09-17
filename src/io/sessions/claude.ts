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
 *  stay behind — dozens of them — and over the months a watch runs, their pids come round again
 *  and are handed to something else. So three things have to agree before a row is drawn, and
 *  `core`'s `isLiveSession` is where the three are weighed.
 *
 *  ⚠️ **The transcript is never read whole.** One of them passes 1.7MB, and this runs every
 *  time the panel is drawn; reading all of it would make the watcher heavy. A fixed amount of
 *  the tail is enough (`TRANSCRIPT_TAIL_BYTES`). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSignalable, procStartTicks, uptimeByPid, type ProcInfo } from '../processes.js';
import { readTail } from '../fileWindow.js';
import {
  claudeResumeCommand,
  isInteractiveSession,
  isLiveSession,
  parseAgentSession,
  toSessionRow,
  type AgentSessionRecord,
} from '../../core/sessions/claude.js';
import { isInteractiveClaudeCommand, unrecordedSessionRow } from '../../core/sessions/unrecorded.js';
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

/** The pids whose session really is still running. **What counts as still running is
 *  `isLiveSession`**; all this does is gather the three pieces of evidence it reads. */
function livePids(records: readonly AgentSessionRecord[], procs: readonly ProcInfo[], psFailed: boolean): Set<number> {
  if (!records.length) return new Set();
  const commands = new Map(procs.map(p => [p.pid, p.command]));
  const live = new Set<number>();
  for (const r of records) {
    const signalable = isSignalable(r.pid);
    const evidence = {
      signalable,
      // A file read per record, and there are dozens of dead ones, so `/proc` is only opened
      // for a pid that answered the cheaper check first.
      procStartTicks: signalable ? procStartTicks(r.pid) : null,
      command: commands.get(r.pid),
      psFailed,
    };
    if (isLiveSession(r, evidence)) live.add(r.pid);
  }
  return live;
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
 *  tmux are each run once per look rather than once per agent. `psFailed` says whether `procs`
 *  is empty because nothing matched or because `ps` did not run, which is the difference
 *  between a pid being dead and being unknown. */
export function liveClaudeSessions(
  nowMs: number,
  procs: readonly ProcInfo[],
  own: ReadonlySet<number>,
  panes: readonly TmuxPane[] = [],
  psFailed = false,
): AgentSessionRow[] {
  const records = readSessionRecords().filter(isInteractiveSession);
  const alive = livePids(records, procs, psFailed);
  const rows = records
    .filter(r => alive.has(r.pid))
    .map(r =>
      toSessionRow(r, nowMs, {
        ...cachedTip(r.cwd, r.sessionId),
        self: own.has(r.pid),
        ...restartWay(r, procs, panes),
      }),
    );
  return [...rows, ...unrecordedClaudeSessions(procs, own, new Set(rows.map(r => r.pid)))];
}

/** Where a process is running, from `/proc`. **Linux only**, and null everywhere else — which is
 *  the same limit the Codex half already has. */
function cwdOf(pid: number): string | null {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/** The live `claude` processes the CLI wrote **no session record** for.
 *
 *  ⚠️ These are real sessions spending real quota, and before this they were absent from a
 *  section that promises every live session on the machine. See `core/sessions/unrecorded.ts`
 *  for why they have no record and why their cells are empty rather than dashed.
 *
 *  Anything the watcher started itself is left out: `claude -p "hi"` opens a quota window and
 *  `claude update` installs a release, and neither is somebody's session. */
export function unrecordedClaudeSessions(
  procs: readonly ProcInfo[],
  own: ReadonlySet<number>,
  recorded: ReadonlySet<number>,
): AgentSessionRow[] {
  const found = procs.filter(p => !recorded.has(p.pid) && isInteractiveClaudeCommand(p.command));
  if (!found.length) return [];
  const uptimes = uptimeByPid(found.map(p => p.pid));
  return found.map(p =>
    unrecordedSessionRow({
      pid: p.pid,
      cwd: cwdOf(p.pid),
      startedSecondsAgo: uptimes.get(p.pid) ?? null,
      self: own.has(p.pid),
    }),
  );
}
