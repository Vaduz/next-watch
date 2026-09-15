/** The **built-in panel sections**, behind one switch each.
 *
 *  None of these is about the repository being watched. They are about the machine the watcher
 *  runs on — which agent CLIs are installed, what they are doing, how much quota is left, and
 *  whether the services they depend on are up. A host turns on the ones it wants and gets
 *  nothing for the rest: **a section that is off is absent, not empty**, because every renderer
 *  drops a block with no rows.
 *
 *  What each switch costs is worth knowing before turning it on:
 *
 *   - `agentSessions` reads the filesystem and runs `ps` once a second. Nothing leaves the
 *     machine.
 *   - `quota` reads the credentials on disk and may call the usage endpoint. It prefers a cache
 *     another program on the machine wrote, so the endpoint is asked as little as possible.
 *   - `quotaSession` **starts a session of its own** (`claude -p`) when the five-hour window is
 *     closed, in a sandbox directory. It is the only switch here that spends anything.
 *   - `services` and `tools` reach GitHub and the status pages at a fixed interval.
 *   - `sshAgent` runs `ssh-add -l`, and lets a person add a key from the screen. */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSessionRow, QuotaCard, ServiceCard, SshAgentCard, ToolVersionRow } from '../core/types.js';
import { clientName } from './http.js';
import { liveAgentSessions } from './sessions/index.js';
import { serviceStatusCards, type ServiceSpec } from './serviceStatus.js';
import { sshAgentCard } from './sshAgent.js';
import { toolVersionRows, type ToolSpec } from './toolVersions.js';
import { watchQuotaCards } from './quota/watch.js';

export type { ServiceSpec, ToolSpec };

/** Ten minutes between version checks. GitHub allows 60 unauthenticated requests an hour, and
 *  a release does not appear more often than that anyway. */
const VERSION_TTL_MS = 10 * 60_000;
/** A minute for everything else: fast enough to notice, slow enough not to be noticed. */
const MINUTE_TTL_MS = 60_000;

/** The status pages that matter to a machine running these CLIs. */
const DEFAULT_SERVICES: readonly ServiceSpec[] = [
  { name: 'Claude', page: 'https://status.claude.com' },
  { name: 'OpenAI', page: 'https://status.openai.com' },
];

/** The CLIs whose versions are shown. **They update themselves by default**: a watcher that
 *  reports a new release for days without installing it is only a reminder. Give the array
 *  explicitly with `autoUpdate: false` to have it report and leave the installing alone. */
const DEFAULT_TOOLS: readonly ToolSpec[] = [
  { command: 'claude', repo: 'anthropics/claude-code', autoUpdate: true },
  { command: 'codex', repo: 'openai/codex', autoUpdate: true },
];

/** Which built-in sections a host wants. Anything left out is not drawn. */
export interface WatchProviders {
  /** The live agent sessions, and restarting one in its tmux pane. */
  agentSessions?: boolean;
  /** The usage quota per backend. */
  quota?: boolean;
  /** Open a closed five-hour quota window with `claude -p`. The default `cwd` is an empty
   *  directory under the temp directory: starting it inside a repository would put that
   *  repository's instructions into the context of a message whose only purpose is to exist. */
  quotaSession?: boolean | { cwd: string };
  /** The public status pages. Defaults to the two the CLIs depend on. */
  services?: boolean | readonly ServiceSpec[];
  /** The installed CLI versions, and installing a new release. */
  tools?: boolean | readonly ToolSpec[];
  /** Whether an ssh-agent holds a key. */
  sshAgent?: boolean;
}

/** The switches for a run with **no config file at all** (`--start <script>` and nothing else).
 *
 *  Everything is on, **except the one switch that spends something**. A config file is a
 *  deliberate statement of what this machine wants drawn; with no file there is nothing to read
 *  an intent from, and a watcher whose first run shows an empty frame is one nobody runs twice.
 *  The sections that only look cost a `ps`, a read of the credentials on disk, and two status
 *  pages a minute.
 *
 *  `quotaSession` is not one that only looks: it **starts a session of its own** (`claude -p`)
 *  to open a closed five-hour window. Spending something is not a default, so it waits to be
 *  asked for with `--quota-session`. */
export function zeroConfigProviders(o: { quotaSession: boolean }): WatchProviders {
  return {
    agentSessions: true,
    quota: true,
    quotaSession: o.quotaSession,
    services: true,
    tools: true,
    sshAgent: true,
  };
}

/** The switches turned into the readers the loop calls. A section that is off has **no
 *  function**, which is how the panel knows not to draw it. */
export interface ResolvedProviders {
  sessions?: () => Promise<AgentSessionRow[]>;
  quotas?: () => Promise<QuotaCard[]>;
  services?: () => Promise<ServiceCard[]>;
  toolVersions?: () => Promise<ToolVersionRow[]>;
  sshAgent?: () => Promise<SshAgentCard | null>;
  /** The tools the watcher installs new releases of itself. Empty when none. */
  autoUpdate: readonly string[];
  /** Where to open a quota window, and how to read the quota to know it is closed. Null when
   *  that is off. **Reading the quota here does not require the `quota` section**: the two go
   *  through the same cache, so nothing is fetched twice. */
  quotaSession: { cwd: string; read: () => Promise<QuotaCard[]> } | null;
}

/** What a `boolean | T[]` switch means: off, the default list, or the given list. */
function listOf<T>(switched: boolean | readonly T[] | undefined, fallback: readonly T[]): readonly T[] | null {
  if (switched === undefined || switched === false) return null;
  return switched === true ? fallback : switched;
}

/** Where the quota-opening session runs, or null when it is off. */
function quotaSessionCwd(switched: WatchProviders['quotaSession'], appName: string): string | null {
  if (switched === undefined || switched === false) return null;
  return switched === true ? join(tmpdir(), appName) : switched.cwd;
}

/** Turn the switches into readers. `appName` names the cache directory and identifies this
 *  watcher to everything it talks to. */
export function buildProviders(o: { appName: string; providers: WatchProviders }): ResolvedProviders {
  const { appName } = o;
  const client = clientName(appName);
  const services = listOf(o.providers.services, DEFAULT_SERVICES);
  const tools = listOf(o.providers.tools, DEFAULT_TOOLS);
  const quotas = (): Promise<QuotaCard[]> =>
    watchQuotaCards({ appName, client, nowMs: Date.now(), ttlMs: MINUTE_TTL_MS });
  const cwd = quotaSessionCwd(o.providers.quotaSession, appName);
  return {
    sessions: o.providers.agentSessions === true ? () => Promise.resolve(liveAgentSessions(Date.now())) : undefined,
    quotas: o.providers.quota === true ? quotas : undefined,
    services:
      services === null ? undefined : () => serviceStatusCards({ services, nowMs: Date.now(), ttlMs: MINUTE_TTL_MS }),
    toolVersions:
      tools === null
        ? undefined
        : () => toolVersionRows({ tools, nowMs: Date.now(), ttlMs: VERSION_TTL_MS, userAgent: client }),
    sshAgent: o.providers.sshAgent === true ? () => sshAgentCard(Date.now(), MINUTE_TTL_MS) : undefined,
    autoUpdate: (tools ?? []).filter(t => t.autoUpdate === true).map(t => t.command),
    quotaSession: cwd === null ? null : { cwd, read: quotas },
  };
}
