/** Running git. Nothing here decides anything: which paths may be pulled and which servers to
 *  restart is `core/plan.ts`.
 *
 *  **Everything is asynchronous.** The watcher redraws once a second and picks keys up as they
 *  are pressed, so a synchronous spawn would stop the event loop: the two seconds of a fetch
 *  would take the keyboard and the clock with it (measured 2026-08-21).
 */
import { spawn, spawnSync } from 'node:child_process';

/** git's output can be far larger than a default 1MB buffer, so take a generous cap.
 *  `spawn` has no `maxBuffer`, so it is counted here: a broken repository writing endlessly to
 *  stderr must not eat the watcher's memory. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** An environment with `GIT_DIR`, `GIT_INDEX_FILE` and every other `GIT_*` removed.
 *
 *  **A process started from a git hook has these set**, and inheriting them would operate on
 *  the repository the environment points at rather than the one `cwd` is in — which really did
 *  once make a test rewrite a real repository's config. Stripping them means `cwd` alone
 *  decides which repository is touched. */
export function scrubGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(env)) {
    // Reflect.deleteProperty rather than `delete`: a dynamic-key delete is banned by lint.
    if (key.startsWith('GIT_')) Reflect.deleteProperty(env, key);
  }
  return env;
}

/** Start git and resolve with its exit code and output. This never throws. */
function spawnGitAsync(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string; stderr: string; error: Error | null }> {
  return new Promise(resolve => {
    const child = spawn('git', [...args], { cwd, env });
    const chunks = { stdout: '', stderr: '' };
    let bytes = 0;
    let truncated = false;
    const collect = (key: 'stdout' | 'stderr') => (chunk: string) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      chunks[key] += chunk;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', error => {
      resolve({ status: null, stdout: '', stderr: error.message, error });
    });
    child.on('close', status => {
      const note = truncated ? `\n(output over ${MAX_OUTPUT_BYTES} bytes was cut)` : '';
      resolve({ status, stdout: chunks.stdout, stderr: `${chunks.stderr}${note}`, error: null });
    });
  });
}

/** Run git as a step that must succeed. A failure throws with stderr attached. */
export async function runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const res = await spawnGitAsync(cwd, args, scrubGitEnv(env ?? process.env));
  if (res.error) throw new Error(`git ${args.join(' ')} could not be run: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${String(res.status)}:\n${res.stderr}${res.stdout}`);
  }
  return res.stdout;
}

/** The result of a git command that is allowed to fail. */
export interface TryGitResult {
  ok: boolean;
  /** stderr and stdout together, for showing a person what happened. */
  out: string;
  stdout: string;
  stderr: string;
}

function toTryResult(res: {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}): TryGitResult {
  if (res.error) return { ok: false, out: res.error.message, stdout: '', stderr: res.error.message };
  return { ok: res.status === 0, out: `${res.stderr}${res.stdout}`, stdout: res.stdout, stderr: res.stderr };
}

/** Run git where failure is an ordinary outcome. */
export async function tryGit(cwd: string, args: string[]): Promise<TryGitResult> {
  return toTryResult(await spawnGitAsync(cwd, args, scrubGitEnv()));
}

/** Run git with **no chance of an authentication prompt**.
 *
 *  The watcher fetches over and over with nobody present. On a clone whose remote is https,
 *  the moment the credentials expire git tries to ask the terminal, and with no terminal there
 *  it simply hangs — the next poll never comes and the watch dies without a word.
 *  `GIT_TERMINAL_PROMPT` is set **after** the scrub, so the caller's environment is untouched. */
export async function tryGitNonInteractive(cwd: string, args: string[]): Promise<TryGitResult> {
  const env: NodeJS.ProcessEnv = { ...scrubGitEnv(), GIT_TERMINAL_PROMPT: '0' };
  return toTryResult(await spawnGitAsync(cwd, args, env));
}

/** Whether the checkout is on the expected branch. The wording is the caller's, because what
 *  it means to be on another branch differs by what is about to happen. */
export type BranchCheck = { ok: true } | { ok: false; branch: string };

/** Read the current branch and compare it. Synchronous on purpose: this runs once at startup,
 *  before anything is drawn, so there is no screen to keep responsive yet. */
export function checkBranch(repoRoot: string, branch: string): BranchCheck {
  const res = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: scrubGitEnv(),
  });
  const current = res.stdout.trim();
  return current === branch ? { ok: true } : { ok: false, branch: current };
}
