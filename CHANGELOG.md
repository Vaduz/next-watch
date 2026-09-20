# Changelog

## 0.7.1

- **Fixed: an automatic update that landed short of the release it was aiming at was recorded as
  done, and never tried again.** On 2026-09-18 upstream published `rust-v0.155.1` and the watcher
  ran `codex update` two minutes later. The installer answered `Resolved version: 0.155.0` —
  the distribution had not caught up with the GitHub release — installed that, and exited 0. What
  the watcher wrote down was **the version it was aiming at**, so 0.155.1 counted as attempted,
  and `toolsToAutoUpdate` never picked `codex` again while `latest` stayed 0.155.1. It sat on
  0.155.0 for over ten hours, through three quota sessions, until somebody updated it by hand.

  The memo now holds **the installed version the attempt started from** as well as the target, and
  an attempt is only treated as already made when both still describe where the CLI stands. An
  installer that moved the version but fell short no longer matches, so the next pass tries once
  more; 0.154.0 → 0.155.0 would have resolved on the following tick.

  **The protection this memo exists for is untouched**, and is the reason the rule is written this
  way rather than as a timeout. An update can run, exit 0 and leave the version exactly where it
  was — an installer that failed quietly, a distribution that never catches up — and the row stays
  behind for ever. Both halves of the memo still match in that case, so it is not retried, which
  is what keeps the watcher from running an install every tick and burning through the release
  API's hourly limit. Each move of the installed version buys exactly one more attempt, because
  the attempt records where it landed.

- **Fixed: versions are compared as versions, not as text.** `isBehind` asked whether the two
  strings differed, which was wrong in three ways. It read `0.9.0` as newer than `0.10.0`. It did
  not know that `1.0.0-alpha.3` comes before `1.0.0`. And — the one that did damage — it called a
  machine "behind" when the installed version was **newer** than the newest release, which is what
  a prerelease put on by hand looks like: `0.155.1 is out (installed 0.156.0-alpha.7)` on the row
  and in the log at every release, and an automatic install sent after a version the machine was
  already past.

  Ranking is now semver's own: numeric places compared as numbers, a prerelease before the release
  it leads to, prerelease identifiers compared one at a time with numbers ranking below text, and
  build metadata ignored. **No dependency was added** — the rules are shorter than the smallest
  package that implements them, and they are in `core/` as a pure function with its own table of
  cases, semver's published example chain among them.

  Two predicates now, because showing and installing are not the same question. The screen still
  points at `latest` when the two differ in a way **nothing can rank** — hiding a difference the
  watcher can plainly see would be worse than showing one it cannot explain — while an automatic
  update requires a version comparison that actually came out `behind`. Between them this removes
  the case the memo's warning used to name: a prerelease installed against an older release now
  ranks as ahead and is never picked at all.

- **`npm publish` empties `dist/` and builds it again first — and this release is 0.7.0 published
  again, because 0.7.0 went out without one.** There was no `prepublishOnly`, so publishing shipped
  whatever happened to be sitting in `dist/` at that moment. In 0.7.0's case that was nothing:
  **the tarball holds five files** — `package.json`, the README, the licence, the notice and
  `bin/next-watch.js` — against 421 in 0.5.0 and 425 in 0.6.0. Installing it and running the
  binary ends at `ERR_MODULE_NOT_FOUND` on `dist/cli/main.js`, which is the first line
  `bin/next-watch.js` imports. **0.7.0 could not start, and 0.7.1 is the version that carries what
  it was meant to.**

  The build alone would not have been enough. `tsc` writes outputs but never removes them, so a
  source file that is renamed or deleted leaves its `.js`, `.d.ts` and both maps behind in `dist/`
  for ever, and `files` ships the whole directory — a module that no longer exists in the source
  would keep being published, and `exports` would keep resolving to it. The `rm -rf` is what makes
  the tarball a function of the tree being published rather than of everything that tree has ever
  been.

  It is `prepublishOnly` rather than `prepare`: `prepare` also runs on every `npm install`, and
  the build is not something an installing consumer should be made to do.

## 0.7.0

- **The npm page links back to the repository, and the package can be found by searching for what
  it does.** `repository`, `homepage` and `bugs` were never set, so npm rendered the README with no
  way out of it: a reader who wanted to star the project, file an issue or read the source had
  nowhere to click, and the services that pair a package with its repository had nothing to pair.

  `keywords` was empty and `description` carried the tagline, which between them left the package
  unreachable by search. Three queries were put to the live registry before the change — a Claude
  Code dashboard, a TUI dev server, an agent dev server watcher — and each returned eight other
  people's packages and not this one. The exact name was the only query that found it. The
  description now says what the thing does in the nouns somebody would type, and the tagline keeps
  the place it was already doing its work in, at the top of the README. This **reverses what 0.6.0
  chose**, which put the tagline in `description` so that it would be the first line on the npm
  page: that line is read by whoever already arrived, and the description is also what the search
  matches against, which is how anybody arrives at all.

- **A live `claude` the CLI kept no session record for is listed too.** A session started by
  another Claude Code session inherits `CLAUDE_CODE_CHILD_SESSION`, and the CLI then writes no
  `~/.claude/sessions/<pid>.json` — so a real session, answering prompts and spending the same
  quota as any other, was absent from a section that promises every live session on the machine.
  On a machine where agents start agents that is exactly the wrong thing to under-report.

  The row is built from `ps` alone, and says so. The model, the context, the idle time and the
  version are left **empty rather than dashed**: a dash reads as "there is none", where the truth
  is that the record holding them was never written. The status reads `no record`, and the note
  under the row gives how long the process has been running — `IDLE` means "since the state last
  changed", and this row has no state to have changed, so it does not go there and no column was
  added for it.

  It is never offered `(r)estart`, **in a tmux pane or out of one**, because there is no session
  id to resume — and for that reason the note replaces the `not in tmux` one rather than joining
  it, which would have named the wrong reason. `(s)top` works as it does anywhere.

  What the watcher runs itself is not counted: `claude -p "hi"` opens a quota window and
  `claude update` installs a release, and neither is somebody's session. The cwd comes from
  `/proc`, so these rows are **Linux only**, the same limit the Codex half already has.

## 0.6.0

- docs: the dashboard block in the README is retaken at 100 columns against the current release,
  and its event log shows the four things the watch does on its own or on a keypress: a pull with
  the restart it caused, a blocked path refusing one, a server restart with its build, an agent
  session restarted back into its tmux pane, a CLI update, and the message that opens a closed
  quota window. The README no longer claims the block is a single screen — it is real output,
  combined.

- **A session that is not running inside a tmux pane says so on its row.** `(r)estart` is the one
  verb that needs tmux — it is SIGTERM followed by typing the resume command back into the
  session's own pane — and a row that quietly lacked the verb read as a fault in the watcher
  rather than as a fact about the session. The row now carries
  `not in tmux · (r)estart needs tmux` on a line of its own, decided by **the same pane lookup the
  verb uses**, so the two cannot say different things. It hangs under the row rather than going in
  `STATUS`, because that column is padded to its widest cell and one session's note would widen it
  on every row.

- docs: the README says how to lay a team of agent sessions out with tmuxp, and what only works
  through tmux (the session restart verb, and nothing else).

- docs: four ways the README rendered badly on GitHub are fixed — the product name is the page
  heading and the tagline a bold line under it (they were the other way round), the 2×2 feature
  table that drew a blank header stripe is gone, the mermaid diagram (whose last node GitHub's
  zoom controls covered, and which npm does not render at all) is a one-line ASCII flow, and the
  traffic table's `How often` column is short enough that every row is one line. Everything
  between the capture and that table is now one **What it does** section: every capability as a
  single line, grouped, with the rules behind them moved into the Reference blocks rather than
  deleted.

- docs: the README is rewritten as a landing page — a centred hero with the tagline, badges, the
  capture, four blocks on what it does for a machine agents ship to, and the trust material and
  `What leaves the machine` table moved up above the configuration reference. Nothing that was
  true is gone: the long reference parts (the full option list, the commented config file, the
  access-log line, the key list, the subpaths) are folded into `<details>` instead. The
  `package.json` description is the tagline, which is the first line on the npm page.

## 0.5.0

- **Fixed: `codex exec "hi"` never opened a window, and failed every ten minutes for ever.** It
  exited 1 in a tenth of a second, saying it was not inside a trusted directory and that
  `--skip-git-repo-check` was not specified. The sandbox is an empty directory under the temp
  directory — deliberately not a repository, so that no project's instructions are read into the
  context of a message whose only purpose is to exist — and Codex 0.154.0 refuses to run outside
  one. The flag is now passed. (Its `Reading additional input from stdin...` is not a second
  problem: every child is given `'ignore'` for stdin and reaches end of file at once.)

- **Fixed: Claude was sent `hi` several times for the same window.** Four went into one window
  overnight — 01:26, 01:36, 01:55, 02:05. A window was read as closed when its reset time was in
  the future and nothing was used, and one `hi` rounds to 0%, so ten minutes after each send the
  same window read as closed again.

  What a window that is **not running** looks like was measured against both backends rather than
  assumed, and they differ:

  - **Claude** gives a fixed boundary: a spent window shows a reset time that has passed.
  - **Codex** gives no boundary at all until something is running. With nothing open it answers
    `0%` used and a reset **exactly five hours from the moment it was asked**, which moves with
    the clock — two readings 85 seconds apart came back 85 seconds apart, and one message froze
    it.

  So the rule is neither the old one nor "a future reset means open", which would have left Codex
  looking open for ever and never sent to it again. A window is closed when there is no reset
  time, when it has passed, or when it is a whole window ahead of the moment the figures were
  **read** (Codex's not-yet-running shape); otherwise it is open, and the usage percentage
  decides nothing. On top of that, a send that works is remembered against the clock for the five
  hours it bought, so the figures lagging behind cannot cause a second one.

- **A failed quota session is retried three times and then left alone, and the screen says so.**
  Retrying is now what failure means rather than what every ten minutes means: a send that worked
  is never repeated. Three failures ten minutes apart is half an hour of trying, after which one
  line says `quota: codex failed 3 times, nothing more until a window opens` and nothing is tried
  until a window is open again, whoever opened it. The line under the service row carries it —
  `session: auto · failed 17:08 (exit 1) · retry 17:18`, or `· no more this window` — and
  `sending` is shown only while an attempt is actually in flight, instead of for ever.

- **`tools: { autoUpdate: false }` turns the automatic install off in one line.** Claude Code and
  Codex have kept themselves up to date since the section existed — a watcher that reports a new
  release for days without installing it is only a reminder — but saying "report and install
  nothing" meant writing the default list out entry by entry with the flag on each, which is a
  copy of a list that then stops following this package's. The object form says the one thing and
  keeps the list; `tools: true` and the array form are unchanged, and an object with a key nobody
  knows (`autoupdate`) is refused **by name**, with the config file's path, rather than obeyed as
  its opposite.

- docs: the README said the CLIs update themselves only in the comments of the config example, so
  a reader learned about it by accident or not at all. It is now one of the sections listed under
  "What you see, and what you can do", with the three lines it writes to the event log, and "What
  leaves the machine" has the install itself: the watch opens no connection for it, and each CLI
  fetches its own release from wherever it was installed from.

## 0.4.1

- **Stopping a server no longer stops the jobs it started.** A restart sent SIGTERM to the whole
  process tree under the server, and a job the server had spawned for the user with
  `detached: true` — six minutes into a language-model call — was in that tree. It was a
  descendant by parentage and nothing else.

  The tree is still collected, and then narrowed to the server's **own session**: `detached: true`
  calls `setsid`, which gives the child a session id of its own that its own children inherit,
  while an ordinary child shares the server's however deep it sits. So the session is what tells
  a compiler the server forked from a job the server was asked to run, and parentage is not.
  Anything left running is named in the event log — `leaving pid 960342 (own session: …)`.

  Where `ps` prints no session id the process group is used instead, and where it prints neither
  the whole tree is stopped as before, with a warning: a descendant left behind by mistake goes
  on holding the port, which is the worse of the two failures. For the same reason a descendant
  whose own session cannot be read is stopped — not knowing is not proof that it is somebody
  else's. The `(k)ill` task verb is unchanged: stopping a task means stopping what that task
  started.

## 0.4.0

- **A Codex session's row shows its model.** It has always shown `-`, and the reason was one
  line: both readers of a rollout skipped every record that was not an `event_msg`, and the model
  is on a top-level `turn_context` record, written at the start of each turn. Both shapes are now
  read — `turn_context.model` as codex 0.154.0 writes it, and the older
  `thread_settings_applied` — and the tail wins over the head, so a model changed with `/model`
  part-way through a session is what the row shows.

  A session that has not taken a turn yet has no such record, so two fallbacks follow it: the
  `-m` / `--model` on the process's own command line, and then the configuration
  (`$CODEX_HOME/<profile>.config.toml` when `-p` named a profile, otherwise `config.toml`). Only
  the keys **before the first table header** are read from it — a `model` under `[tui]` or
  `[projects."…"]` is somebody else's — which also means no TOML dependency for one line. Nothing
  readable still leaves the column as `-`.

- **The quota session covers Codex too, and each CLI can be set separately.** Codex has a
  five-hour window of its own, and `codex exec "hi"` opens it the way `claude -p "hi"` opens
  Claude's. `providers.quotaSession` now takes a key per CLI beside the setting for both:

  ```
  quotaSession: true                                   // both, whenever closed
  quotaSession: { at: ['06:00', '11:00'] }             // both, on that schedule
  quotaSession: { claude: { at: ['09:00'] }, codex: false }   // one each
  ```

  A key names only that CLI: what it does not name keeps whatever the outer setting says. Each
  CLI is decided on **its own** window, so one can be sent to while the other's window is open.
  A CLI that is not installed is skipped with one line in the log rather than a failed spawn a
  second.

- **Each service row says which mode is on for its CLI.** Under the Claude row and the OpenAI row:
  `session: auto · next refresh when the window closes (13:12)`,
  `session: manual · next refresh 14:00`, `session: off`, or `session: off (not installed)`. The
  setting spends something, so it is worth being able to read it off the screen rather than out of
  the config file.

- **The quota session can run on a schedule instead of whenever the window is closed.**
  `providers.quotaSession` now takes `{ at: ['06:00', '11:00', '16:00', '21:00'] }`, read in the
  watch's own clock (`timezoneOffsetMinutes`), and `--quota-session-at HH:MM,HH:MM` does the same
  for a run with no config file. **`at` turns the automatic mode off**: between the listed times a
  closed window stays closed, which is the point — a window opened at 04:00 is spent by the time
  the day starts.

  - Nothing is made up for a time that passed while the watch was not running, each listed time
    fires **at most once a day**, and a time that comes round while a window is already open sends
    nothing and logs one line saying until when it is open.
  - The decision is a pure function of the times, the offset, what has already fired and whether
    the window is open (`core/quota/schedule.ts`); the clock and the spawn stay in the layers that
    are allowed to have them.
  - It is now looked at on the **one-second sample** rather than on the git interval. `--interval`
    is how often the remote is checked, and a schedule whose resolution depended on it would have
    fired an hour late for anyone who checks git hourly. It costs nothing: the quota is read
    through the same one-minute cache the panel reads.

- **Fixed: `--dry-run` sent the quota-opening message.** A dry run is the promise that the run
  changes nothing, and this is the one thing in the watcher that spends something. It now says
  what it would have done and sends nothing.

- **The `(h)elp` text is written to 80 columns.** Its widest line was 91, so on an 80-column
  terminal the help wrapped inside the frame and cost rows, and `--help` wrapped it again after
  indenting it. The wording is unchanged where it fitted and split across two lines where it did
  not; a table asserts every line against `HELP_WIDTH`, so the next rewording cannot quietly grow
  past it. The README's copy of that block is the new output, as the rule requires.

- docs: the config example in the README was rewrapped so no line passes **80 columns**, which is
  where GitHub starts scrolling a code block sideways. The content is the same; the comments are
  broken across lines instead of running past the edge.

- docs: the dashboard capture in the README was retaken at **80 columns**, and shows the sections
  it was missing — the live Claude and Codex sessions, the service-status rows, and the line under
  each of those saying how this machine opens that CLI's window. The old one was 108 columns wide,
  which GitHub renders with a horizontal scrollbar, and it had `providers` empty, so the sections
  people come for were not in the picture at all.

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
