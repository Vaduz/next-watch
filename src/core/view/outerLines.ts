/** Rows that go **outside the frame**: the startup banner, the bottom line, the spinner.
 *
 *  The panel folds into a frame; these three have none and use the same indent as an event
 *  row. Each is one shot and holds no state — even the spinner's frame number is counted by
 *  the caller. */
import { truncateDisplay, wrapDisplay } from '../term/index.js';
import { markGlyph, type Paint } from '../term/index.js';
import { since, type WatchClock } from './index.js';

/** The startup banner. No frame, and the same indent as the event rows that follow. */
export function renderBanner(
  o: {
    nowMs: number;
    root: string;
    branch: string;
    head: string;
    intervalSeconds: number;
    dryRun: boolean;
    panelSeconds: number;
    /** What is being watched, for the banner (`origin/main`). */
    remote: string;
  },
  paint: Paint,
): string[] {
  const modes = [
    `git every ${o.intervalSeconds}s`,
    o.panelSeconds > 0 ? `panel every ${o.panelSeconds}s` : 'no panel',
    o.dryRun ? 'dry-run' : '',
  ].filter(m => m !== '');
  return [
    '',
    `  ${paint('next-watch', 'bold')} ${paint(`watching ${o.remote}`, 'dim')}  ${paint(modes.join(' · '), 'dim')}`,
    `  ${paint(o.root, 'dim')}  ${paint(o.branch, 'bold')} ${paint(o.head.slice(0, 7), 'accent')}  ${paint('Ctrl-C to stop', 'dim')}`,
    '',
  ];
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** What the bottom line shows. **One thing at a time, by priority**, wrapped if it does not
 *  fit the width. */
export interface BottomLineView {
  /** What has been typed so far, or null when the command line is not open. */
  input: string | null;
  /** The result of the last command (a typo, say). The next keypress clears it. */
  status: string | null;
  /** The name of the action currently running; no further command is accepted meanwhile. */
  busy: string | null;
  /** The result of an action that just finished, shown for a few seconds. */
  flash: { text: string; ok: boolean } | null;
  /** What can be typed at whatever the cursor is on (`verbHint`). */
  hint: string;
  /** The spinner's frame, counted the same way as in `renderHeartbeat`. */
  frame: number;
}

/**
 * The bottom line. **One thing at a time, by priority**: a running action, then what is being
 * typed, then the last result, then a finished action's result, then what can be typed.
 *
 * A running action wins because an install or a build takes tens of seconds. With only the
 * spinner moving, it looks like the keypress did nothing.
 *
 * A typo (`status`) outranks a finished action's result (`flash`) because `status` comes from
 * **the current keypress**: whatever is newer than the action wins.
 *
 * While nothing is happening, only **the controls** are shown. The time, the uptime and the
 * sync state already live in the panel's title and its repository row, and are not repeated.
 *
 * It wraps rather than truncating, so a long hint — which means many verbs are available —
 * does not lose its tail. The number of rows returned is also its share of the terminal's
 * height, so the caller shrinks the panel by exactly this much.
 */
export function renderBottomLine(v: BottomLineView, paint: Paint, width: number): string[] {
  const spin = SPINNER[v.frame % SPINNER.length];
  const line = ((): string => {
    if (v.busy !== null) {
      return `  ${paint(spin, 'warn')} ${paint(`busy: ${v.busy}`, 'warn')} ${paint('· the panel keeps updating', 'dim')}`;
    }
    if (v.input !== null) return `  ${paint('>', 'accent')} ${v.input}${paint('▏', 'accent')}  ${paint(v.hint, 'dim')}`;
    if (v.status !== null) return `  ${paint('▲', 'warn')} ${paint(v.status, 'warn')}`;
    if (v.flash !== null) return flashLine(v.flash, paint, width);
    return `  ${paint(spin, 'accent')} ${paint(v.hint, 'dim')}`;
  })();
  return wrapDisplay(line, Math.max(0, width), '    ');
}

/** A finished action's result, **always on exactly one row** (truncated if need be). Wrapping
 *  would grow the bottom line's share for a few seconds, shrinking and then restoring the
 *  panel — the screen would jump at every action. The glyph is the same one the event log
 *  uses, because the same event appears in both places. */
function flashLine(flash: { text: string; ok: boolean }, paint: Paint, width: number): string {
  const glyph = markGlyph(flash.ok ? 'cmd' : 'error');
  // The glyph and the spaces around it (`  ` + glyph + ` `) cost four cells.
  const text = truncateDisplay(flash.text, Math.max(0, width - 4));
  return `  ${paint(glyph, flash.ok ? 'ok' : 'bad')} ${paint(text, flash.ok ? 'ok' : 'bad')}`;
}

/** The row shown while waiting, rewritten in place on a TTY. **It leaves no history.** */
export function renderHeartbeat(
  o: {
    nowMs: number;
    startedAtMs: number;
    head: string;
    nextCheckSeconds: number;
    frame: number;
    note: string | null;
  },
  paint: Paint,
  clock: WatchClock,
): string {
  const spin = paint(SPINNER[o.frame % SPINNER.length], 'accent');
  const parts = [
    paint(clock.time(o.nowMs), 'dim'),
    o.note ?? paint(`in sync ${o.head.slice(0, 7)}`, 'dim'),
    paint(`up ${since(o.nowMs, o.startedAtMs)}`, 'dim'),
    paint(`next git check ${Math.max(0, o.nextCheckSeconds)}s`, 'dim'),
  ];
  return `  ${spin} ${parts.join(paint(' · ', 'dim'))}`;
}
