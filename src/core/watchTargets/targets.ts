/** **What can be selected** among the rows on screen: the targets per kind, their order, and
 *  cursor movement. What can be typed at them is `verbs.ts`; which verbs a target actually has
 *  is decided here, because that depends on its state. */
import type {
  AgentSessionRow,
  PaneName,
  ServiceCard,
  SshAgentCard,
  TaskRow,
  ToolVersionRow,
  WatchPanel,
  WatchServerRow,
} from '../types.js';
import { sshAgentNeedsKey, SSH_TARGET_KEY } from '../sshAgentView.js';
import type { WatchTarget } from '../watchTargets.js';
import { paneNamesOf } from '../panes.js';

/** A server offers **only what its current state allows**. A stopped server does not offer
 *  `stop`: it would do nothing, and whoever typed it would go looking for their own mistake. */
const SERVER_VERBS: Record<WatchServerRow['state'], readonly string[]> = {
  up: ['restart', 'stop'],
  down: ['start'],
  // `busy` means something else holds the port. Stopping and then starting has to be
  // possible, so all three are offered.
  busy: ['restart', 'stop', 'start'],
};

function serverTarget(s: WatchServerRow): WatchTarget {
  return {
    key: `server:${s.server}`,
    kind: 'server',
    id: s.server,
    verbs: SERVER_VERBS[s.state],
    note: s.state === 'busy' ? 'another process is holding this port' : undefined,
  };
}

/** A task can only be stopped while it is running. `lost` means the pid is already gone, so
 *  there is nowhere to send a signal. */
function taskTarget(t: TaskRow): WatchTarget {
  const verbs = t.state === 'running' ? ['kill', 'stop'] : [];
  const note =
    t.state === 'lost' ? 'the process is already gone' : t.state === 'running' ? undefined : `already ${t.state}`;
  return { key: `task:${t.id}`, kind: 'task', id: t.id, verbs, note, pid: t.pid };
}

/** A session is stopped with SIGTERM. One running in a tmux pane whose transcript can be read
 *  also offers `restart`, which types its resume command back into that pane.
 *
 *  **The watcher's own session is never offered a stop.** Killing it takes the watcher with it. */
function sessionTarget(s: AgentSessionRow): WatchTarget {
  const self = s.self === true;
  const pane = s.pane ?? null;
  const resume = s.resume ?? null;
  // Verbs that cannot work are not offered. No pane means nowhere to type; no resume command
  // means no way to bring it back after stopping it.
  const canRestart = !self && pane !== null && resume !== null;
  return {
    key: `session:${s.pid}`,
    kind: 'session',
    id: String(s.pid),
    verbs: self ? [] : canRestart ? ['restart', 'stop'] : ['stop'],
    note: self ? 'this is the session running the watcher' : undefined,
    pid: s.pid,
    pane: pane ?? undefined,
    resume: resume ?? undefined,
  };
}

const serviceTarget = (s: ServiceCard): WatchTarget => ({
  key: `service:${s.name}`,
  kind: 'service',
  id: s.name,
  verbs: ['open'],
  url: s.pageUrl,
});

/** A CLI that is not installed cannot be updated: there is no `<command> update` to run.
 *  The watcher's own automatic update goes through this same target, so it takes exactly the
 *  path a person typing `update` would. */
export const toolTarget = (v: ToolVersionRow): WatchTarget => ({
  key: `tool:${v.name}`,
  kind: 'tool',
  id: v.name,
  verbs: v.version === null ? [] : ['update'],
  note: v.version === null ? (v.error ?? 'not installed') : undefined,
});

/** The ssh-agent. `(a)dd` appears **only while there is no key**: with one loaded there is
 *  nothing to do, and with no agent there is nowhere to add it.
 *
 *  ⚠️ This target must never also carry `start`. `add` and `start` both shortcut to `a`, and
 *  two verbs sharing an initial on one target make the keypress ambiguous. */
function sshTarget(card: SshAgentCard): WatchTarget {
  const note =
    card.state === 'loaded'
      ? `${card.keys} key(s) loaded`
      : card.state === 'empty'
        ? undefined
        : (card.error ?? 'ssh-add could not be run');
  return { key: SSH_TARGET_KEY, kind: 'ssh', id: 'agent', verbs: sshAgentNeedsKey(card) ? ['add'] : [], note };
}

/** A pane scrolls with the arrow keys and fills the frame with `(f)ocus` (again to go back). */
const paneTarget = (name: PaneName): WatchTarget => ({
  key: `pane:${name}`,
  kind: 'pane',
  id: name,
  verbs: ['focus'],
});

/** What the cursor can currently reach.
 *
 *  While a pane fills the frame, **only the panes** are reachable. Otherwise the cursor could
 *  land on a server or task that is not on screen, and `(s)top` could be typed at something
 *  nobody can see. */
export function tabTargets(targets: readonly WatchTarget[], focus: PaneName | null): WatchTarget[] {
  return focus === null ? [...targets] : targets.filter(t => t.kind === 'pane');
}

/** Everything selectable, in the order it appears on screen. */
export function watchTargets(p: WatchPanel): WatchTarget[] {
  return [
    ...(p.ssh === null ? [] : [sshTarget(p.ssh)]),
    ...p.servers.map(serverTarget),
    ...p.tasks.map(taskTarget),
    ...(p.sessions ?? []).map(sessionTarget),
    ...p.services.map(serviceTarget),
    ...p.versions.map(toolTarget),
    ...paneNamesOf(p).map(paneTarget),
  ];
}

/** Resolve the selection so it **survives the list changing under it**.
 *
 *  If the key is still there, that is the answer. If it has gone (a task finished, a session
 *  died) the cursor moves to **whatever is at the same position**. It does not jump back to
 *  the top: that would mean pressing Tab again every time anything finishes. */
export function resolveSelection(
  targets: readonly WatchTarget[],
  selected: string | null,
  index: number,
): { key: string | null; index: number } {
  if (!targets.length) return { key: null, index: 0 };
  if (selected === null) return { key: null, index: Math.max(0, Math.min(index, targets.length - 1)) };
  const at = targets.findIndex(t => t.key === selected);
  if (at >= 0) return { key: targets[at].key, index: at };
  const near = Math.max(0, Math.min(index, targets.length - 1));
  return { key: targets[near].key, index: near };
}

/** Move one step with Tab / Shift-Tab. The ends wrap: stopping at the end makes a held key
 *  do nothing at all. */
export function stepSelection(
  targets: readonly WatchTarget[],
  selected: string | null,
  index: number,
  step: number,
): { key: string | null; index: number } {
  if (!targets.length) return { key: null, index: 0 };
  // With nothing selected yet, enter from whichever end matches the direction.
  if (selected === null) {
    const first = step >= 0 ? 0 : targets.length - 1;
    return { key: targets[first].key, index: first };
  }
  const here = resolveSelection(targets, selected, index).index;
  const next = (here + step + targets.length) % targets.length;
  return { key: targets[next].key, index: next };
}
