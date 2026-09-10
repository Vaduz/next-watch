/** What can be **selected** on the screen, and what can be **typed at it**. Pure functions
 *  only: no filesystem, no process, no clock.
 *
 *  The operable rows on the screen are flattened into one sequence. Tab moves forward through
 *  it and Shift-Tab back. The order is **the order things appear on screen** (servers, tasks,
 *  sessions, services, CLIs, log panes) so the eye and the hand move the same way.
 *
 *  A key (`server:admin`) is built from **identity, not from position**. Tasks and sessions
 *  are re-read every second and move within their arrays, so remembering a position would
 *  quietly move the selection to a different row.
 *
 *  Split by meaning under `watchTargets/`:
 *    - `targets.ts` — what can be selected (the targets per kind, their order, cursor movement)
 *    - `verbs.ts` — what can be typed (initials, reading a command line, the help text)
 *
 *  This file holds only the vocabulary those two share: the shape of one selectable thing.
 *  Callers import the children directly. */

export type WatchTargetKind = 'ssh' | 'server' | 'task' | 'session' | 'service' | 'tool' | 'pane';

/** One selectable thing. */
export interface WatchTarget {
  /** Of the form `server:admin`. Built from **identity, not row position**, so it keeps
   *  pointing at the same thing across a re-read. */
  key: string;
  kind: WatchTargetKind;
  /** The identifier within that kind (server name, task id, pid, service name, CLI name,
   *  pane name). */
  id: string;
  /** The verbs that can be typed. **Only the ones that actually apply**; an empty list means
   *  the row can be selected but nothing can be done to it. */
  verbs: readonly string[];
  /** Why nothing can be done. The command line shows this when there are no verbs. */
  note?: string;
  /** Where a signal would go (task, session). */
  pid?: number;
  /** What `open` would open (service). */
  url?: string;
  /** The tmux pane to restart into (session). */
  pane?: string;
  /** The line typed into that pane to restart it (session). */
  resume?: string;
}
