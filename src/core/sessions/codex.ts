/** Reading the **live Codex sessions**. Pure functions: no filesystem, no processes.
 *
 *  Codex appends to `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<time>-<id>.jsonl`, one file
 *  per thread. There is no small "current state" file like the other CLI's, so a row is built
 *  by reading **only the head and the tail of that same jsonl**.
 *
 *   - The first line, `session_meta` — the thread id, the cwd, the CLI version it started
 *     with, and where it came from. **It is never rewritten.**
 *   - Near the head — the first user message (the name) and the first settings line (the model).
 *   - The tail — the state (`task_started`, `task_complete`, `turn_aborted`), the model, the
 *     context size.
 *
 *  ⚠️ **Only threads with a person at them belong in the list.** Two other kinds share the
 *  format.
 *
 *   - `originator: 'codex_exec'` — a programmatic invocation, not a person's terminal.
 *   - `thread_source: 'subagent'` — a subagent the TUI starts inside itself. **It is written by
 *     the same process at the same time**, so leaving it in makes one terminal look like two
 *     rows.
 *
 *  What lives here is **the reading and the folding**: a fragment of jsonl into a row. Split by
 *  meaning under `sessions/codex/`:
 *    - `rollout.ts` — one line of a rollout, and the `session_meta` on the first
 *    - `tip.ts` — the facts near the head (name, model) and the state at the tail
 *    - `row.ts` — folding into one row
 *
 *  This file holds only what two or more of those share. */

/** Read a rollout value as a string. **This is not the same as the general `asString`**: it
 *  keeps the surrounding whitespace, because tidying a prompt into a name is `tip.ts`'s job. */
export const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
