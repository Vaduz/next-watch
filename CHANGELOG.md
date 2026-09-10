# Changelog

## 0.1.3

The SESSIONS section showed sessions that had been dead for months. On the machine this was
found on, a session that died in June was still drawn in September, idle for `90d3h` — that
figure is the age of the last status the file recorded, not an uptime, so nothing about the row
looked impossible.

The cause was a pid: over the months a watch runs, pids come round again, and both of the ghost
rows had had theirs taken over by a thread of a root daemon. Three separate checks were letting
them through, and all three are now stricter.

- **A pid that cannot be signalled is not one of ours.** `isAlive` counts `EPERM` as alive,
  which is right when the question is whether something still holds a port and wrong when it is
  whether a pid is this user's own session. Sessions now ask `isSignalable`, a new export
  alongside it; `isAlive` is unchanged, so nothing that depended on it moves.
- **The recorded start time is compared.** The CLI writes the process's `starttime` into the
  session file for exactly this purpose, and a mismatch against `/proc/<pid>/stat` now means the
  process at that number is a different one. Where `/proc` cannot be read — anywhere but Linux,
  or a record written before the field existed — the check abstains rather than guessing.
- **A pid with no `ps` row no longer passes.** It used to count as "cannot tell, so let it
  through", but a thread of another user's process has no row of its own while still answering
  `/proc`. The waiver now applies only when `ps` failed as a whole, where no pid has a row.

One row was also missing, and the same pass fixes it:

- **Background sessions are found.** They exec the versioned binary
  (`…/share/claude/versions/2.1.267 …`), whose last path segment is the version rather than a
  name, so the pattern that matched only a trailing `claude` did not see them. A path segment
  `claude` anywhere in the command is what counts now — a widening, so no shape that used to be
  found is lost.

## 0.1.2

More of what the first consumer needed, all of it about a host that already reads the same quota
from somewhere else on the machine.

- `writeSharedQuotaCache` is back in `next-watch/quota/io`. The watcher only ever reads the
  shared file, but the program that refreshes it on a schedule of its own has to write it, and
  that program wants the same module rather than its own copy of the format.
- `watchQuotaCards` derives the client name from `appName`, so a caller passes one thing instead
  of two that have to agree.
- `-v` is an alias for `--verbose`. It is what people reach for, and this is a command people run
  by hand.

## 0.1.1

Two gaps the first real consumer found, both about a host that runs the watch from a script of
its own rather than from the `next-watch` command.

- `parseArgs` takes options: `scriptName` for the name `--help` shows, and `config: false` to
  **remove `--config`** for a caller that hands `startWatch` a config it built in code. The
  option is not defined rather than hidden, so `--config` is refused outright instead of being
  accepted and ignored.
- `next-watch/core` exports `splitOutputLines`, `tailOutputLines`, `cleanOutputLine` and
  `OutputLineReader`. A server adapter that streams a build's output needs exactly these, and
  writing them again in the host would mean two copies of the escape-sequence stripping.

## 0.1.0

The first release.

Watches a remote branch, pulls it, and restarts only the servers the incoming paths affect. What
a repository is — which files must never arrive, which servers exist and how to restart one,
where its tasks are listed — arrives through `next-watch.config.mjs`; the package knows none of
it.

- **The pull is ordered so nothing is lost.** The fetch cannot raise an authentication prompt. An
  incoming path the policy blocks stops the pull entirely rather than overwriting a file a
  running process holds open. A build runs before anything is stopped, and only a build that
  passed leads to a restart.
- **One screen, redrawn in place**, with the servers, the tasks, the tail of each server's log
  and every event timestamped. Overflowing rows wrap rather than being cut. Off a terminal the
  panel is printed only when its content changed.
- **Operable from the keyboard**: Tab moves a cursor, a letter runs a verb on what it is on, the
  arrows scroll a pane. Leaving is refused once while something is running.
- **Optional sections for the machine itself**, each behind a switch and each absent unless it is
  on: agent sessions, usage quota, opening a closed quota window, public status pages, installed
  CLI versions, the ssh-agent.
- Subpath exports for the pure half (`/core`, `/term`, `/access-log`, `/quota`) and the readers
  (`/process`, `/quota/io`). `next-watch/quota` imports nothing from node, so a browser can use
  it.
