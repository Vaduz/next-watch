/** Finding the live Codex sessions **through the files their processes hold open**.
 *
 *  Codex has no equivalent of the per-pid json the other CLI writes. All there is is an
 *  appended rollout (`~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`), and **it contains
 *  no pid**. So the direction is reversed: find the live `codex` processes with ps, then read
 *  the rollouts their `/proc/<pid>/fd` has open. A process holding the file open *is* the
 *  definition of the session being alive, which is why none of the pid-checking the other
 *  reader needs appears here.
 *
 *  ⚠️ **Linux only.** This reads `/proc`, so elsewhere it returns nothing — the section is
 *  empty and the watch carries on.
 *
 *  ⚠️ One process can hold **several rollouts open at once** (the interactive thread plus
 *  subagents). Deciding which one has a person at it is `core/sessions/codex/rollout.ts`.
 *
 *  ⚠️ **This is called every second.** What cannot change (the first line, the first prompt) is
 *  remembered per path; the tail is re-read only when the file has grown, and the configuration
 *  only when it has been rewritten. */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { ProcInfo } from '../processes.js';
import { readHead, readTail, fileMtimeMs, fileSize } from '../fileWindow.js';
import {
  isInteractiveCodexSession,
  parseCodexSessionMeta,
  type CodexSessionMeta,
} from '../../core/sessions/codex/rollout.js';
import {
  codexHeadFacts,
  codexTranscriptTip,
  type CodexHeadFacts,
  type CodexTip,
} from '../../core/sessions/codex/tip.js';
import { toCodexSessionRow } from '../../core/sessions/codex/row.js';
import { codexInvocation } from '../../core/sessions/codex/invocation.js';
import { codexConfigModel } from '../../core/sessions/codex/config.js';
import { restartablePane, type TmuxPane } from '../../core/tmuxPanes.js';
import type { AgentSessionRow } from '../../core/types.js';

/** How far in the first prompt is. Measured at 96KB — the preamble is fat. */
const HEAD_BYTES = 512 * 1024;
/** How much of the tail to read. The last turn's boundary and its token count fit easily. */
const TAIL_BYTES = 256 * 1024;

/** A ps command column of this shape is codex itself (`codex` / `codex exec …`). Children like
 *  `codex-code-mode-host` are **excluded**: they would count the same rollout twice. */
const CODEX_COMMAND = /(^|\/)codex(\s|$)/;

/** Whether what a `/proc` link points at is a rollout (reading `/proc` already means Linux
 *  separators). */
const isRollout = (file: string): boolean => /\/sessions\/.*\/rollout-[^/]+\.jsonl$/.test(file);

/** The rollouts `/proc/<pid>/fd` has open, or none where that cannot be read. */
function openRollouts(pid: number): string[] {
  const dir = `/proc/${pid}/fd`;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    try {
      // A descriptor can be closed between the listing and the readlink, which throws.
      const target = fs.readlinkSync(path.join(dir, name));
      if (isRollout(target)) out.push(target);
    } catch {
      /* skip a descriptor that has gone */
    }
  }
  return [...new Set(out)];
}

/** How much to read to be sure of getting the whole first line. Measured at 18.6KB — the base
 *  instructions are fat. The larger window is only tried when that was not enough. */
const FIRST_LINE_BYTES = 256 * 1024;
const FIRST_LINE_MAX_BYTES = 4 * 1024 * 1024;

/** The first line, **only if it was read whole**, and null otherwise.
 *
 *  There are two reasons it may not be, and the caller treats them differently: the newline is
 *  not written yet (a session that has just started), or the line is bigger than the window. */
function firstLine(file: string): string | null {
  for (const bytes of [FIRST_LINE_BYTES, FIRST_LINE_MAX_BYTES]) {
    const chunk = readHead(file, bytes);
    const nl = chunk.indexOf('\n');
    if (nl !== -1) return chunk.slice(0, nl);
    if (chunk.length < bytes) return null;
  }
  return null;
}

/** The first line of a rollout never changes, so it is read once per path. */
const metaCache = new Map<string, CodexSessionMeta | null>();

/** Read the first line. **What could not be read whole is not remembered**: a line still being
 *  written will be there on the next tick, and caching the null would hide that session for
 *  good. */
function cachedMeta(file: string): CodexSessionMeta | null {
  const known = metaCache.get(file);
  if (known !== undefined) return known;
  const line = firstLine(file);
  if (line === null) {
    // Only a first line larger than the window is given up on, so 4MB is not re-read a second.
    if ((fileSize(file) ?? 0) > FIRST_LINE_MAX_BYTES) metaCache.set(file, null);
    return null;
  }
  const meta = parseCodexSessionMeta(line);
  metaCache.set(file, meta);
  return meta;
}

/** What the head yields (the name, and a fallback model). Remembered **only once a name has
 *  appeared** — a session that has not been spoken to yet has none, and while the name only
 *  exists at the head, the model also appears at the tail. */
const headCache = new Map<string, CodexHeadFacts>();

function cachedHead(file: string): CodexHeadFacts {
  const known = headCache.get(file);
  if (known !== undefined) return known;
  const facts = codexHeadFacts(readHead(file, HEAD_BYTES));
  if (facts.name !== null) headCache.set(file, facts);
  return facts;
}

/** What the tail yields. The key is the file's size: unchanged means the same answer. The model
 *  is **carried over from the last read that had one** — it is written at the head of a turn,
 *  so during a long turn it falls off the end of the window. */
const tipCache = new Map<string, { size: number; tip: CodexTip }>();

function cachedTip(file: string): CodexTip {
  const size = fileSize(file);
  const cached = tipCache.get(file);
  if (size === null) return cached?.tip ?? { status: '?', statusAtMs: null, model: null, contextTokens: null };
  if (cached?.size === size) return cached.tip;
  const fresh = codexTranscriptTip(readTail(file, TAIL_BYTES));
  const tip = { ...fresh, model: fresh.model ?? cached?.tip.model ?? null };
  tipCache.set(file, { size, tip });
  return tip;
}

/** The rollout of the **human thread** this pid is writing, or null.
 *
 *  ⚠️ One process can have two human threads open (starting a new one can leave the previous
 *  descriptor behind). The pid is the row's key — the event diff, the selection, where a `stop`
 *  goes — so this narrows to **one row per pid**: the most recently written, which is the
 *  thread that terminal is actually talking to. */
function interactiveRollout(pid: number): { file: string; meta: CodexSessionMeta } | null {
  const found: { file: string; meta: CodexSessionMeta }[] = [];
  for (const file of openRollouts(pid)) {
    const meta = cachedMeta(file);
    if (meta !== null && isInteractiveCodexSession(meta)) found.push({ file, meta });
  }
  if (found.length <= 1) return found[0] ?? null;
  return found.reduce((a, b) => ((fileMtimeMs(b.file) ?? 0) > (fileMtimeMs(a.file) ?? 0) ? b : a));
}

/** Where Codex keeps its configuration. `CODEX_HOME` is the CLI's own override, so a machine
 *  that moved it is followed rather than guessed at. */
const codexHome = (): string => process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');

/** The config files are re-read only when they change, because this runs every second. The key
 *  is the path and the file's modification time; an unreadable file is remembered as null so a
 *  machine with no config does not stat twice a second for the life of the watch. */
const configCache = new Map<string, { mtimeMs: number | null; model: string | null }>();

function configModel(file: string): string | null {
  const mtimeMs = fileMtimeMs(file);
  const cached = configCache.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.model;
  let model: string | null = null;
  try {
    model = codexConfigModel(fs.readFileSync(file, 'utf8'));
  } catch {
    /* no config file, or one that cannot be read: there is simply no fallback */
  }
  configCache.set(file, { mtimeMs, model });
  return model;
}

/** The model to show when the rollout named none.
 *
 *  ⚠️ **The order is strongest evidence first.** The rollout says what the session is *on*,
 *  including a model changed with `/model` part-way through, so anything here is only reached by
 *  a session that has not taken a turn yet. Then what it was *asked* for on its command line,
 *  then what the configuration would have given it: `$CODEX_HOME/<profile>.config.toml` when the
 *  command line named a profile (0.154.0 layers a whole file, not a table), and the base
 *  `config.toml` otherwise. Nothing readable leaves the column as `-`.
 *
 *  The `codex app-server` session listing is deliberately **not** used: it is a process round
 *  trip per second, and the rollout the process already has open carries the same answer. */
function fallbackModel(command: string): string | null {
  const { model, profile } = codexInvocation(command);
  if (model !== null) return model;
  const home = codexHome();
  const layered = profile === null ? null : configModel(path.join(home, `${profile}.config.toml`));
  return layered ?? configModel(path.join(home, 'config.toml'));
}

/** The live interactive Codex sessions as rows. `procs`, `own` and `panes` are the **same ps
 *  and tmux results** the other reader was given. */
export function liveCodexSessions(
  nowMs: number,
  procs: readonly ProcInfo[],
  own: ReadonlySet<number>,
  panes: readonly TmuxPane[] = [],
): AgentSessionRow[] {
  const rows: AgentSessionRow[] = [];
  for (const proc of procs) {
    if (!CODEX_COMMAND.test(proc.command)) continue;
    const found = interactiveRollout(proc.pid);
    if (found === null) continue;
    const head = cachedHead(found.file);
    const tip = cachedTip(found.file);
    rows.push(
      toCodexSessionRow(
        found.meta,
        proc.pid,
        { ...tip, model: tip.model ?? head.model ?? fallbackModel(proc.command) },
        nowMs,
        {
          name: head.name,
          self: own.has(proc.pid),
          pane: restartablePane(panes, procs, proc.pid)?.pane.id ?? null,
        },
      ),
    );
  }
  return rows;
}
