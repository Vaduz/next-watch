/** The **state machine for keypresses**. Nothing here touches a terminal or the disk: given a
 *  key and the current state, it returns the next state and what to do about it.
 *
 *  It is pure because behaviour against a raw-mode terminal **cannot be checked as a table**.
 *  The input adapter in the io layer copies readline's keys into this shape and no more. */
import type { WatchTarget } from './watchTargets.js';
import { resolveSelection, stepSelection, tabTargets } from './watchTargets/targets.js';
import type { PaneName } from './types.js';
import { EVENT_PANE } from './panes.js';
import { shortcutVerb } from './watchTargets/verbs.js';

/** A keypress, with only what is needed copied out of readline's `keypress`. */
export interface WatchKey {
  name?: string;
  sequence?: string;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

/** The interaction state of the screen. */
export interface WatchUi {
  /** The key of what is selected, or null for nothing. */
  selected: string | null;
  /** The last position selected, kept so that **the cursor moves to a neighbour** when the
   *  selected row disappears. */
  index: number;
  /** How far each pane is scrolled back; zero is the end, the newest row. */
  scroll: Record<PaneName, number>;
  /** The pane filling the frame, or null for the usual folded screen. */
  focus: PaneName | null;
  /** What has been typed so far; null means **the command line is not open**. */
  input: string | null;
  /** The last command's result (a typo, say). The next keypress clears it, so it leaves no
   *  history. */
  status: string | null;
  /** The name of the running action. **One at a time**: no further command is accepted while
   *  one runs. */
  busy: string | null;
  /** The result of an action that just finished. **A keypress does not clear it; time does**
   *  (see `visibleFlash`). */
  flash: WatchFlash | null;
}

/** A finished action's result, kept on the bottom line for a moment. `atMs` is when it ended. */
export interface WatchFlash {
  text: string;
  ok: boolean;
  atMs: number;
}

/** How long a result stays on the bottom line: long enough for whoever typed the action to
 *  look back, then the controls return. Nothing is lost when it goes, because the result is
 *  also in the event log. */
export const FLASH_TTL_MS = 3_000;

/** The result to show right now, or null once it has aged out. It comes back **without a
 *  timestamp**, so the code drawing the bottom line never learns when anything ended. */
export function visibleFlash(ui: WatchUi, nowMs: number): { text: string; ok: boolean } | null {
  const flash = ui.flash;
  if (flash === null) return null;
  if (nowMs - flash.atMs >= FLASH_TTL_MS) return null;
  return { text: flash.text, ok: flash.ok };
}

export const initialUi = (): WatchUi => ({
  selected: null,
  index: 0,
  scroll: { [EVENT_PANE]: 0 },
  focus: null,
  input: null,
  status: null,
  busy: null,
  flash: null,
});

/** What the outside should do after one key was consumed. */
export type WatchAction =
  | { kind: 'none' }
  /** Redraw: the selection, the scroll or the input moved. */
  | { kind: 'redraw' }
  /** Run the line that was typed. */
  | { kind: 'submit'; line: string }
  /** Stop watching (Ctrl-C). */
  | { kind: 'quit' };

/** What the cursor is on, found by identity so a moving list does not lose it. */
function selectedTarget(ui: WatchUi, targets: readonly WatchTarget[]): WatchTarget | null {
  const visible = tabTargets(targets, ui.focus);
  const key = resolveSelection(visible, ui.selected, ui.index).key;
  return visible.find(t => t.key === key) ?? null;
}

/** Which pane the arrow keys scroll: the focused one, or the selected one, and otherwise
 *  **the event pane** — what someone scrolls back to read is usually the events. */
export function scrollPane(ui: WatchUi, targets: readonly WatchTarget[]): PaneName {
  if (ui.focus !== null) return ui.focus;
  const target = selectedTarget(ui, targets);
  return target?.kind === 'pane' ? target.id : EVENT_PANE;
}

/** How far PageUp and PageDown move. */
const PAGE = 10;

function scrolled(ui: WatchUi, pane: PaneName, by: number, max: number): WatchUi {
  const at = ui.scroll[pane] ?? 0;
  const next = Math.max(0, Math.min(max, at + by));
  if (next === at) return { ...ui, status: null };
  return { ...ui, status: null, scroll: { ...ui.scroll, [pane]: next } };
}

/** Add a character to the typed line, opening the command line with it if it was closed. */
function typed(ui: WatchUi, char: string): WatchUi {
  return { ...ui, status: null, input: `${ui.input ?? ''}${char}` };
}

/** Erase one character. The command line stays open when it empties; Esc closes it. */
function erased(ui: WatchUi): WatchUi {
  if (ui.input === null) return ui;
  return { ...ui, status: null, input: ui.input.slice(0, -1) };
}

/** Esc closes **whatever is open, outermost first**: the command line, then the focus, then
 *  the selection. It also clears the result, which is the way to get the controls back at
 *  once; no other keypress clears it, since staying for a few seconds is the whole point. The
 *  first Esc, the one that only closes the command line, leaves it alone — while typing, the
 *  typed line wins because the result was never on screen. */
function escaped(ui: WatchUi): WatchUi {
  if (ui.input !== null) return { ...ui, input: null, status: null };
  if (ui.focus !== null) return { ...ui, focus: null, status: null, flash: null };
  return { ...ui, selected: null, status: null, flash: null };
}

/** Toggle a pane filling the frame, leaving the cursor on that pane so going back continues
 *  from where the reader was. */
export function toggleFocus(ui: WatchUi, pane: PaneName): WatchUi {
  const focus = ui.focus === pane ? null : pane;
  return { ...ui, focus, selected: `pane:${pane}`, status: null };
}

/** Move the cursor one step. The position is counted against **what the cursor can currently
 *  reach** — only the panes while one is focused. Mixing in the full list would send Tab
 *  somewhere else on the way back. */
function moved(ui: WatchUi, targets: readonly WatchTarget[], step: number): WatchUi {
  const next = stepSelection(tabTargets(targets, ui.focus), ui.selected, ui.index, step);
  return { ...ui, selected: next.key, index: next.index, status: null };
}

/** Whether this is a printable character, rejecting control characters and escape sequences. */
function printable(key: WatchKey): string | null {
  const seq = key.sequence;
  if (key.ctrl === true || key.meta === true) return null;
  if (seq?.length !== 1) return null;
  const code = seq.charCodeAt(0);
  return code >= 0x20 && code !== 0x7f ? seq : null;
}

/** The cursor, scroll and editing keys. Anything else returns null and is treated as typing. */
function navigate(
  ui: WatchUi,
  key: WatchKey,
  ctx: { targets: readonly WatchTarget[]; scrollMax: Readonly<Record<PaneName, number>> },
): WatchUi | null {
  const pane = scrollPane(ui, ctx.targets);
  const max = ctx.scrollMax[pane] ?? 0;
  switch (key.name) {
    case 'tab':
      return moved(ui, ctx.targets, key.shift === true ? -1 : 1);
    case 'up':
      return scrolled(ui, pane, 1, max);
    case 'down':
      return scrolled(ui, pane, -1, max);
    case 'pageup':
      return scrolled(ui, pane, PAGE, max);
    case 'pagedown':
      return scrolled(ui, pane, -PAGE, max);
    case 'escape':
      return escaped(ui);
    case 'backspace':
    case 'delete':
      return erased(ui);
    default:
      return null;
  }
}

/** Enter: run whatever has been typed, or do nothing when the line is empty. */
function submitted(ui: WatchUi): { ui: WatchUi; action: WatchAction } {
  if (ui.input === null) return { ui, action: { kind: 'none' } };
  return { ui: { ...ui, input: null, status: null }, action: { kind: 'submit', line: ui.input } };
}

/** The character that opens the command line, for typing a verb out in full when its initial
 *  would otherwise run it immediately. */
const COMMAND_PREFIX = ':';

/** One typed character: an initial runs its verb at once, anything else goes into the command
 *  line. While the command line is open, initials are ignored so nothing starts mid-word. */
function typedOrRun(ui: WatchUi, char: string, targets: readonly WatchTarget[]): { ui: WatchUi; action: WatchAction } {
  if (ui.input !== null) return { ui: typed(ui, char), action: { kind: 'redraw' } };
  if (char === COMMAND_PREFIX) return { ui: { ...ui, status: null, input: '' }, action: { kind: 'redraw' } };
  const verb = shortcutVerb(selectedTarget(ui, targets), char);
  if (verb === null) return { ui: typed(ui, char), action: { kind: 'redraw' } };
  return { ui: { ...ui, status: null }, action: { kind: 'submit', line: verb } };
}

/** Consume one key. `scrollMax` is **how far each pane can still be scrolled**, which follows
 *  from what was left over when it was drawn. */
export function applyKey(
  ui: WatchUi,
  key: WatchKey,
  ctx: { targets: readonly WatchTarget[]; scrollMax: Readonly<Record<PaneName, number>> },
): { ui: WatchUi; action: WatchAction } {
  // Ctrl-C does not raise SIGINT in raw mode, so stopping happens here.
  if (key.ctrl === true && key.name === 'c') return { ui, action: { kind: 'quit' } };
  if (key.name === 'return' || key.name === 'enter') return submitted(ui);
  const next = navigate(ui, key, ctx);
  if (next !== null) return { ui: next, action: { kind: 'redraw' } };
  const char = printable(key);
  if (char === null) return { ui, action: { kind: 'none' } };
  return typedOrRun(ui, char, ctx.targets);
}
