/** **What the command line a Codex session was started with says** about which model it runs.
 *  Pure: a string in, two readings out.
 *
 *  This is a fallback, not the answer. The rollout carries the model the session is *actually*
 *  on, including one changed with `/model` part-way through; the command line only says what it
 *  was asked for at the start. It is read when the rollout said nothing — a session that has not
 *  taken a turn yet has no `turn_context` in it. */
import { str } from '../codex.js';

/** What a `codex` command line names. Both are null when it names neither. */
export interface CodexInvocation {
  /** `-m` / `--model`. */
  model: string | null;
  /** `-p` / `--profile`, which in 0.154.0 layers `$CODEX_HOME/<name>.config.toml` on top of the
   *  base config — a whole file, not a table inside one. */
  profile: string | null;
}

/** The value of a flag written either way round (`-m sol`, `-m=sol`), or null. */
function flagValue(words: readonly string[], short: string, long: string): string | null {
  for (const [at, word] of words.entries()) {
    for (const flag of [short, long]) {
      if (word === flag) return str(words[at + 1]);
      if (word.startsWith(`${flag}=`)) return str(word.slice(flag.length + 1));
    }
  }
  return null;
}

/** Read a `ps` command column.
 *
 *  ⚠️ **Split on whitespace, which is what `ps` gives.** A model name or a profile name with a
 *  space in it would be read short; both are identifiers in practice, and the alternative —
 *  reading `/proc/<pid>/cmdline` for its NUL separators — is a second file read per session per
 *  second for a fallback that is almost never reached. */
export function codexInvocation(command: string): CodexInvocation {
  const words = command.split(/\s+/u).filter(w => w !== '');
  return {
    model: flagValue(words, '-m', '--model'),
    profile: flagValue(words, '-p', '--profile'),
  };
}
