# Changelog

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
