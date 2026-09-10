/** **Collect the material for one panel.**
 *
 *  Everything here **fails soft**: a section that cannot be read leaves a gap, and the rest of
 *  the screen still says what it knows.
 *
 *  Every source arrives through the config: the servers from their adapters' `probe()`, the
 *  tasks from `tasks()`, and the optional sections from whichever providers are switched on. */
import { readAccessRows } from '../io/readAccessRows.js';
import type { LocalSnapshot } from '../core/watchEvents.js';
import type {
  AccessPane,
  AgentSessionRow,
  QuotaCard,
  ServiceCard,
  SshAgentCard,
  ToolVersionRow,
  WatchEvent,
  WatchPanel,
  WatchServerRow,
} from '../core/types.js';
import type { ResolvedConfig } from '../config.js';

/** How many access rows a pane keeps. How many are drawn follows from the terminal's height. */
const ACCESS_ROWS = 40;

/** Return a fallback rather than throwing: one broken source must not stop the watch. */
async function safely<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

/** The same, for a source that is not asynchronous. */
function safelySync<T>(load: () => T, fallback: T): T {
  try {
    return load();
  } catch {
    return fallback;
  }
}

/** Look at the local state only, with nothing reaching the network. **This runs every second**,
 *  so nothing heavy belongs here. The difference from the previous call becomes events. */
export async function localSnapshot(config: ResolvedConfig): Promise<LocalSnapshot> {
  const servers = await Promise.all(
    config.servers.map(s =>
      safely<WatchServerRow>(() => s.probe(), {
        server: s.id,
        state: 'down',
        url: '-',
        mode: null,
        owner: null,
        uptimeSeconds: null,
        logFiles: [],
      }),
    ),
  );
  return {
    servers,
    tasks: safelySync(() => config.tasks(), []),
    sessions: await safely<AgentSessionRow[]>(() => config.providers.sessions?.() ?? Promise.resolve([]), []),
  };
}

/** Collect one panel. The sources that reach outside are fetched together. */
export async function collectWatchPanel(o: {
  config: ResolvedConfig;
  nowMs: number;
  startedAtMs: number;
  head: string;
  behind: number;
  lastPull: { atMs: number; commits: number } | null;
  /** Seconds until the next check, or null for a single run with no next. */
  nextCheckSeconds: number | null;
  events: readonly WatchEvent[];
  /** What the last local read saw, reused rather than read a second time. */
  local: LocalSnapshot;
  /** The CLI versions from the last read, empty before the first. */
  versions: readonly ToolVersionRow[];
  /** The ssh-agent from the last read, null before the first. */
  ssh: SshAgentCard | null;
}): Promise<WatchPanel> {
  const { config } = o;
  const [quotas, services] = await Promise.all([
    safely<QuotaCard[]>(() => config.providers.quotas?.() ?? Promise.resolve([]), []),
    safely<ServiceCard[]>(() => config.providers.services?.() ?? Promise.resolve([]), []),
  ]);
  const access: Record<string, AccessPane> = {};
  for (const server of o.local.servers) access[server.server] = accessFor(config.logDir, server, o.nowMs);
  return {
    nowMs: o.nowMs,
    startedAtMs: o.startedAtMs,
    repo: { root: config.root, branch: config.branch, head: o.head, behind: o.behind },
    lastPull: o.lastPull,
    nextCheckSeconds: o.nextCheckSeconds,
    servers: o.local.servers,
    tasks: o.local.tasks,
    events: o.events,
    access,
    quotas,
    // Null when nothing reads them, so the section is absent rather than saying there are none.
    sessions: config.providers.sessions === undefined ? null : o.local.sessions,
    services,
    versions: o.versions,
    ssh: o.ssh,
  };
}

/** The tail of one server's log, and which file is being read. A server that is down has no
 *  log files, so its pane is empty rather than absent — the heading still says it is there. */
function accessFor(logDir: string, server: WatchServerRow, nowMs: number): AccessPane {
  const file = server.logFiles[0] ?? null;
  try {
    return { file, rows: readAccessRows(logDir, server.logFiles, ACCESS_ROWS, nowMs) };
  } catch {
    return { file, rows: [] };
  }
}

/** The key for not redrawing an unchanged panel. **The clock, the uptime and the countdown are
 *  left out**: including them would make every second a different key, and off a terminal the
 *  same panel would be appended once a second. */
export function panelKey(p: WatchPanel): string {
  return JSON.stringify([
    p.repo,
    p.lastPull?.atMs ?? null,
    p.servers.map(s => [s.server, s.state, s.url, s.mode, s.owner]),
    p.tasks.map(t => [t.id, t.label, t.state]),
    // The events only need a count: each row has already reached the terminal once.
    p.events.length,
    // An access pane can change without its count changing, so its last row is part of the key.
    Object.entries(p.access).map(([name, pane]) => [
      name,
      pane.file,
      pane.rows.length,
      JSON.stringify(pane.rows.at(-1) ?? null),
    ]),
    p.quotas.map(q => [q.label, q.plan, q.error, q.stale, q.windows.map(w => [w.name, Math.round(w.usedPercent)])]),
    p.sessions?.map(s => [s.name, s.tree, s.status, s.model, s.contextTokens]) ?? null,
    p.services.map(s => [s.name, s.indicator, s.description, [...s.degraded], s.error]),
    p.versions.map(v => [v.name, v.version, v.error]),
    p.ssh === null ? null : [p.ssh.state, p.ssh.keys, p.ssh.error],
  ]);
}
