/** **What can be typed** at whatever is selected: the shortcut letters, how a typed line is
 *  read, and the wording shown. Which verbs a target has is `targets.ts`'s decision, made from
 *  its state; this file only binds that list to a keypress and to a typed line. */
import type { WatchTarget } from '../watchTargets.js';

/** The shortcut letter for each verb. The screen shows them as `(u)pdate`, and pressing that
 *  one letter runs it immediately.
 *
 *  `stop` and `start` begin with the same letter, so `start` takes an interior one
 *  (`st(a)rt`). No target may carry two verbs with the same shortcut — a keypress has to have
 *  exactly one meaning. */
const VERB_KEYS: ReadonlyMap<string, string> = new Map([
  ['restart', 'r'],
  ['stop', 's'],
  ['start', 'a'],
  ['kill', 'k'],
  ['open', 'o'],
  ['update', 'u'],
  ['add', 'a'],
  ['focus', 'f'],
  ['help', 'h'],
  ['quit', 'q'],
]);

/** The verb with its shortcut bracketed (`update` -> `(u)pdate`). A verb without one is
 *  returned unchanged. */
export function verbLabel(verb: string): string {
  const key = VERB_KEYS.get(verb);
  if (key === undefined) return verb;
  const at = verb.indexOf(key);
  return at < 0 ? verb : `${verb.slice(0, at)}(${key})${verb.slice(at + 1)}`;
}

/** The verb a keypress means, or null.
 *
 *  The selected target's verbs are consulted first, then `help` and `quit`. Nothing overlaps
 *  today, but this order makes **what is on screen** win if anything ever does. */
export function shortcutVerb(target: WatchTarget | null, char: string): string | null {
  const key = char.toLowerCase();
  const hit = target?.verbs.find(v => VERB_KEYS.get(v) === key);
  if (hit !== undefined) return hit;
  for (const verb of ['help', 'quit']) {
    if (VERB_KEYS.get(verb) === key) return verb;
  }
  return null;
}

/** How a typed command line is read. */
export type WatchCommand =
  | { kind: 'none' }
  | { kind: 'quit' }
  | { kind: 'help' }
  | { kind: 'run'; target: WatchTarget; verb: string }
  | { kind: 'error'; message: string };

/** Verbs that work anywhere, including with nothing selected. */
const GLOBAL: Record<string, WatchCommand['kind']> = {
  quit: 'quit',
  exit: 'quit',
  q: 'quit',
  help: 'help',
  '?': 'help',
  h: 'help',
};

/** Read a typed line. **Only a verb is typed**; the target is whatever Tab has selected. */
export function parseWatchCommand(line: string, target: WatchTarget | null): WatchCommand {
  const verb = line.trim().toLowerCase();
  if (verb === '') return { kind: 'none' };
  const global = GLOBAL[verb];
  if (global === 'quit') return { kind: 'quit' };
  if (global === 'help') return { kind: 'help' };
  if (target === null) return { kind: 'error', message: `nothing selected - press Tab first (or type help)` };
  if (target.verbs.includes(verb)) return { kind: 'run', target, verb };
  const can = target.verbs.length ? target.verbs.join(' | ') : (target.note ?? 'nothing');
  return { kind: 'error', message: `"${verb}" does not apply to ${target.key} (${can})` };
}

/** The line shown under the frame: what can be done to the selected target, with the
 *  shortcut letters bracketed. */
export function verbHint(target: WatchTarget | null): string {
  if (target === null) return `Tab select · up/down scroll · ${verbLabel('help')} · ${verbLabel('quit')}`;
  if (target.verbs.length) return `${target.key}  ${target.verbs.map(verbLabel).join(' | ')}`;
  return `${target.key}  ${target.note ?? 'nothing to do here'}`;
}

/** The width every help line is written to fit.
 *
 *  ⚠️ **Eighty, and the reason is other people's terminals.** These lines are printed three
 *  ways: inside the frame, where anything longer wraps and costs a row; in `--help`, where
 *  yargs indents them by two; and in the README, which has to match the real output and which
 *  GitHub scrolls sideways past about ninety. Eighty is the width that survives all three, so
 *  `HELP_WIDTH` is asserted as a table rather than left to whoever edits the wording next. */
export const HELP_WIDTH = 80;

/** What `help` prints: the key bindings, and the verbs each kind of target has.
 *
 *  Every line is kept **within `HELP_WIDTH`** — see the note there. Splitting a thought across
 *  two lines is preferred to trimming the thought. */
export function helpLines(): string[] {
  return [
    'Tab / Shift-Tab  move the cursor · up/down  scroll the log pane · Esc  clear',
    'press the letter in ( ) to run that verb on what the cursor is on',
    '":" types a whole verb instead',
    'server: (r)estart | (s)top | st(a)rt · task: (k)ill | (s)top',
    'session: (r)estart | (s)top · service: (o)pen · tool: (u)pdate',
    'session (r)estart = SIGTERM, then type its resume command back',
    'into the same tmux pane',
    'log pane: (f)ocus to fill the frame, again to go back',
    'ssh: (a)dd  run ssh-add here (only shown while the agent has no key)',
    'anywhere: (h)elp | (q)uit',
  ];
}

/** The name shown while a verb runs, so the line says what is being waited on. The kind
 *  prefix (`server:`) is dropped because the screen already makes it obvious. */
export function actionLabel(target: WatchTarget, verb: string): string {
  return `${verb} ${target.key.replace(/^[a-z]+:/, '')}`;
}
