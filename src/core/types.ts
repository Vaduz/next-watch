// The data model of the dashboard. Types only, so an adapter in `io/` can produce them
// without importing the drawing code — that would point the dependency the wrong way.
//
// The access panes are keyed by server id, so a repository with one server and one with five
// get the same treatment.
import type { AccessRow } from './accessLog.js';
import type { Mark, Tone } from './term/index.js';

/** One event, kept so it can be replayed into the log pane. */
export interface WatchEvent {
  atMs: number;
  mark: Mark;
  text: string;
  /** Overrides the mark's default colour, for rows where the same kind has a good and a bad
   *  outcome. */
  tone?: Tone;
}

/** One commit that arrived, with only what gets displayed. */
export interface IncomingCommit {
  sha: string;
  subject: string;
  author: string;
  atMs: number;
}

/** Everything that came in from the remote. The `total*` counts are separate so the view can
 *  say how many were left out. */
export interface IncomingView {
  nowMs: number;
  fromSha: string;
  toSha: string;
  /** What is shown, after the cap. */
  commits: readonly IncomingCommit[];
  totalCommits: number;
  files: readonly string[];
  totalFiles: number;
  insertions: number;
  deletions: number;
  /** One line saying what will happen because of this (from `describePlan`). */
  plan: string;
}

/** One usage window (a five-hour window, a weekly window). */
export interface QuotaWindowView {
  name: string;
  usedPercent: number;
  /** When it resets (epoch ms), or null when that cannot be read. */
  resetsAtMs: number | null;
}

/** The quota for one backend. A failure leaves the reason in `error`. */
export interface QuotaCard {
  label: string;
  plan: string | null;
  windows: readonly QuotaWindowView[];
  error: string | null;
  /** When the value was actually measured. Null means it has never been read. */
  fetchedAtMs: number | null;
  /** True when the value shown is the last successful one rather than a fresh read. */
  stale: boolean;
}

/** **How the watcher opens a CLI's five-hour window**, as the screen says it under that CLI's
 *  service row. One of these per CLI the watcher can open a session for.
 *
 *  It is a row of its own rather than a field on `ServiceCard`, because a service card is what a
 *  status page said and this is what this machine is configured to do. */
export interface QuotaSessionModeRow {
  /** The CLI it belongs to (`claude`), which is what puts it under the right service row. */
  cli: string;
  /** `auto` opens the window whenever it is found closed; `manual` only at the listed times;
   *  `off` means the watcher sends nothing for this CLI. */
  mode: 'auto' | 'manual' | 'off';
  /** The five-hour window as the last read saw it. Null before the first read. */
  window: { open: boolean; closesAtMs: number | null } | null;
  /** The next listed time, in minutes since midnight. Null outside the scheduled mode. */
  nextAtMinutes: number | null;
  /** When a session was last started, for the `sent HH:MM` tail. Null when none has been. */
  sentAtMs: number | null;
}

/** One live agent session. */
export interface AgentSessionRow {
  /** Process id. Not displayed, but it is **the key that points at the same session** for as
   *  long as the watcher runs. */
  pid: number;
  /** Which CLI this session belongs to. Needed so `VER` is compared against **that CLI's**
   *  version; comparing one CLI's version with another's marks every row as behind. */
  agent: string;
  /** Session name (whatever the CLI or a title hook set). */
  name: string;
  /** Working tree (the last segment of its cwd). */
  tree: string;
  /** busy / idle / shell / waiting / '?'. */
  status: string;
  model: string | null;
  /** Context tokens carried by the most recent response, or null when unreadable. */
  contextTokens: number | null;
  /** Seconds since the status last changed. */
  idleSeconds: number | null;
  /** When the status last changed. **The same `busy` with a new timestamp is a new prompt**,
   *  so this is part of the key. */
  statusAtMs: number | null;
  /** The version the session **started with**. A CLI that has since been upgraded keeps
   *  running the old one, so this can disagree with the `TOOL` row. Null when unreadable. */
  version: string | null;
  /** Whether this is the watcher's own session, so it can be left out. */
  self?: boolean;
  /** The tmux pane it runs in (`%3`), or null when it is not under tmux. */
  pane?: string | null;
  /** The line to type into the pane to bring it back (`claude --resume <id>`).
   *  Null when the CLI cannot resume or its transcript cannot be read. */
  resume?: string | null;
}

/** An external service's state (from a statuspage summary). */
export interface ServiceCard {
  name: string;
  /** The **human-readable page**, which is what `open` opens — not the summary JSON. */
  pageUrl: string;
  indicator: 'none' | 'minor' | 'major' | 'critical' | 'maintenance' | 'unknown';
  description: string;
  /** Components that are not operational. */
  degraded: readonly string[];
  error: string | null;
}

/** A pane's name: `'event'` for the watcher's own log, otherwise a server id. Which ones exist
 *  is derived rather than listed; see `panes.ts`. */
export type PaneName = string;

/** One access-log pane. `file` is the log being read, shown in the heading. */
export interface AccessPane {
  file: string | null;
  rows: readonly AccessRow[];
}

/** A task started from outside the watcher. `lost` means it is still marked running but its
 *  pid is gone — the trace of whatever started it having died. */
export interface TaskRow {
  id: string;
  label: string;
  /** Process id. **Not displayed**, but held as the target for stopping the task. */
  pid: number;
  state: 'running' | 'done' | 'failed' | 'lost';
  /** How long it has been running, or how long it took. */
  elapsedSeconds: number;
  /** Seconds since it finished. Null while it is still running. */
  endedSecondsAgo: number | null;
}

/** Whether an ssh-agent holds keys. **The row survives a failed read**; dropping it would hide
 *  the fact that there are no keys. */
export interface SshAgentCard {
  state: 'loaded' | 'empty' | 'no-agent' | 'unknown';
  /** Number of keys loaded (only above zero in the `loaded` state). */
  keys: number;
  /** Why it could not be read, or the agent's own message. Null on success. */
  error: string | null;
}

/** One CLI's version. **The row survives a failed read**, for the same reason. */
export interface ToolVersionRow {
  /** The name shown, which is the command that is run. */
  name: string;
  /** The installed version (`2.1.236`), or null when unreadable. */
  version: string | null;
  /** Why it could not be read. Null on success. */
  error: string | null;
  /** The newest version upstream, or null when that could not be fetched. */
  latest: string | null;
  /** Why upstream could not be reached. `latest` may still hold the previous value. */
  latestError: string | null;
}

/** One server's row, with only the columns the watcher needs. */
export interface WatchServerRow {
  server: string;
  state: 'up' | 'down' | 'busy';
  url: string;
  mode: string | null;
  owner: string | null;
  uptimeSeconds: number | null;
  /** Files this server's stdout collects in, which the access pane reads. */
  logFiles: readonly string[];
}

/** Everything one panel is drawn from. */
export interface WatchPanel {
  nowMs: number;
  startedAtMs: number;
  repo: { root: string; branch: string; head: string; behind: number };
  /** When the last pull happened and how many commits it brought, or null before the first. */
  lastPull: { atMs: number; commits: number } | null;
  /** Seconds until the remote is checked again. Null when not watching (a single run). */
  nextCheckSeconds: number | null;
  servers: readonly WatchServerRow[];
  /** Tasks started from outside (running, plus recently finished). */
  tasks: readonly TaskRow[];
  /** Events so far, oldest first. The log pane takes them from the end. */
  events: readonly WatchEvent[];
  /** The tail of each server's log, **keyed by server id**. A server with no pane simply has
   *  no entry. */
  access: Readonly<Record<string, AccessPane>>;
  quotas: readonly QuotaCard[];
  /** Whether the ssh-agent holds keys. Null when it has not been read, and the row is omitted. */
  ssh: SshAgentCard | null;
  /** The live agent sessions. **Null and empty are different**: null means nobody is reading
   *  them and the section is not drawn at all, while empty means the reader ran and found none,
   *  which is worth a row saying so. */
  sessions: readonly AgentSessionRow[] | null;
  services: readonly ServiceCard[];
  /** How the quota-opening session is set up per CLI, drawn under the matching service row.
   *  Optional because a host may build a panel itself; absent draws no such line. */
  quotaSessions?: readonly QuotaSessionModeRow[];
  /** Versions of the CLIs installed locally. */
  versions: readonly ToolVersionRow[];
  /** **next-watch's own version**, for the frame's title — not one of `versions`, which are
   *  other people's CLIs. Optional because a host may build a panel itself, and null where the
   *  package's own `package.json` could not be read; either way the title is the bare name. */
  selfVersion?: string | null;
}
