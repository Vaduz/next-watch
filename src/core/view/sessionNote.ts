/** **What a session row has to say about itself beyond its columns.** Pure.
 *
 *  Only one thing so far: that it is not running inside a tmux pane, and what that costs. A
 *  session started from a plain shell is listed and can be stopped like any other, but it
 *  **cannot be restarted** — a restart here means "stop it, then have its pane's shell type the
 *  resume command again", and there is no pane to type into.
 *
 *  ⚠️ **The same condition the restart verb uses**, and for the same reason it exists: a row that
 *  quietly lacks a verb reads as a bug in the watcher rather than as a fact about the session.
 *  `watchTargets/targets.ts` offers `restart` when there is a pane (and a resume command); this
 *  says so on the screen when there is not, so the two cannot tell the reader different things. */
import type { AgentSessionRow } from '../types.js';

/** The note, kept short enough to hang under a row on an eighty-column terminal. The `(h)elp`
 *  text and the README use this same wording. */
export const NO_TMUX_NOTE = 'not in tmux · (r)estart needs tmux';

/** What to say under a session row, or null when it has nothing to add.
 *
 *  The watcher's own session is never given one: it is offered no verbs at all, so naming a verb
 *  it does not have would only be confusing.
 *
 *  ⚠️ A machine **without tmux installed** answers the same as a session started outside it —
 *  both have no pane. That is deliberate: the reader's position is identical either way, and the
 *  note names what is missing rather than guessing which of the two caused it. */
export function sessionRestartNote(s: AgentSessionRow): string | null {
  if (s.self === true) return null;
  return (s.pane ?? null) === null ? NO_TMUX_NOTE : null;
}
