/** **The single outlet for everything the watcher prints.**
 *
 *  On a terminal the screen is **redrawn in place**. Events are not streamed a line at a time;
 *  they collect in the panel's event pane and are drawn with it. Streaming them would stack
 *  rows outside the frame and push the one screen that says how things are off the top.
 *
 *  Off a terminal (a pipe, a redirect to a file) there is nothing to redraw, so events do
 *  stream a line at a time, and the heartbeat rewrites a single line as it goes.
 *
 *  Both paths go through here. Nothing else prints — a second writer would interleave with the
 *  redraw and put its own timestamp beside this one's.
 *
 *  The clock is injected, because the core does not pick a time zone of its own. */
import { type WatchEvent } from '../core/types.js';
import { detailLine, eventLine, painter, type Mark, type Paint, type Tone } from '../core/term/index.js';
import { clockWithOffset, type WatchClock, type WatchLayout } from '../core/view/index.js';
import { watchLayout } from '../core/view/layout.js';
import { renderBottomLine, renderHeartbeat, type BottomLineView } from '../core/view/outerLines.js';

/** How many events are kept for the pane. The watcher runs for days, so this cannot be
 *  unbounded, and the pane only ever uses the last few dozen. */
const HISTORY_LIMIT = 200;

/** Return to the start of the line and clear to its end, for rewriting one row in place. */
const CLEAR_LINE = '\r\u001b[2K';
/** Home the cursor / clear the rest of this row / clear everything below. */
const HOME = '\u001b[H';
const CLEAR_EOL = '\u001b[K';
const CLEAR_BELOW = '\u001b[J';

export class WatchScreen {
  readonly paint: Paint;
  /** How times are rendered. The core takes this rather than choosing a zone. */
  readonly clock: WatchClock;
  /** True on a terminal, where the screen is redrawn; false where lines are streamed. */
  readonly live: boolean;
  /** Where events are persisted. Nothing is kept when this is not supplied. */
  private readonly persist: ((event: WatchEvent) => void) | undefined;
  private beating = false;
  private frame = 0;
  /** The events so far, oldest first. The event pane takes them from the end. */
  private readonly history: WatchEvent[] = [];

  constructor(opts: { tty?: boolean; persist?: (event: WatchEvent) => void; timezoneOffsetMinutes?: number } = {}) {
    this.live = opts.tty ?? process.stdout.isTTY;
    this.paint = painter(this.live);
    this.persist = opts.persist;
    this.clock = clockWithOffset(opts.timezoneOffsetMinutes ?? -new Date().getTimezoneOffset());
  }

  /** Replay a previous watch's events into the pane. **They are not printed again**: they
   *  happened last time, and are not a record of this moment. */
  restore(events: readonly WatchEvent[]): void {
    this.history.push(...events.slice(-HISTORY_LIMIT));
  }

  /** The widths for the terminal's current size, **read on every call** because a terminal
   *  can be resized while the watcher runs. `logLines` and `accessLines` are the explicit
   *  `--log` and `--access`; null means fit them to the height. `bottomRows` is what the bottom
   *  line costs, which is more than one row when it wraps. */
  layout(logLines: number | null = null, accessLines: number | null = null, bottomRows = 1): WatchLayout {
    // On a terminal the bottom line sits outside the panel, so the height loses those rows.
    // Without that the screen overflows, scrolls on every redraw, and the top runs away.
    const rows = process.stdout.rows;
    const height = this.live && typeof rows === 'number' ? rows - Math.max(1, bottomRows) : rows;
    return watchLayout(process.stdout.columns, height, logLines, accessLines);
  }

  /** Every event so far, oldest first. */
  events(): readonly WatchEvent[] {
    return this.history;
  }

  /** Draw one screen. On a terminal this **overwrites from the top left**, leaving the
   *  scrollback alone; elsewhere the rows are simply streamed. */
  render(out: readonly string[]): void {
    if (!this.live) {
      this.lines(out);
      return;
    }
    // No newline after the last row: it would push the cursor one row past the bottom and
    // scroll the screen.
    process.stdout.write(`${HOME}${out.map(l => `${l}${CLEAR_EOL}`).join('\n')}${CLEAR_BELOW}`);
  }

  /** Stream rows as they are. Not used on a terminal, where nothing goes outside the frame. */
  lines(out: readonly string[]): void {
    this.clearBeat();
    for (const line of out) process.stdout.write(`${line}\n`);
  }

  /** One timestamped row. **Every event has this shape.** On a terminal it only collects, and
   *  appears in the event pane at the next redraw. */
  event(atMs: number, mark: Mark, text: string, tone?: Tone): void {
    const event: WatchEvent = { atMs, mark, text, tone };
    this.history.push(event);
    if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
    this.persist?.(event);
    if (!this.live) this.lines([eventLine(this.clock.time(atMs), mark, text, this.paint, tone)]);
  }

  /** The detail under the event just emitted (the commits, why a pull was refused). On a
   *  terminal it collects like any event, so nothing lands outside the frame. */
  detail(text: string): void {
    if (this.live) {
      this.event(Date.now(), 'info', `  ${text}`, 'dim');
      return;
    }
    this.lines([detailLine(text)]);
  }

  /** The row shown while waiting. **Not used on a terminal**, where the redrawn screen's last
   *  row does the same job. */
  beat(o: { nowMs: number; startedAtMs: number; head: string; nextCheckSeconds: number; note: string | null }): void {
    if (this.live) return;
    const line = renderHeartbeat({ ...o, frame: this.frame++ }, this.paint, this.clock);
    process.stdout.write(`${CLEAR_LINE}${line}`);
    this.beating = true;
  }

  /** The bottom line, rebuilt at every redraw: **the controls** while nothing is happening,
   *  and the command line while something is being typed. It wraps when it does not fit, so it
   *  can be more than one row, and the caller subtracts that from the height. */
  bottom(ui: Omit<BottomLineView, 'frame'>, width: number): string[] {
    return renderBottomLine({ ...ui, frame: this.frame++ }, this.paint, width);
  }

  /** Erase the heartbeat row, if one is showing. */
  clearBeat(): void {
    if (!this.beating) return;
    process.stdout.write(CLEAR_LINE);
    this.beating = false;
  }
}
