/** **Whether a command can be run here.**
 *
 *  The watcher opens a CLI's quota window by running it, and a machine with only one of the two
 *  agent CLIs installed must not collect a failed spawn every time a window closes. Asked once,
 *  at the first look, and the answer is remembered.
 *
 *  `PATH` is searched directly rather than by running the command with `--version`: the answer
 *  is wanted before anything is spawned, and starting an agent CLI to find out whether an agent
 *  CLI exists is a second's work for a question the filesystem already answers. */
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

/** True when `command` is an executable file somewhere on `PATH`.
 *
 *  A command with a separator in it is not looked up at all: `PATH` is for bare names, and the
 *  callers here pass `claude` and `codex`. */
export function commandInstalled(command: string, pathEnv: string = process.env.PATH ?? ''): boolean {
  if (command === '' || command.includes('/')) return false;
  return pathEnv
    .split(delimiter)
    .filter(dir => dir !== '')
    .some(dir => {
      try {
        accessSync(join(dir, command), constants.X_OK);
        return true;
      } catch {
        // Not there, or there and not executable. Either way it cannot be run.
        return false;
      }
    });
}
