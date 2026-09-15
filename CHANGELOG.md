# Changelog

## Unreleased

- **The `(h)elp` text is written to 80 columns.** Its widest line was 91, so on an 80-column
  terminal the help wrapped inside the frame and cost rows, and `--help` wrapped it again after
  indenting it. The wording is unchanged where it fitted and split across two lines where it did
  not; a table asserts every line against `HELP_WIDTH`, so the next rewording cannot quietly grow
  past it. The README's copy of that block is the new output, as the rule requires.

- docs: the config example in the README was rewrapped so no line passes **80 columns**, which is
  where GitHub starts scrolling a code block sideways. The content is the same; the comments are
  broken across lines instead of running past the edge.

- docs: the dashboard capture in the README was retaken at **80 columns** and now shows the two
  sections it was missing — the live Claude and Codex sessions, and the service-status rows. The
  old one was 108 columns wide, which GitHub renders with a horizontal scrollbar, and it had
  `providers` empty, so the section people come for was not in the picture at all.

## 0.3.0

- **A server can be described in the config file instead of written out.** `servers` now takes
  `{ id, script, build?, preStart?, restartPaths? | ignorePaths?, label? }` beside the adapter
  form, and the two mix freely in one array. `{ id: 'dev', script: 'dev' }` is exactly what
  `--start dev` builds, so a repository that had to supply four functions to watch an ordinary
  `npm run dev` now supplies a line.

  - `build` runs before anything is stopped, and a build that fails leaves the running server
    serving — the rule every adapter here is held to, now had for free.
  - `preStart` prepares something before a start, as an npm script name or an
    `async (emit) => {}`. It runs **before the stop**, so the old server is still serving while it
    works and a restart adds no gap; a failure leaves that old server running, exactly as a failed
    build does. It does **not** run when the server is already up and the "start" turns out to be
    an adoption — preparing for a start that will not happen would rewrite what a live server is
    serving from.
  - `restartPaths` restarts only for paths under one of the given prefixes (`web/` covers that
    tree, and a whole file name works too). `ignorePaths` is the opposite: everything except
    those. Giving both is refused, because together they say nothing. Giving neither keeps what
    `--start` has always done.

  A config file with a server that has both `script` and `start`, or both path lists, or no id, is
  now refused by name rather than half-resolved.

  `--dry-run` now prints the steps each restart would take, rather than only that it would happen:
  `web: build (build) → preStart (prepare) → stop → start (dev)`. That is the new optional
  `describeRestart?` on `WatchServerAdapter`, which adapters written by hand leave out, because a
  function cannot be looked inside. `restartIfPrefixed` is exported from `next-watch/core` beside
  `restartUnless`.

  `--build` on the command line still belongs to the servers named with `--start`; a described
  entry carries its own.

- **`detached: true` on a described server keeps it running after the watch closes.** Until now
  every server next-watch spawned died with it, which is right for a dev server and wrong for the
  one actually serving a site: closing the dashboard should not take the site down.

  A detached server is spawned into its own process group with its output going straight to its
  log file — a pipe would die with the parent — and a note is left in
  `<logDir>/servers/<id>.pid`. The next watch reads that note and **adopts** the process, so
  reopening the dashboard shows the running server instead of failing to start a second one onto
  a port that is already taken. Its address comes from the log file, which remembers across runs.

  ⚠️ The note is trusted only when the process it names is still the one it was written about:
  alive, signalable by this user, and — on Linux, from `/proc/<pid>/stat` — started at the moment
  recorded. Where that start time cannot be read, the command line has to still name the script
  instead. Pids are reused, and signalling a stranger's process because a file three days old
  still names its number is the failure worth spending these checks to avoid. A note that fails
  them is removed as it is read.

  A start waits long enough afterwards to see the common failure — a port already taken — rather
  than reporting a server that is about to exit: unlike an ordinary child there is no handle to
  hear an exit on.

  It is **not** stopped when the watch exits; that is the point. Stopping it is something a person
  asks for, and `(s)top` signals the whole process group and takes the note away.

  **A described server is started when the watch starts**, exactly as a `--start` one is — the
  watcher spawns that child itself, so nothing else was ever going to. An adapter written by hand
  is still left alone, because whether its server is already running (under systemd, in another
  terminal, since last week) is the repository's business; it can ask by setting the new
  `autostart` on the adapter. Neither is started under `--once` or `--dry-run`.

- docs: README reorganized around what a reader does rather than how the package is built.
  Install and start come first (bun, with npm on the next line), then one section saying what the
  screen shows and what can be done to the thing under the cursor, then the config file, and only
  then the reference material. The config example now carries **every optional part, commented
  out, each with a line saying what turning it on gives you** — so the file can be read once
  instead of cross-referenced against three other sections.

  The dashboard capture and every command shown were taken from a real run against 0.2.0 in a
  throwaway project, and the `--help` block and the key list are byte-for-byte what the binary
  prints. No code changed.

## 0.2.0

- **`--start <script>` runs a server with no config file at all.** `npx next-watch --start dev`
  in a Next.js project set up the usual way now watches, serves and restarts without a line
  written down. Until this, watching a single project meant a four-function adapter
  (`start` / `stop` / `probe` / `restart`), and all four follow from the script name:

  - `start` spawns `<pm> run <script>`, where `<pm>` is read from the lockfile (`bun.lock` and
    `bun.lockb` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm,
    and npm where there is none). The flag is repeatable.
  - `stop` signals **the whole process tree**. `npm run dev` is the parent of the process that
    holds the port, so signalling only the pid that was spawned leaves the grandchild listening
    and the next start fails on an address already in use.
  - `probe` is whether that child is still there. The address comes from the child's own output
    (`- Local: http://localhost:3000`, and Next 12's `url:` line); a server that prints none is
    still reported up, with `-` for the address rather than a guess.
  - `restartOn` is `restartUnless([])` — everything except test files and root documents. A
    flag names a script and cannot say which paths its output depends on; a needless restart
    costs seconds and a missed one is invisible.

  The child's stdout and stderr are written to `<logDir>/<script>.txt`, so the existing
  access-log pane reads them with no change. `--build <script>` puts a build in front of the
  restart, with the rule the config file's own adapters are held to: **a failed build leaves
  the running server alone**.

  A config file and `--start` work together — the named scripts are appended to the file's own
  `servers`, and an id that is already taken is refused rather than silently doubled.

- **With no config file, every optional section is drawn except `quotaSession`.** There is
  nothing to read an intent from, and a first run showing an empty frame is one nobody runs
  twice. `quotaSession` is the switch that **starts a session of its own** to open a closed
  five-hour window, so it waits to be asked for with the new `--quota-session`. `tools` keeps
  its documented default. A config file's `providers` still wins over all of it.

- Servers named by `--start` are started when the watch starts and stopped when it exits, and
  **only on the watching path**: `--once` looks and leaves, and `--dry-run` is the promise that
  the run changes nothing, so neither spawns anything.

- **The install after a dependency change ran `npm install` in every project**, including one
  whose lockfile is `bun.lock`, `pnpm-lock.yaml` or `yarn.lock`. npm ignores a foreign lockfile,
  can write a `package-lock.json` of its own into the checkout, and leaves `node_modules` out of
  step with what the lockfile actually pins — on a machine nobody is sitting at, until somebody
  wonders why the running code does not match the lock.

  It now runs `<pm> install`, with the manager read from the lockfile: `bun.lock` and
  `bun.lockb` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm, and
  npm where there is none. The same reading `--start` uses for spawning a server, so one project
  can no longer be run with two managers.

  **The lockfile is read when the install is about to run**, not once when the watch started: a
  pull that swaps one lockfile for another is exactly the pull that moves the dependencies, and
  a manager remembered from startup would name the one the repository has just left. The row
  that reports what a pull will do names the same command, so the report and the install cannot
  disagree.

  `describePlan` (exported from `next-watch/core`) takes the manager as an optional second
  argument. Omitted it still says `npm install`, which is what every existing caller meant.

  Not included, and worth knowing: there is no config-file override, and `packageManager` in
  `package.json` (corepack) is not consulted. A checkout whose lockfile is not committed gets
  npm, exactly as before.

- README: **"What leaves the machine" said nothing leaves until a provider is switched on**,
  which a run with no config file makes untrue — every section but `quotaSession` is on there.
  The sentence now says so and points at the table of what that traffic is.

- `Args` has three new fields (`start`, `build`, `quotaSession`). A host that builds an `Args`
  by hand rather than through `parseArgs` has to add them; nothing else changed for embedders.

## 0.1.6

- **`--version` reported the wrong number when next-watch was installed as a dependency**, which
  is the ordinary way it is run. It printed the version of **the project it was installed into**.
  Measured against 0.1.5: a scratch project at `1.0.0` with next-watch 0.1.5 installed answered
  `1.0.0` to `next-watch --version`.

  Nothing was ever asked of yargs, so it guessed, and its ESM shim guesses with

  ```js
  __dirname.substring(0, __dirname.lastIndexOf('node_modules'));
  ```

  — the directory above the `node_modules` yargs itself sits in, which is the consuming
  application's root, not this package's. Inside a checkout of next-watch the same expression
  lands on next-watch, which is why the number looked right in development and in the two
  releases before this one.

  `main` now passes the version it reads from this package's own `package.json` — the same
  single source the panel heading uses, so the heading and `--version` can no longer disagree.
  0.1.5 shipped a panel saying `next-watch 0.1.5` while `--version` said something else
  entirely.

  `parseArgs` takes it as an option (`version`), left undefined by default: a host embedding
  these flags in a CLI of its own **does** own the `node_modules` tree, so yargs' guess is the
  right answer for that host's `--version`, and nothing changes for them.

## 0.1.5

- **`afterPull`: commands to run once a pull has landed.** The servers restart because files
  they serve changed; this is for the rest of what a checkout owns and no server adapter covers
  — a crontab to rewrite, a cache to warm.

  ```js
  afterPull: [
    {
      label: 'cron:restore',
      command: 'npm',
      args: ['run', 'cron:restore'],
      runOn: runIfAny(['cron/schedule.json']),
    },
  ];
  ```

  `runOn` decides whether the incoming paths call for it, exactly as a server's `restartOn`
  does; omitted, the hook runs after every pull that brought something in. `runIfAny` is
  `restartIfAny` under the name that reads right on a hook that restarts nothing.

  The hooks run **after** the restarts, in the order given, each with its own row in the event
  log. `--dry-run` names them instead of running them, and `--no-restart` skips them along with
  the restarts.

  ⚠️ **A hook that fails stops nothing** — not the hooks after it, and not the watch. This is
  deliberately unlike a failed `npm install`, which does stop the restarts: there, carrying on
  would restart servers onto a tree whose dependencies never landed. Here the merge has already
  happened and cannot be taken back, so a failure is a red row and the run continues. For the
  same reason the hooks run even when a restart failed: whether a crontab is current has
  nothing to do with whether a server came back up, and the day the build breaks is the day a
  stale schedule hurts most.

- `applyPlan` and the hooks moved out of `cli/tick.ts` into `cli/apply.ts` — deciding whether
  to pull and doing what a pull implies are two jobs, and the file had grown past the line
  limit. `RunCommand` is still exported from both.

## 0.1.4

- **The heading says which next-watch is drawing it.** The frame's title is now
  `next-watch 0.1.4  12:34:56  up 1:02`, and the startup banner carries the version in the same
  place. A watch runs for weeks, and until now the only record of which version started it was
  in whatever shell scrolled past days ago.

  The number is read from this package's own `package.json`, in one place, and never
  hardcoded. `--version` is deliberately left as it was: yargs resolves that from the entry
  point, so a host that embeds `parseArgs` in a CLI of its own keeps reporting **its** version
  there, which is the right answer for that command.

  For a host that builds a `WatchPanel` itself, both the field (`selfVersion`) and the banner's
  `version` option are optional, and the heading without one is exactly what it was before.

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
