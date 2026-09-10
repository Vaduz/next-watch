/** The verbs that act on **the tools on this machine**: open a page in a browser, install a new
 *  release of a CLI, add a key to the ssh-agent. */
import fs from 'node:fs';
import path from 'node:path';
import { forgetInstalledVersions } from '../../io/toolVersions.js';
import { promptSshAdd } from '../../io/sshAgent.js';
import { UPDATE_TIMEOUT_MS, spawn, streamCommand, type ActionContext, type Emit } from './stream.js';

/** How to open a URL, tried in order and the first one on PATH wins.
 *
 *  Under WSL, `wslview` or `explorer.exe` hands it to the Windows browser. `xdg-open` is not
 *  first because it is often installed there and fails silently without an X server. On plain
 *  Linux neither of the Windows two is on PATH, so it falls to `xdg-open`; on macOS to `open`. */
const OPENERS: readonly string[] = ['wslview', 'explorer.exe', 'xdg-open', 'open'];

/** Find something runnable on PATH **without starting a process**. Asking a shell would put its
 *  deprecation notices on stderr, straight into a screen that redraws every second. */
function onPath(command: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir === '') continue;
    const file = path.join(dir, command);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {
      /* look at the next one */
    }
  }
  return null;
}

/** Open a URL, and say whether it opened — otherwise pressing the key does nothing visible. */
export function openUrl(url: string, emit: Emit): boolean {
  if (url === '') {
    emit('warn', 'no URL to open');
    return false;
  }
  const opener = OPENERS.find(c => onPath(c) !== null);
  if (opener === undefined) {
    emit('warn', `no way to open a URL here (tried ${OPENERS.join(', ')}): ${url}`);
    return false;
  }
  // The browser outlives the watcher, so it is detached and not waited for. `explorer.exe`
  // returns 1 even when it worked, so the exit code is not read.
  spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
  emit('step', `opened ${url} (${opener})`);
  return true;
}

/** Install a new release of a CLI (`<name> update`).
 *
 *  Its output becomes events **line by line as it arrives**. An update that downloads takes tens
 *  of seconds, and holding the output until the end would leave the screen silent for all of it.
 *
 *  Afterwards the remembered versions are dropped and read again **at once**. The version TTL is
 *  ten minutes, and waiting it out would leave the panel showing the old version long after the
 *  update finished. A failure is re-read too, to confirm nothing moved. */
export async function updateTool(name: string, ctx: ActionContext): Promise<boolean> {
  const result = await streamCommand({
    command: name,
    args: ['update'],
    timeoutMs: UPDATE_TIMEOUT_MS,
    emit: ctx.emit,
  });
  if (!result.ok) ctx.emit('error', `${name} update failed: ${result.detail ?? 'unknown error'}`);
  forgetInstalledVersions();
  // That the version moved is said once, as a difference, by the version report.
  await ctx.refreshVersions?.();
  return result.ok;
}

/** Let the person add a key to the ssh-agent.
 *
 *  ⚠️ **Give the terminal back first.** `ssh-add` reads the passphrase from `/dev/tty`, so while
 *  the watcher holds stdin in raw mode the keystrokes go to the watcher and the redraw paints
 *  over the question. For the duration of `withTerminalPaused` the terminal is `ssh-add`'s. */
export async function addSshKey(ctx: ActionContext): Promise<boolean> {
  const paused = ctx.withTerminalPaused ?? (<T>(body: () => Promise<T>) => body());
  const result = await paused(() => promptSshAdd());
  if (!result.ok) {
    ctx.emit('warn', `ssh-add did not add a key: ${result.detail ?? 'cancelled'}`);
    return false;
  }
  ctx.emit('step', 'ssh-add: key added');
  return true;
}
