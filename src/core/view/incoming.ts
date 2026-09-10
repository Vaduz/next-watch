/** **What a pull brought**: the commits, the diff summary, and what follows from it.
 *
 *  No row prefix (no time, no indent) is added here. The caller stacks these as an event and
 *  its detail, so the same material serves a screen that redraws in place and a pipe that
 *  takes one line at a time. */
import { truncateDisplay } from '../term/index.js';
import { renderCells, type Cell, type Paint } from '../term/index.js';
import type { IncomingView } from '../types.js';
import { since, type WatchLayout } from './index.js';

/** One line so that what was left out is **not dropped silently**. */
function moreLine(shown: number, total: number, unit: string, paint: Paint): string[] {
  return total > shown ? [paint(`... ${total - shown} more ${unit}`, 'dim')] : [];
}

/** The commits: sha, subject, author, how long ago. */
function commitLines(v: IncomingView, paint: Paint, layout: WatchLayout): string[] {
  const rows = v.commits.map((c): Cell[] => [
    { text: c.sha.slice(0, 7), tone: 'accent' },
    { text: truncateDisplay(c.subject, layout.subject) },
    { text: truncateDisplay(c.author, 16), tone: 'dim' },
    { text: `${since(v.nowMs, c.atMs)} ago`, tone: 'dim', right: true },
  ]);
  return renderCells(rows, paint);
}

/** The changed paths **folded to their top directory** (`cli 3 · lib 5 · docs 4`). */
export function summarizePaths(paths: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const top = p.includes('/') ? `${p.slice(0, p.indexOf('/'))}/` : p;
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([top, n]) => `${top} ${n}`)
    .join(' · ');
}

/** The report: one heading, and the detail stacked beneath it (the commits, the diff summary,
 *  what happens next).
 *
 *  No row prefix is added, for the reason in the file header. */
export function describeIncoming(
  v: IncomingView,
  paint: Paint,
  layout: WatchLayout,
): { head: string; details: string[] } {
  const head =
    `${paint(`pulled ${v.totalCommits} commit(s)`, 'bold')}  ` +
    paint(`${v.fromSha.slice(0, 7)} -> ${v.toSha.slice(0, 7)}`, 'accent');
  const stat =
    `${v.totalFiles} file(s)  ` +
    `${paint(`+${v.insertions}`, 'ok')} ${paint(`-${v.deletions}`, 'bad')}  ` +
    paint(summarizePaths(v.files), 'dim');
  return {
    head,
    details: [
      ...commitLines(v, paint, layout),
      ...moreLine(v.commits.length, v.totalCommits, 'commits', paint),
      stat,
      paint(`-> ${v.plan}`, 'dim'),
    ],
  };
}
