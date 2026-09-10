/** Looking at the local **ssh-agent**, and asking for a key when there is none.
 *
 *  One command is read, `ssh-add -l`; making sense of it is `core/sshAgentView.ts`. The rules
 *  are the same as for the tool versions: always a timeout, never throw, and within `ttlMs` the
 *  previous answer is returned so this can be called every tick.
 *
 *  ⚠️ Asking for the key (`promptSshAdd`) is only correct **while a person is at the terminal**.
 *  `ssh-add` reads the passphrase from `/dev/tty`, so calling it while the watcher still holds
 *  the terminal in raw mode means the typed characters are eaten by the watcher instead. Giving
 *  the terminal back first is the caller's responsibility. */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSshAddList } from '../core/sshAgentView.js';
import type { SshAgentCard } from '../core/types.js';

const LIST_TIMEOUT_MS = 5_000;

const run = promisify(execFile);

/** What `execFile` rejects with on a non-zero exit — only the parts this needs. */
interface ExecError {
  code?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  message?: unknown;
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Run `ssh-add -l` once. **Does not throw**: what cannot be read becomes an `unknown` card. */
async function readAgent(): Promise<SshAgentCard> {
  try {
    const { stdout } = await run('ssh-add', ['-l'], { timeout: LIST_TIMEOUT_MS, encoding: 'utf8' });
    return parseSshAddList(0, stdout);
  } catch (err) {
    const e = err as ExecError;
    // An exit code is itself the state (1 = no key, 2 = no agent). No code means `ssh-add` is
    // missing or could not be started, which is where `unknown` belongs.
    const code = typeof e.code === 'number' ? e.code : null;
    const output = `${asText(e.stdout)}${asText(e.stderr)}`.trim() || asText(e.message);
    if (code === null) return { state: 'unknown', keys: 0, error: output || String(err) };
    return parseSshAddList(code, output);
  }
}

let cache: { atMs: number; card: SshAgentCard } | null = null;

/** The ssh-agent card. Within `ttlMs` the previous answer is returned as is. */
export async function sshAgentCard(nowMs: number, ttlMs: number): Promise<SshAgentCard> {
  if (cache !== null && nowMs - cache.atMs < ttlMs) return cache.card;
  const card = await readAgent();
  cache = { atMs: nowMs, card };
  return card;
}

/** Forget what was read. Called **right after a key was added**: waiting out the TTL would
 *  leave the screen saying there is no key for a minute after one was typed in. */
function forgetSshAgent(): void {
  cache = null;
}

/** Let the person run `ssh-add` (the terminal takes the passphrase). The result says whether a
 *  key went in.
 *
 *  ⚠️ **Nothing is run without a terminal.** With stdin not a TTY, `ssh-add` goes looking for an
 *  askpass program and fails there, which would stop a piped watch on a question nobody can
 *  answer. */
export function promptSshAdd(): Promise<{ ok: boolean; detail: string | null }> {
  if (!process.stdin.isTTY) return Promise.resolve({ ok: false, detail: 'no terminal to ask for the passphrase' });
  return new Promise(resolve => {
    // The terminal is handed over whole: the question and the typing are both `ssh-add`'s.
    const child = spawn('ssh-add', [], {
      stdio: 'inherit',
      env: { ...process.env, SSH_ASKPASS_REQUIRE: 'never' },
    });
    const done = (ok: boolean, detail: string | null): void => {
      forgetSshAgent();
      resolve({ ok, detail });
    };
    child.on('error', err => {
      done(false, err.message);
    });
    child.on('close', (code, signal) => {
      // Ctrl-C means changing one's mind, not a failure, so the caller can word it that way.
      if (signal !== null) done(false, `cancelled (${signal})`);
      else done(code === 0, code === 0 ? null : `ssh-add exited with ${String(code)}`);
    });
  });
}
