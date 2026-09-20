<h1 align="center">next-watch</h1>

<p align="center"><strong>Mission control for the machine your agents ship to.</strong></p>

<p align="center">
Watches the branch, pulls, restarts only what changed, and keeps Claude and Codex sessions alive
with their five-hour windows open — on one screen that never needs a person at the keyboard.
</p>

<p align="center">
<a href="https://www.npmjs.com/package/next-watch"><img alt="npm" src="https://img.shields.io/npm/v/next-watch"></a>
<a href="./LICENSE"><img alt="license" src="https://img.shields.io/npm/l/next-watch"></a>
<img alt="node" src="https://img.shields.io/node/v/next-watch">
<img alt="dependencies" src="https://img.shields.io/badge/dependencies-1%20(yargs)-blue">
</p>

```sh
bun add -d next-watch
bunx next-watch --start dev
```

With npm instead: `npm install --save-dev next-watch`, then `npx next-watch --start dev`.

## The screen

One screen, redrawn in place. Two servers, the live agent sessions, the service status with the
quota window each CLI is keeping open, and an event log of everything the watch has done:

```
╭─ next-watch 0.7.1  19:38:52  up 3m ────────────────────────────────────────────────────────────╮
│ REPO     /tmp/nw-shot/site  main 0dad03c  1 commit(s) behind origin/main                       │
│          last pull 19:36:05 (2m ago, 2 commit(s)) · next git check 14s                         │
│ SSH      ssh-agent: 1 key(s) loaded                                                            │
│                                                                                                │
│    SERVER  STATE  URL                    OWNER        MODE  UPTIME                             │
│    web     up     http://localhost:3400  pid 1641775  bun       2m                             │
│    admin   up     http://localhost:3401  pid 1641894  bun       2m                             │
│                                                                                                │
│ Claude  Max 20x                                                                                │
│   5h        14%  ██▊·················  resets 20:50 (in 1h11m)                                 │
│   7d         5%  █···················  resets 07:00 (in 6d11h)                                 │
│   Fable 7d   5%  █···················  resets 07:00 (in 6d11h)  3m ago                         │
│ Codex   Plus                                                                                   │
│   5h         0%  ····················  resets 21:32 (in 1h53m)                                 │
│   7d         1%  ▎···················  resets 00:35 (in 6d4h)   47s ago                        │
│                                                                                                │
│ SESSION  TREE              AGENT   STATUS  MODEL      CONTEXT  IDLE    VER                     │
│   site-09                                                                                      │
│          site              claude  idle    -                -     30s  2.1.278                 │
│            not in tmux · (r)estart needs tmux                                                  │
│ › site-fc                                                                                      │
│          site              claude  idle    opus-5         41k      1m  2.1.278                 │
│                                                                                                │
│    SERVICE  Claude  ●  All Systems Operational                                                 │
│             session: auto · next refresh when the window closes (20:50)                        │
│             OpenAI  ●  All Systems Operational                                                 │
│             session: auto · next refresh when the window closes (21:32)                        │
│                                                                                                │
│ TOOL     claude 2.1.278 · codex 0.155.1                                                        │
├─ event log ────────────────────────────────────────────────────────────────────────────────────┤
│ 19:34:10 ✧ claude 2.1.278 is out (installed 2.1.277), updating ...                             │
│ 19:34:10 » update tool:claude ...                                                              │
│ 19:34:10 ·   Updating to 2.1.278...                                                            │
│ 19:34:14 ✧ claude 2.1.277 -> 2.1.278                                                           │
│ 19:34:14 » update tool:claude done 4.2s                                                        │
│ 19:35:25 ✎ Codex quota session is closed (5h window reset 0min ago, 0% used), opening it with  │
│            codex exec --skip-git-repo-check "hi" ...                                           │
│ 19:35:29 ○ codex exec --skip-git-repo-check "hi" done 4.2s                                     │
│ 19:36:05 ⇣ pulled 2 commit(s)  0b35484 -> 0dad03c                                              │
│ 19:36:05 ·   0dad03c  fix(web): the page greeting   Dev  21s ago                               │
│ 19:36:05 ·   c1f3bf0  feat(web): a badge component  Dev  21s ago                               │
│ 19:36:05 ·   2 file(s)  +2 -1  web/ 2                                                          │
│ 19:36:05 ·   -> restart web / restart admin                                                    │
│ 19:36:05 ○ web: stopping pid 1638027, 1638028                                                  │
│ 19:36:05 ○ web stopped                                                                         │
│ 19:36:05 ○ web: bun run dev                                                                    │
│ 19:36:05 ○ web is listening on http://localhost:3400                                           │
│ 19:36:05 ○ admin: bun run build:admin ...                                                      │
│ 19:36:05 ·   $ node -e "console.log('compiled 14 routes')"                                     │
│ 19:36:05 ·   compiled 14 routes                                                                │
│ 19:36:05 ○ admin: build:admin done                                                             │
│ 19:36:05 ○ admin: stopping pid 1638040, 1638041                                                │
│ 19:36:05 ○ admin stopped                                                                       │
│ 19:36:05 ○ admin: bun run admin                                                                │
│ 19:36:05 ○ admin is listening on http://localhost:3401                                         │
│ 19:37:05 ▲ 1 commit(s) waiting on origin/main, not pulling                                     │
│ 19:37:05 ·   db/data.txt - this machine owns the database                                      │
│ 19:37:05 ·   look at them and pull by hand.                                                    │
│ 19:37:31 » restart session:1634337 ...                                                         │
│ 19:37:31 ○ SIGTERM to session 1634337 in pane %42                                              │
│ 19:37:31 ✱ session renamed: site-b5 -> (no record) pid 1634337 [site]                          │
│ 19:37:33 ○ typed "claude --resume 0422fe2c-4054-4e8d-aa87-b4272a8fa86c" into pane %42          │
│ 19:37:33 » restart session:1634337 done 1.4s                                                   │
│ 19:37:33 ◆ session started: (no record) pid 1648061 [site]                                     │
│ 19:37:33 ◆ session ended: (no record) pid 1634337 [site]                                       │
│ 19:37:34 ✱ session renamed: (no record) pid 1648061 -> site-fc [site]                          │
├─ web access  /tmp/nw-shot/site/log/web.txt ────────────────────────────────────────────────────┤
│           $ node server.mjs web 3400                                                           │
│ 19:33:08  ready in 412ms                                                                       │
│ 19:33:26  GET                         200  13ms  /                                             │
│ 19:33:26  GET                         404  11ms  /missing                                      │
│ 19:33:26  GET                         200  10ms  /                                             │
│ 19:33:26  GET                         404  10ms  /missing                                      │
│ 19:33:26  GET                         200  12ms  /                                             │
│ 19:33:26  GET                         404  11ms  /missing                                      │
│ 19:37:48  GET                         200  10ms  /                                             │
│ 19:37:48  GET                         404  10ms  /missing                                      │
│ 19:37:48  GET                         200  10ms  /                                             │
│ 19:37:48  GET                         404  13ms  /missing                                      │
│ 19:37:48  GET                         200  11ms  /                                             │
│ 19:37:48  GET                         404  12ms  /missing                                      │
├─ admin access  /tmp/nw-shot/site/log/admin.txt ────────────────────────────────────────────────┤
│           $ node server.mjs admin 3401                                                         │
│ 19:33:08  ready in 412ms                                                                       │
│ 19:33:26  GET                           200  12ms  /                                           │
│ 19:33:26  GET                           200  10ms  /                                           │
│ 19:33:26  GET                           200  13ms  /                                           │
│ 19:37:48  GET                           200  13ms  /                                           │
│ 19:37:48  GET                           200  12ms  /                                           │
│ 19:37:48  GET                           200  12ms  /                                           │
╰────────────────────────────────────────────────────────────────────────────────────────────────╯

  ⠙ session:1648061  (r)estart | (s)top
```

## What it does

Built for the case where **the machine that runs the code is not the machine the code is written
on** — a spare box, a second laptop, a machine on the desk that serves a site while the work
happens elsewhere. Nobody is at that keyboard, so it has to be able to explain itself afterwards.
Every capability below is one line; the rules behind them are in [Reference](#reference).

**Watch and ship**

- Polls a remote branch on an interval and pulls what is there.
- Runs `<pm> install` when the lockfile moved — the package manager read from the lockfile itself.
- Restarts only the servers whose paths the incoming files actually touched.
- Runs `afterPull` commands once the servers are back, and refuses a pull that would overwrite a
  `pull.blocked` path.
- `--once --dry-run` prints what would be pulled and what would restart, and spawns nothing.

**Servers**

- `--start <script>` makes an npm script a server; repeatable, and needs no config file.
- `--build <script>` runs before anything is stopped, and a failed build leaves the old server up.
- `preStart` prepares something first — an npm script, or a function.
- `restartPaths` / `ignorePaths` narrow what a restart is for.
- `detached: true` servers outlive the watch, and the next watch adopts the running process.
- Servers that start and stop their own way are written out as an adapter instead.
- One log pane per server, newest at the bottom, request lines coloured by status.

**Agents**

- Lists the live Claude and Codex sessions on this machine: tree, model, context, idle, version.
- Restarts one — SIGTERM, then its resume command typed back into the same tmux pane — and kills
  or stops anything in a `tasks` list the config file supplies.
- **Restart is the one verb that needs tmux.** A session started outside a pane is listed and can
  be stopped, and its row says `not in tmux · (r)estart needs tmux`.
- A live `claude` the CLI wrote no session record for is listed too, with its unknown columns left
  empty and a note saying so. **Linux only** — the cwd comes from `/proc`.

**Quota windows**

- Shows how much of each five-hour window is spent, and when it resets.
- Opens a closed one (`claude -p "hi"`, `codex exec "hi"`) in an empty sandbox directory —
  automatically, or only at times you list, decided per CLI.
- One message per window, and another attempt only after one fails.
- The line under each service row says which mode is on and what it is waiting for.

**Tools and services**

- Shows the installed CLI versions against the newest published release.
- Installs a new Claude Code or Codex itself, one at a time, once per release —
  `tools: { autoUpdate: false }` keeps the rows and the `(u)pdate` verb and installs nothing.
- Shows the public status page of each service, openable in a browser from the screen.
- Shows whether ssh-agent holds a key, with an `(a)dd` verb while it does not.

**Never destructive on its own**

- Blocked paths stop a pull rather than letting git overwrite a file a process holds open.
- A build runs before anything stops; a failed one changes nothing.
- Quit is refused once while something is running, so one Ctrl-C strands nothing.
- Stopping a server leaves the jobs it started in sessions of their own still running.
- `git fetch` cannot raise an authentication prompt on a machine with nobody at the keyboard.
- Nothing leaves the machine until a provider is switched on — the table below is all of it.

**The screen**

- One panel, redrawn in place, with the event log kept across restarts of the watch itself.
- Rows that overflow are wrapped, not cut.
- Off a terminal it is printed only on a change, so a piped watch does not fill a file.
- Tab moves a cursor, one letter runs that verb, `(f)ocus` fills the frame, `(h)elp` prints the keys.
- The Codex session rows need `/proc` and the restart verb needs tmux; without either they are absent.

## What leaves the machine

Nothing at all until a provider is switched on — **except on a run with no config file**, where
every section but `quotaSession` is on and this is the traffic that follows. With all of them on,
and never more often than this:

| Where                                                            | What for                          | How often                             | Off with                               |
| ---------------------------------------------------------------- | --------------------------------- | ------------------------------------- | -------------------------------------- |
| `api.anthropic.com/api/oauth/usage`                              | the usage windows                 | ≤ 1/min                               | `quota: false`                         |
| `codex app-server` (a local process, not the network)            | the same, for the other CLI       | ≤ 1/min                               | `quota: false`                         |
| `status.claude.com`, `status.openai.com`                         | the public status summaries       | ≤ 1/min                               | `services: false`                      |
| `api.github.com/repos/<repo>/releases/latest`                    | the newest published version      | ≤ 1/10 min                            | `tools: false`                         |
| `claude update`, `codex update` (local processes)                | installing a release that is out  | once per release                      | `tools: { autoUpdate: false }`         |
| `claude -p "hi"` (a local process, on the CLI's own credentials) | opening a closed five-hour window | once per closed window or listed time | `quotaSession: false`, `claude: false` |
| `codex exec --skip-git-repo-check "hi"` (the same, for Codex)    | the same                          | the same                              | `quotaSession: false`, `codex: false`  |

The usage windows are asked for **less often than that in practice**: not at all while a cache
written by something else on this machine is still fresh.

The install is the one row where **the watch itself opens no connection**: it runs that CLI's own
update command and reads its output. Where a CLI fetches its release from is that CLI's own
business, and this package chooses nothing about it.

Every one of them has a timeout, none of them can throw, and a failure costs its own section and
nothing else. The credentials the quota reads are the ones the CLI already wrote on this machine;
the token goes to the endpoint that issued it and reaches no log, no event and no file.

## How it works

```
origin/main ─▶ pull ─▶ install if the lockfile moved ─▶ restart ─▶ event log
```

Only the servers whose paths the incoming files touched are restarted, and a build that fails
leaves the old one serving.

## Zero config

**Node 22 or later is all that is needed to run it** — the package is plain ESM with one
dependency (`yargs`), and bun is the toolchain, not a requirement. In a Next.js project set up the
usual way, `bunx next-watch --start dev` is the whole setup: no config file, no adapter to write.

The first thing worth running is the one that changes nothing:

```sh
bunx next-watch --once --dry-run --start dev
```

It prints what a pull would bring and what would restart, and spawns nothing at all.

`--start <script>` makes an npm script a server of this watch. It is started when the watch starts,
stopped when the watch stops, restarted when a pull brings in something it serves, and its output
goes to that server's log pane. The flag is repeatable — `--start web --start admin`.

For a server that has to be built first, `--build <script>` runs that script **before** anything is
stopped, and a build that fails leaves the running server alone and says so. That makes the
production shape:

```sh
bunx next-watch --start start --build build
```

With no config file, the rest is derived: `appName` is the `name` in `package.json` (or the
directory's name), `root` is the working directory, `branch` is `main`, the remote is
`origin/main`, and a dependency change is `package.json` or whichever lockfile is there.

<details>
<summary>Which package manager it uses, and why that one</summary>

The package manager is the one the project already installs with, read from the lockfile:
`bun.lock` (or `bun.lockb`) → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn,
`package-lock.json` → npm, and npm where there is none. A checkout holding more than one lockfile
is read in that order, so a repository that moved to bun and left `package-lock.json` behind is a
bun repository. The install that follows a pull uses the same reading — `<pm> install`, with the
lockfile read at that moment, because the pull that swaps one lockfile for another is exactly the
pull that moves the dependencies. `packageManager` in `package.json` (corepack) is not consulted.

</details>

## Config

You do not need a config file to start. You need one when:

- some incoming paths must **never** be pulled, because this machine is the one that writes them;
- a server needs a **finer restart rule** than "anything that is not a test file or a root-level
  document";
- there is more than one server, or one that has to prepare something before it starts, or one
  that should go on running after the watch is closed;
- there is a command to run after a pull that no server covers;
- you want to choose which of the sections above are drawn.

It is `next-watch.config.mjs` in the working directory unless `--config` says otherwise, and it is
a module rather than JSON because the interesting parts can be code — a predicate over paths, a
function that prepares something — though most servers need none of that.

**A server is either described or written out.** Describing one is naming its npm script and the
handful of decisions around it; `{ id: 'dev', script: 'dev' }` is exactly what `--start dev`
builds, and a described server **is started when the watch starts**, because next-watch spawns that
child itself. Writing one out is supplying the four functions yourself, for a repository whose
starting and stopping are its own business — those are left alone at startup, since whether such a
server is already running is not something to decide on its behalf. The two forms may be mixed in
one `servers` array.

<details>
<summary>The config file, every option commented</summary>

```js
import { restartUnless } from 'next-watch/core';

// Your own functions, for the server that is written out below. next-watch
// never looks inside them — it only decides when to call which. Replace these.
const startAdmin = async emit => true;
const stopAdmin = async emit => true;
const buildAdmin = async () => true;
const isListening = async port => true;

export default {
  // Names the cache and sandbox directories, and identifies this watcher to
  // anything it talks to.
  appName: 'my-site',

  // root: import.meta.dirname,   // a checkout other than the working directory
  // branch: 'main',              // the only branch it will merge into
  // remote: 'origin/main',       // watch a different remote branch
  // logDir: 'log',               // where the event log and pane positions live
  // timezoneOffsetMinutes: 540,  // pin the clocks; default: this machine's

  pull: {
    // ⚠️ What this checkout is the one that writes. Receiving such a file means
    // something else wrote it, and letting git overwrite a file a running
    // process holds open is not a conflict, it is destruction. Anything listed
    // here stops the pull and asks for a person.
    blocked: [
      // { prefix: 'db/', reason: 'this machine owns the database' },
      // { prefix: 'log/', reason: 'written by the servers running here' },
    ],
    // Receiving one of these means the dependencies moved, so `<pm> install`
    // runs before anything is restarted. Without it, a pull that changes
    // package.json restarts servers onto old dependencies.
    // dependencyPaths: ['package.json', 'bun.lock'],
  },

  servers: [
    // Described: an npm script, and the decisions around running one.
    {
      id: 'web',
      script: 'dev', // `<pm> run dev` — exactly what `--start dev` builds
      // build: 'build',           // runs first; if it fails, nothing stops
      // preStart: 'prepare:web',  // a script, or async emit => {}, first
      // detached: true,           // outlives the watch; the next one adopts it
      // restartPaths: ['web/', 'lib/'],  // restart only for these prefixes
      // ignorePaths: ['docs/'],   // or the opposite: anything except these
      // label: 'the site',        // the row's name; the id by default
    },

    // Written out: for a server whose starting and stopping are its own
    // business. Mixing the two forms in one array is ordinary — describe what
    // can be described, write out the rest.
    {
      id: 'admin',
      // `restartUnless(prefixes)` restarts for anything **except** those
      // prefixes (and test files, and root-level documents). `restartIfAny`
      // is the opposite shape, for a dev server that reloads itself and needs
      // a restart only for its own configuration.
      restartOn: restartUnless(['docs/', 'web/']),
      probe: async () => ({
        server: 'admin',
        state: (await isListening(3001)) ? 'up' : 'down',
        url: 'http://localhost:3001',
        mode: 'dev',
        owner: 'me',
        uptimeSeconds: null,
        // The files this server's stdout collects in. The access pane reads
        // their tail.
        logFiles: ['log/admin.txt'],
      }),
      // ⚠️ Build before stopping anything. Stopping first and then finding the
      // build broken leaves nothing running, which is worse than the old code
      // still serving. Only the adapter knows what building means, so only the
      // adapter can get this right — a described server gets the same order
      // for free.
      restart: async emit => {
        emit('step', 'building ...');
        if (!(await buildAdmin())) {
          emit('error', 'build failed, leaving the old server up');
          return false;
        }
        await stopAdmin(emit);
        return startAdmin(emit);
      },
      stop: emit => stopAdmin(emit),
      start: emit => startAdmin(emit),
    },
  ],

  // Work started outside the watcher, shown as its own section with a kill
  // verb on each row.
  // tasks: () => readMyTaskRegistry(),

  // Commands to run after a pull that brought something in, once the servers
  // are back. For what a checkout owns that no server adapter covers — a
  // crontab to rewrite, a cache to warm.
  // afterPull: [{ label: 'rewrite crontab', command: './scripts/cron.sh' }],

  // Which of the machine-level sections are drawn. Omitted means none of them,
  // so a config file that says nothing here gets a screen about the repository
  // alone.
  providers: {
    // agentSessions: true, // live Claude / Codex sessions, restartable in tmux
    // quota: true,         // how much of each usage window is spent
    // services: true,      // the public status pages those CLIs depend on
    // tools: true,         // installed CLI versions — and it installs new ones
    // sshAgent: true,      // whether a key is loaded, and an (a)dd verb if not
    //
    // The two CLIs keep themselves up to date, which is what `tools: true`
    // includes. To have the versions reported and nothing installed, say so
    // once rather than copying the default list out:
    // tools: { autoUpdate: false },
    //
    // The array forms, in place of `true`, for a machine that watches other
    // pages or other CLIs. An entry's own `autoUpdate` decides for that one.
    // services: [{ name: 'Anthropic', page: 'https://status.claude.com' }],
    // tools: [
    // { command: 'claude', repo: 'anthropics/claude-code', autoUpdate: false },
    // ],
    //
    // ⚠️ The only switch that spends anything: it sends `claude -p "hi"` and
    // `codex exec "hi"` to open a five-hour window that has closed, because a
    // window left shut is a window off the day's total. It runs in an empty
    // sandbox directory rather than in your repository, so the message costs
    // one word instead of pulling a whole project's instructions into a
    // context.
    // quotaSession: true,
    // Or only at these times, in this watch's own clock. Listing them turns
    // the "whenever it is found closed" behaviour off.
    // quotaSession: { at: ['06:00', '11:00', '16:00', '21:00'] },
    // A key per CLI says something different about one of them. What it does
    // not name keeps whatever the outer setting says.
    // quotaSession: { claude: { at: ['09:00'] }, codex: false },
    // quotaSession: { cwd: '/tmp/my-site-sandbox' },  // where they run
  },
};
```

</details>

Then run it:

```sh
bunx next-watch
```

A config file and `--start` work together: the scripts named on the command line are **added** to
the file's own `servers`, and an id that is already taken is refused rather than silently doubled.
`--build` belongs to the servers named on the command line — a described entry carries its own.
`providers` in the file always wins over what a flag would have switched on.

Two things a repository often reaches for are already above and need nothing new: `pull.blocked` is
where paths that must never arrive go, and `afterPull` is where a command that has to run once a
pull has landed goes. `--once --dry-run` prints what a pull would bring, which servers would
restart, and — for a described server — the steps each restart would take, without running any of
them.

<details>
<summary><code>detached: true</code>, and how a running server is adopted</summary>

**`detached: true` is for a server that should not go down when the dashboard does.** It is spawned
into its own process group with its output going straight to its log file, and a note is left in
`<logDir>/servers/<id>.pid`. The next watch reads that note and **adopts** the process it names —
so reopening the dashboard shows the running server rather than failing to start a second one onto
a taken port. It is deliberately **not** stopped when the watch exits; stopping it is something a
person asks for, with `(s)top` on the screen.

The note is only trusted when the process it names is still the one it was written about: alive,
signalable by this user, running something whose command line still names the script, and — on
Linux, where `/proc` says so — started at the moment recorded. Pids get reused, and a note is a
hint about the world rather than a fact.

</details>

## Keys and verbs

On a terminal the screen is operable, not only readable. Tab moves a cursor between the things on
it, and a verb runs on whatever the cursor is on.

<details>
<summary>Every verb, and the full key list</summary>

- **Restart, stop or start a server** — through that server's own adapter, which is the same path
  a pull takes, so the two cannot drift apart.
- **Kill or stop a task** — SIGKILL or SIGTERM to the pid the task list gave.
- **Restart an agent session** — SIGTERM, then its resume command is typed back into the same tmux
  pane, so the session comes back where it was.
- **Open a service's status page** in a browser.
- **Update a tool** — install the newest release of that CLI.
- **Focus a log pane** so it fills the frame, and again to go back.
- **Run `ssh-add`** — offered only while the agent holds no key, and the terminal is handed over
  properly so the passphrase is typed to `ssh-add` and not to the watcher.
- **Quit**, which is **refused once while something is running**, so a single Ctrl-C does not
  strand a half-stopped server. Press it again to leave anyway.

The full key list, which `(h)elp` also prints:

```
Tab / Shift-Tab  move the cursor · up/down  scroll the log pane · Esc  clear
press the letter in ( ) to run that verb on what the cursor is on
":" types a whole verb instead
server: (r)estart | (s)top | st(a)rt · task: (k)ill | (s)top
session: (r)estart | (s)top · service: (o)pen · tool: (u)pdate
session (r)estart = SIGTERM, then type its resume command back
into the same tmux pane; a session not in tmux says so on its row
log pane: (f)ocus to fill the frame, again to go back
ssh: (a)dd  run ssh-add here (only shown while the agent has no key)
anywhere: (h)elp | (q)uit
```

</details>

## Agents in tmux

A session started inside a tmux pane is one next-watch can **restart in place**: it stops the
session and types the resume command back into that same pane, so it comes back where it was.
Started from a plain shell it cannot, and its row says so.

[tmuxp](https://github.com/tmux-python/tmuxp) is a convenient way to lay a team out:

```sh
mise use pipx:tmuxp   # or: uv tool install tmuxp
tmuxp load .config/tmuxp.yaml
```

```yaml
# .config/tmuxp.yaml
session_name: agents
windows:
  - window_name: workers
    layout: even-horizontal
    panes:
      - start_directory: ./site
        shell_command: claude
      - start_directory: ./site
        shell_command: codex
      - start_directory: ./docs
        shell_command: claude
```

Each pane is one agent in one working tree, and mixing the CLIs is ordinary — the panel lists
both and tells them apart. Run next-watch in a window of its own beside them.

**What only works through tmux**

- **`(r)estart` on a session row.** It is SIGTERM followed by typing the resume command into the
  session's own pane; with no pane there is nowhere to type. Without tmux the row is still listed,
  and `(s)top` still works.
- Nothing else. Every other section and verb is the same with or without tmux.

<details>
<summary>How a session is matched to its pane</summary>

A session started **by another Claude Code session** inherits `CLAUDE_CODE_CHILD_SESSION`, and
the CLI then writes no `~/.claude/sessions/<pid>.json` for it. Such a session is still listed —
it is live and spending the same quota as any other — but the row is built from `ps` alone, so
the model, the context, the idle time and the version are left **empty rather than dashed**: the
record that holds them was never written. Its status reads `no record`, and the note under it
gives how long the process has been running. It is never offered `(r)estart`, in a tmux pane or
out of one, because there is no session id to resume.

`tmux list-panes -a` gives each pane's id, its root process and what it is running now. The agent
is not that root process — the pane runs a shell and the agent is a descendant of it — so the
session's ancestors are walked and **the innermost pane that matches wins**. A session whose
ancestors reach no pane is outside tmux, and that is the same condition the restart verb uses, so
the note on the row and the verb list cannot disagree.

A pane is only offered a restart when it has **returned to its shell**: typing a command into a
pane that is still running something would put the text into that program instead. A session with
no readable resume command is not offered one either — stopping it would leave nothing behind but
a prompt.

</details>

## Reference

<details>
<summary>Which sections are drawn, and the rules the quota session follows</summary>

**Which sections are drawn.** The repository ones — the branch, the pulls, the servers, each
server's log pane and the event log — are always there. **Tasks** appears only when the config
file supplies a `tasks` list. The rest are about the machine rather than the repository: on a run
with **no config file** every one of them is drawn except the quota session, which waits for
`--quota-session`; with a config file, `providers` decides and nothing is drawn unless it says so.

**The quota session, exactly.** A window opens with its first message and closes five hours later,
so time spent with it shut comes straight off the day's allowance.

- **automatic** (`quotaSession: true`) — open one whenever it is found closed, which keeps one
  running around the clock.
- **on a schedule** (`quotaSession: { at: ['09:00', '14:00'] }`, or `--quota-session-at`) — open
  one only at those times, read in the watch's own clock (`timezoneOffsetMinutes`). **`at` turns
  the automatic mode off**: between the listed times a closed window stays closed. That is the
  point of it — a window opened at 04:00 is spent by the time the day starts.

Nothing is made up for a time that passed while the watch was not running, each listed time fires
at most once a day, and a time that comes round while a window is already open sends nothing and
says so. A key per CLI says something different about one of them
(`{ claude: { at: [...] }, codex: false }`), and what it does not name keeps the outer setting. A
CLI that is not installed is skipped with one line in the log. Codex is sent
`codex exec --skip-git-repo-check "hi"`, because the sandbox is deliberately not a git repository
and Codex refuses to run outside one without that flag.

**One message per window, and retries only after a failure.** A send that works is remembered
against the clock, so the window it opened is left alone for its whole five hours however long the
usage figures take to agree — they are cached, and a percentage that still rounds to zero is not
an empty window. A send that **fails** is tried again ten minutes later, three times, and then
nothing more until a window opens; the line under the service row says which
(`failed 17:08 (exit 1) · retry 17:18`). Either way that line names the mode and what it is
waiting for — `session: manual · next refresh 14:00`, or `session: off`.

**What an automatic install writes.** `claude 2.1.280 is out (installed 2.1.273), updating ...`,
then the installer's own output as it arrives, then `claude 2.1.273 -> 2.1.280` once the new
version reads back.

</details>

<details>
<summary>Every command-line option</summary>

```
next-watch [options]

watch a remote branch, pull it, and restart only what needs restarting

Options:
      --version           Show version number                          [boolean]
      --config            path to the config file
                                     [string] [default: "next-watch.config.mjs"]
      --interval          how often to check git (seconds)[number] [default: 60]
      --panel             how often to redraw the status panel (seconds, 0 to
                          hide)                          [number] [default: 600]
      --sample            how often to poll local state (seconds)
                                                           [number] [default: 1]
      --log               lines in the event log pane (default: as many as the
                          terminal fits, 0 to hide)                     [number]
      --access            lines in each access log pane (default: auto, 0 to
                          hide)                                         [number]
      --start             run this npm script as a server (repeatable; needs no
                          config file)                     [array] [default: []]
      --build             npm script that must pass before a --start server is
                          stopped for a restart                         [string]
      --quota-session     with no config file, allow the session that opens a
                          closed quota window         [boolean] [default: false]
      --quota-session-at  open the quota window only at these times
                          (HH:MM,HH:MM); implies --quota-session
                                                           [array] [default: []]
      --once              check once and exit         [boolean] [default: false]
      --dry-run           report what would be pulled without pulling
                                                      [boolean] [default: false]
      --restart           restart after pulling (--no-restart to pull only)
                                                       [boolean] [default: true]
  -h, --help              Show help                                    [boolean]
  -v, --verbose           say more about what is happening             [boolean]
```

A server named by `--start` is started **when the watch starts**, which only the watching run
does: `--once` looks and leaves, so starting one there would be a side effect for no benefit. (A
plain `--once` that pulls something the server serves is the exception — the restart that follows
the pull starts it, and the process exiting a moment later stops it again.)

Note that **which sections the panel draws is not a flag**. Those are `providers` switches in the
config file, because they describe the machine rather than this particular run.

</details>

<details>
<summary>The access-log panes, and writing that line yourself</summary>

Each server gets a pane showing the tail of its log, newest at the bottom. The line it reads is
the one a Next.js dev server writes:

```
 GET /about 200 in 741ms
```

A server in production mode (`next start`) writes no request lines at all, and a pane that is
always empty is a pane nobody looks at. An application that wants its requests in the pane can
write that shape itself, and then one parser reads both — `formatAccessLine` produces exactly the
line above:

```ts
// instrumentation.ts
import { formatAccessLine } from 'next-watch/access-log';

export function register() {
  // ...wherever your server records a finished request:
  process.stdout.write(`${formatAccessLine({ method, target, status, ms })}\n`);
}
```

Where nothing in a log parses as a request, the raw tail is shown instead: the startup and error
lines are worth more there than an empty box.

</details>

<details>
<summary>Subpaths you can import</summary>

| Import                  | What it is                                                          |
| ----------------------- | ------------------------------------------------------------------- |
| `next-watch`            | `startWatch`, and the config types                                  |
| `next-watch/core`       | everything the dashboard decides and draws, with no I/O             |
| `next-watch/term`       | frames, tables and terminal widths                                  |
| `next-watch/access-log` | reading and writing the access-log line                             |
| `next-watch/process`    | `ps` snapshots, liveness, signals                                   |
| `next-watch/quota`      | the quota shapes and arithmetic. **Pure — safe in a browser**       |
| `next-watch/quota/io`   | reading that quota from the credentials, the endpoint and the cache |

</details>

## Development

The toolchain is [bun](https://bun.sh); **using the package needs only node 22 or later**, because
what is published is plain ESM. The checks, the layering and the release rules are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

---

<p align="center">
Node 22 or later · <a href="./LICENSE">Apache-2.0</a> (<a href="./NOTICE">NOTICE</a>) · built for
a spare box on the desk.
</p>
