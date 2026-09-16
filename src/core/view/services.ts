/** The **external services** table, and the line under each row saying how this machine opens
 *  that CLI's five-hour quota window.
 *
 *  It is apart from the other tables in `blocks.ts` because it is the only one whose rows carry
 *  a second line of their own, and because that line is about this watcher's configuration
 *  rather than about anything a status page said.
 *
 *  Pure formatting: no filesystem, no process, the clock arrives as an argument. */
import { displayWidth, renderCells, truncateDisplay, type Cell, type Paint, type Tone } from '../term/index.js';
import { quotaSessionLine, quotaSessionUnder } from '../quota/sessionMode.js';
import type { ServiceCard, WatchPanel } from '../types.js';
import { type WatchClock, type WatchLayout, type WatchView } from './index.js';

/** The selection cursor, placed **only at the left edge of the selected row** — the same shape
 *  every other table uses. */
const gutter = (key: string, selected: string | null): Cell => ({
  text: key === selected ? '\u203a' : ' ',
  tone: 'accent',
});

const SERVICE_TONE: Record<ServiceCard['indicator'], Tone> = {
  none: 'ok',
  minor: 'warn',
  major: 'bad',
  critical: 'bad',
  maintenance: 'warn',
  unknown: 'dim',
};

const SERVICE_GLYPH: Record<ServiceCard['indicator'], string> = {
  none: '●',
  minor: '▲',
  major: '▲',
  critical: '✕',
  maintenance: '■',
  unknown: '?',
};

/** The heading of the service section. Its width is also the indent the session line beneath a
 *  service row hangs from, so it is written once. */
const SERVICE_LABEL = 'SERVICE';

/** How far in the second line under a service row starts: past the cursor column, the heading
 *  column, and the two spaces `renderCells` joins columns with. Derived rather than counted, so
 *  renaming the heading cannot leave the line hanging under the wrong column. */
const SESSION_INDENT = ' '.repeat(1 + 2 + displayWidth(SERVICE_LABEL) + 2);

/** The external services, listing **only the components that are not operational**.
 *
 *  Under each row that stands for a CLI goes **one more line**: how this machine opens that
 *  CLI's five-hour window. A person looking at the Claude row is looking for Claude, and this is
 *  the setting that decides whether a closed window gets opened for them. */
export function serviceBlock(
  p: WatchPanel,
  paint: Paint,
  layout: WatchLayout,
  view: WatchView,
  clock: WatchClock,
): string[] {
  if (!p.services.length) return [];
  const rows = p.services.map((s, i): Cell[] => {
    // All operational takes no colour; only the degraded rows stand out.
    const row = s.indicator === 'none' ? undefined : SERVICE_TONE[s.indicator];
    return [
      gutter(`service:${s.name}`, view.selected),
      { text: i === 0 ? SERVICE_LABEL : '', tone: 'dim' },
      { text: s.name, tone: row ?? 'bold' },
      { text: SERVICE_GLYPH[s.indicator], tone: SERVICE_TONE[s.indicator] },
      { text: s.error ?? s.description, tone: s.error === null ? (row ?? 'ok') : 'dim' },
      { text: truncateDisplay(s.degraded.join(' / '), layout.service), tone: row ?? 'dim' },
    ];
  });
  // The session line is **not** a row of the table: as a cell it would widen the name column to
  // its own length and push every other column right, the same reason a task command and a
  // session title get rows of their own.
  return renderCells(rows, paint).flatMap((line, i) => {
    const session = quotaSessionUnder(p.services[i].name, p.quotaSessions ?? []);
    if (session === null) return [line];
    return [line, SESSION_INDENT + paint(quotaSessionLine(session, p.nowMs, clock), 'dim')];
  });
}
