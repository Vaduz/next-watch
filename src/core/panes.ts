/** Which log panes exist. **Derived from the panel, not from a fixed list.**
 *
 *  A package cannot know how many dev servers a repository runs, so the panes are the event
 *  log plus one per server that has an access pane. A repository with one server gets two
 *  panes; one with five gets six. */
import type { PaneName, WatchPanel } from './types.js';

/** The pane that always exists: the watcher's own event log. */
export const EVENT_PANE = 'event';

/** Pane names in the order they appear on screen: the event log first, then the servers in the
 *  order the panel lists them. */
export function paneNamesOf(panel: Pick<WatchPanel, 'access'>): PaneName[] {
  return [EVENT_PANE, ...Object.keys(panel.access)];
}
