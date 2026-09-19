/** Turn **changes in local state into events**. Pure: no filesystem, no process, no clock.
 *
 *  The panel only says how things are now. Someone returning to the terminal after a few
 *  minutes wants to know what happened on the way there — a task started, finished or failed;
 *  an agent session appeared or went away; a prompt started; a session was renamed — and none
 *  of that is recorded anywhere. So each tick is compared with the last, and the difference
 *  becomes events.
 *
 *  Because only the difference is reported, **the first tick says nothing**. Otherwise every
 *  task and session that already existed would scroll past as "started", burying whatever
 *  actually happened.
 */
import { truncateDisplay } from './term/index.js';
import { formatUptime } from './term/index.js';
import type { AgentSessionRow, SshAgentCard, TaskRow, ToolVersionRow, WatchEvent, WatchServerRow } from './types.js';
import type { Mark, Tone } from './term/index.js';
import { sshAgentSummary } from './sshAgentView.js';
import { isBehind } from './toolVersionView.js';

/** The local state read every tick (nothing here reaches the network). */
export interface LocalSnapshot {
  servers: readonly WatchServerRow[];
  tasks: readonly TaskRow[];
  sessions: readonly AgentSessionRow[];
}

/** An event without a time; the caller attaches one. */
export interface PendingEvent {
  mark: Mark;
  text: string;
  tone?: Tone;
}

const TASK_END_TONE: Record<string, Tone> = { done: 'dim', failed: 'bad', lost: 'warn' };

/** Tasks arriving and leaving: started is one that appeared as running, ended is one that
 *  moved away from running. */
function taskEvents(prev: LocalSnapshot, next: LocalSnapshot): PendingEvent[] {
  const before = new Map(prev.tasks.map(t => [t.id, t]));
  const out: PendingEvent[] = [];
  for (const t of next.tasks) {
    const was = before.get(t.id);
    if (was === undefined && t.state === 'running') {
      out.push({ mark: 'task', text: `task started: ${truncateDisplay(t.label, 56)}` });
      continue;
    }
    if (was?.state === 'running' && t.state !== 'running') {
      out.push({
        mark: 'task',
        text: `task ${t.state}: ${truncateDisplay(t.label, 56)} (${formatUptime(t.elapsedSeconds)})`,
        tone: TASK_END_TONE[t.state],
      });
    }
  }
  return out;
}

/** How much of a name fits in a log row. A session name can hold the first hundred characters
 *  of a prompt, which would fill the row on its own (and a rename prints two names). The
 *  SESSION section is where the whole name can be read. */
const NAME_WIDTH = 28;

const shortName = (name: string): string => truncateDisplay(name, NAME_WIDTH);

/** A server changing state. `up` is green; anything else is coloured to stand out. */
function serverEvents(prev: LocalSnapshot, next: LocalSnapshot): PendingEvent[] {
  const before = new Map(prev.servers.map(s => [s.server, s]));
  const out: PendingEvent[] = [];
  for (const s of next.servers) {
    const was = before.get(s.server);
    if (was === undefined || was.state === s.state) continue;
    const where = s.state === 'up' ? ` at ${s.url}${s.mode === null ? '' : ` (${s.mode})`}` : '';
    out.push({
      mark: s.state === 'up' ? 'session' : 'warn',
      text: `server ${s.server} is ${s.state}${where}`,
      tone: s.state === 'up' ? 'ok' : s.state === 'busy' ? 'warn' : 'dim',
    });
  }
  return out;
}

/** How one session is named in a log row. */
const sessionLabel = (s: AgentSessionRow): string => `${shortName(s.name)} [${s.tree}]`;

/** What happened within one session: a rename, or a prompt starting. */
function sessionChanges(was: AgentSessionRow, now: AgentSessionRow): PendingEvent[] {
  const out: PendingEvent[] = [];
  if (was.name !== now.name) {
    out.push({ mark: 'rename', text: `session renamed: ${shortName(was.name)} -> ${sessionLabel(now)}` });
  }
  // Entering busy, or staying busy while the status timestamp moves, both mean the next
  // prompt has started.
  const restarted = now.status === 'busy' && (was.status !== 'busy' || was.statusAtMs !== now.statusAtMs);
  if (restarted) out.push({ mark: 'prompt', text: `prompt running: ${sessionLabel(now)}` });
  return out;
}

/** Sessions arriving and leaving, and what happened inside the ones that stayed. */
function sessionEvents(prev: LocalSnapshot, next: LocalSnapshot): PendingEvent[] {
  const before = new Map(prev.sessions.map(s => [s.pid, s]));
  const after = new Map(next.sessions.map(s => [s.pid, s]));
  const out: PendingEvent[] = [];
  for (const s of next.sessions) {
    const was = before.get(s.pid);
    if (was === undefined) {
      out.push({ mark: 'session', text: `session started: ${sessionLabel(s)}` });
      continue;
    }
    out.push(...sessionChanges(was, s));
  }
  for (const s of prev.sessions) {
    if (!after.has(s.pid)) {
      out.push({ mark: 'session', text: `session ended: ${sessionLabel(s)}`, tone: 'dim' });
    }
  }
  return out;
}

/**
 * The difference from the previous read, as events. A null `prev` (the first tick) says nothing.
 *
 * `limit` caps how many are emitted, and whatever was dropped is announced in one line —
 * cutting silently would read as "nothing else happened".
 */
export function diffLocalSnapshot(prev: LocalSnapshot | null, next: LocalSnapshot, limit = 12): PendingEvent[] {
  if (prev === null) return [];
  const all = [...serverEvents(prev, next), ...taskEvents(prev, next), ...sessionEvents(prev, next)];
  if (all.length <= limit) return all;
  return [...all.slice(0, limit), { mark: 'info', text: `... ${all.length - limit} more changes`, tone: 'dim' }];
}

/** The installed version changing: up, down, or becoming unreadable. */
function installedChange(was: ToolVersionRow, now: ToolVersionRow): PendingEvent | null {
  if (now.version === null) {
    // Gone or broken. Only worth saying when it used to be readable.
    if (was.version === null) return null;
    return { mark: 'warn', text: `${now.name} --version failed: ${now.error ?? '?'}` };
  }
  if (was.version === now.version) return null;
  return { mark: 'version', text: `${now.name} ${was.version ?? '?'} -> ${now.version}` };
}

/** A new version appearing upstream. Only reported **when the previous value is known**: a
 *  failed fetch in between would otherwise make the value merely coming back look like a
 *  release.
 *
 *  And only when the machine is actually behind it. A machine carrying a prerelease is ahead of
 *  every release upstream makes, and telling it `0.155.1 is out (installed 0.156.0-alpha.7)` on
 *  each one is news about somebody else's machine. The test is `isBehind`, the same one the TOOL
 *  row uses, rather than the stricter one an install has to pass: the log and the panel must say
 *  the same thing about a difference neither of them can rank. */
function releaseChange(was: ToolVersionRow, now: ToolVersionRow): PendingEvent | null {
  if (now.latest === null || was.latest === null || was.latest === now.latest) return null;
  if (!isBehind(now)) return null;
  const running = now.version ?? 'unknown';
  return { mark: 'version', text: `${now.name} ${now.latest} is out (installed ${running})` };
}

/**
 * Changes in the versions of the locally installed CLIs, as events.
 *
 * These upgrade themselves in the background and say nothing when they do. A null `prev` (the
 * first tick) reports nothing, the same rule as every other difference — otherwise the current
 * version would scroll past at every startup and a real upgrade would be indistinguishable.
 */
export function toolVersionEvents(
  prev: readonly ToolVersionRow[] | null,
  next: readonly ToolVersionRow[],
): PendingEvent[] {
  if (prev === null) return [];
  const before = new Map(prev.map(r => [r.name, r]));
  const out: PendingEvent[] = [];
  for (const now of next) {
    const was = before.get(now.name);
    if (was === undefined) continue;
    for (const e of [installedChange(was, now), releaseChange(was, now)]) {
      if (e !== null) out.push(e);
    }
  }
  return out;
}

/**
 * One line when the ssh-agent gains or loses its keys.
 *
 * An agent can die, or its keys expire, while the watcher runs. Without this, nobody notices
 * until the next fetch fails with `Permission denied (publickey)`. A null `prev` (the first
 * tick) reports nothing, as elsewhere; the state at startup is what the SSH row shows. */
export function sshAgentEvents(prev: SshAgentCard | null, next: SshAgentCard): PendingEvent[] {
  if (prev === null || prev.state === next.state) return [];
  const text = sshAgentSummary(next);
  return [next.state === 'loaded' ? { mark: 'step', text } : { mark: 'warn', text }];
}

/** Attach a time to an event. Recording it is the caller's job. */
export const stampEvent = (e: PendingEvent, atMs: number): WatchEvent => ({ atMs, ...e });
