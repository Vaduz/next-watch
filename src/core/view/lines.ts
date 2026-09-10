/** The **single rows** in the panel body: the repository, the ssh-agent, the CLI versions.
 *
 *  These are not tables because each holds one or two values that move once every few days.
 *  Being a row rather than a table, the selection cursor sits **immediately before the text**
 *  rather than in a column. The tables are `blocks.ts`. */
import { isBehind } from '../toolVersionView.js';
import { sshAgentSummary, SSH_TARGET_KEY } from '../sshAgentView.js';
import type { Paint } from '../term/index.js';
import type { ToolVersionRow, WatchPanel } from '../types.js';
import { since, type WatchClock, type WatchView } from './index.js';

/** One CLI: `claude 2.1.236`, plus `(latest 2.1.237)` when upstream is ahead.
 *
 *  Nothing is added when it matches upstream — an ordinary state gets no colour and no extra
 *  words. `(latest ?)` appears only when the fetch failed, so "nothing newer" and "could not
 *  look" never read the same. */
function versionPart(v: ToolVersionRow, paint: Paint, selected: boolean): string {
  const head = v.version ?? paint(v.error ?? 'unknown', 'warn');
  const tail = isBehind(v)
    ? ` ${paint(`(latest ${v.latest})`, 'warn')}`
    : v.latest === null && v.latestError !== null
      ? ` ${paint('(latest ?)', 'dim')}`
      : '';
  // A row, not a table, so the cursor goes right before the name instead of in a column.
  return `${selected ? paint('›', 'accent') : ''}${paint(v.name, 'bold')} ${head}${tail}`;
}

/** The CLI versions as one row (`TOOL  claude 2.1.236 · codex 0.147.0 (latest 0.148.0)`).
 *
 *  A row rather than a table because these move once every few days. One that could not be
 *  read stays on the row with its reason: dropping it would hide the fact that it is missing. */
export function versionLine(p: WatchPanel, paint: Paint, view: WatchView): string[] {
  if (!p.versions.length) return [];
  const parts = p.versions.map(v => versionPart(v, paint, `tool:${v.name}` === view.selected));
  return [`${paint('TOOL', 'dim')}     ${parts.join(paint(' · ', 'dim'))}`];
}

/** The repository row: which checkout, which branch, and how far along it is. */
export function repoLines(p: WatchPanel, paint: Paint, clock: WatchClock): string[] {
  const sync =
    p.repo.behind === 0
      ? paint('in sync with origin/main', 'ok')
      : paint(`${p.repo.behind} commit(s) behind origin/main`, 'warn');
  const pulled =
    p.lastPull === null
      ? paint('nothing pulled during this watch', 'dim')
      : paint(
          `last pull ${clock.time(p.lastPull.atMs)} (${since(p.nowMs, p.lastPull.atMs)} ago, ${p.lastPull.commits} commit(s))`,
          'dim',
        );
  // The countdown to the next check goes **here, not on the bottom line**: it is part of the
  // repository's story, and the bottom line belongs to what can be typed. A single run has no
  // next check, so it shows nothing.
  const next = p.nextCheckSeconds === null ? '' : paint(` · next git check ${Math.max(0, p.nextCheckSeconds)}s`, 'dim');
  return [
    `${paint('REPO', 'dim')}     ${p.repo.root}  ${paint(p.repo.branch, 'bold')} ${paint(p.repo.head.slice(0, 7), 'accent')}  ${sync}`,
    `         ${pulled}${next}`,
  ];
}

/** The ssh-agent row (`SSH      ssh-agent: no key loaded · git over SSH will fail`).
 *
 *  It sits **directly under the repository rows**. Whether a key is loaded matters for talking
 *  to the remote, which is exactly what those rows are about, so someone asking "why has
 *  nothing come in" finds it next to the answer. The cursor sits before the text, as on the
 *  TOOL row. */
export function sshLine(p: WatchPanel, paint: Paint, view: WatchView): string[] {
  if (p.ssh === null) return [];
  const tone = p.ssh.state === 'loaded' ? 'dim' : 'warn';
  const cursor = view.selected === SSH_TARGET_KEY ? paint('›', 'accent') : '';
  return [`${paint('SSH', 'dim')}      ${cursor}${paint(sshAgentSummary(p.ssh), tone)}`];
}
