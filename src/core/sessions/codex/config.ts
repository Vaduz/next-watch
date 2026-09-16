/** **The model a Codex config file names**, as the last fallback for a session's model. Pure.
 *
 *  ⚠️ **Not a TOML parser, and not trying to be.** One key is wanted — the top-level `model` —
 *  and `~/.codex/config.toml` on a machine that has been used for a while holds project tables,
 *  hook state and connector settings, several of which have a `model` key of their own. Pulling
 *  in a TOML dependency to read one line would be a dependency for the life of the package;
 *  reading **only what precedes the first table header** answers the question exactly and cannot
 *  wander into `[tui]` or `[projects."…"]`.
 *
 *  A profile is a **separate file** in codex 0.154.0 (`-p name` layers
 *  `$CODEX_HOME/name.config.toml` over the base one), so it is read by the same function against
 *  that file rather than by looking for a table. */
import { str } from '../codex.js';

/** `model = "gpt-6-astra"`, in either quote style, with either kind of spacing. **One capture
 *  group**, because an alternation would leave the compiler and the reader disagreeing about
 *  which of two groups is a string. A file that opens with one quote and closes with the other
 *  is not TOML, and reading it generously costs nothing. */
const MODEL = /^model\s*=\s*["']([^"']*)["']\s*(?:#.*)?$/;

/** The top-level `model` a config file names, or null.
 *
 *  Only the lines **before the first table header** are looked at: everything after one belongs
 *  to that table, and a `model` inside `[tui]` is not this session's model. */
export function codexConfigModel(toml: string): string | null {
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    // The first table header ends the part of the file that is about the CLI itself.
    if (line.startsWith('[')) return null;
    if (line === '' || line.startsWith('#')) continue;
    const found = MODEL.exec(line);
    if (found !== null) return str(found[1]);
  }
  return null;
}
