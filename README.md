# next-watch

A terminal dashboard for a machine that runs somebody else's commits. It watches a remote branch,
pulls it, restarts only the servers the incoming files actually affect, and draws one screen that
redraws in place. It is built for the case where **the machine that runs the code is not the
machine the code is written on** — a spare box, a second laptop, a machine on the desk that serves
a site while the work happens elsewhere. Nobody is typing there, so the watch has to be able to
explain itself afterwards, and it must never do anything destructive on its own.

## Install and start

```sh
bun add -d next-watch
bunx next-watch --start dev
```

With npm instead:

```sh
npm install --save-dev next-watch
npx next-watch --start dev
```

**Node 22 or later is all that is needed to run it** — the package is plain ESM with one
dependency (`yargs`), and bun is the toolchain, not a requirement. In a Next.js project set up the
usual way, that second line is the whole setup: no config file, no adapter to write.

The first thing worth running is the one that changes nothing:

```sh
bunx next-watch --once --dry-run --start dev
```

It prints what a pull would bring and what would restart, and spawns nothing at all.

`--start <script>` makes an npm script a server of this watch. It is started when the watch
starts, stopped when the watch stops, restarted when a pull brings in something it serves, and its
output goes to that server's log pane. The flag is repeatable — `--start web --start admin`.

For a server that has to be built first, `--build <script>` runs that script **before** anything
is stopped, and a build that fails leaves the running server alone and says so. That makes the
production shape:

```sh
bunx next-watch --start start --build build
```

The package manager is the one the project already installs with, read from the lockfile:
`bun.lock` (or `bun.lockb`) → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn,
`package-lock.json` → npm, and npm where there is none. A checkout holding more than one lockfile
is read in that order, so a repository that moved to bun and left `package-lock.json` behind is a
bun repository. The install that follows a pull uses the same reading — `<pm> install`, with the
lockfile read at that moment, because the pull that swaps one lockfile for another is exactly the
pull that moves the dependencies. `packageManager` in `package.json` (corepack) is not consulted.

With no config file, the rest is derived: `appName` is the `name` in `package.json` (or the
directory's name), `root` is the working directory, `branch` is `main`, the remote is
`origin/main`, and a dependency change is `package.json` or whichever lockfile is there.

## What you see, and what you can do

One screen, redrawn in place. This is a real one, watching a throwaway project with one described
server and three of the optional sections turned on — the agent sessions, the service status, and
the quota session, on a schedule for Claude and automatic for Codex:

```
╭─ next-watch 0.3.0  12:39:35  up 17s ───────────────────────────────────────╮
│ REPO     /tmp/nw-shot/site  main 2bc45b3  in sync with origin/main         │
│          nothing pulled during this watch · next git check 3582s           │
│                                                                            │
│    SERVER  STATE  URL                    OWNER       MODE  UPTIME          │
│    web     up     http://localhost:3400  pid 764986  bun      18s          │
│                                                                            │
│ SESSION  TREE        AGENT   STATUS  MODEL        CONTEXT  IDLE    VER     │
│   site-da                                                                  │
│          site        claude  busy    opus-5           31k     24s  2.1.273 │
│   What does the dev script in package.json…                                │
│          site        codex   idle    gpt-6-astra      15k      9s  0.154.0 │
│                                                                            │
│    SERVICE  Claude  ●  All Systems Operational                             │
│             session: manual · next refresh 16:00                           │
│             OpenAI  ●  All Systems Operational                             │
│             session: auto · next refresh when the window closes (16:58)    │
├─ event log ────────────────────────────────────────────────────────────────┤
│ 12:39:17 ◎ next-watch started (git every 3600s · keys on)                  │
│ 12:39:17 ○ web: bun run dev                                                │
│ 12:39:17 ○ web is listening on http://localhost:3400                       │
│ 12:39:17 ◆ server web is up at http://localhost:3400 (bun)                 │
│ 12:39:18 · quota: claude next scheduled session 16:00                      │
├─ web access  /tmp/nw-shot/site/log/web.txt ────────────────────────────────┤
│           $ node server.mjs                                                │
│ 12:39:20  GET                404  12ms  /missing                           │
│ 12:39:21  GET                200  11ms  /                                  │
╰────────────────────────────────────────────────────────────────────────────╯

  ⠋ Tab select · up/down scroll · (h)elp · (q)uit
```

What the sections are. The first five are the repository itself and are always drawn:

- **Repository** — where it is watching, the branch, `HEAD`, and how far behind the remote it is.
- **Pulls** — each one names the commits it brought, with subjects, authors and the diff size, so
  a server never restarts without saying why.
- **Servers** — one row each: up or down, the URL, the owning pid, the mode, how long it has been
  running.
- **The tail of each server's log**, in its own pane, newest at the bottom. Request lines are
  parsed and coloured by status; anything else is shown raw.
- **The event log** — everything the watch has done, timestamped, and kept across restarts of the
  watch itself.

**Tasks** is drawn when the config file supplies a `tasks` list, and never otherwise: work started
outside the watcher, with a kill verb on each row.

The rest are about the machine rather than the repository. **On a run with no config file every
one of them is drawn except the last, which waits for `--quota-session`**; with a config file,
`providers` decides and nothing is drawn unless it says so (see [Config](#config)).

- **Agent sessions** — live Claude and Codex sessions on this machine, their model, context and
  idle time.
- **Quota windows** — how much of each usage window is spent, and when it resets.
- **Service status** — the public status pages of the services those CLIs depend on.
- **Tool versions** — the installed CLI versions against the newest published release.
- **ssh-agent** — whether a key is loaded, because without one a pull over SSH simply fails.
- **Opening a closed quota window** — the one section that _spends_ something: it starts a session
  of its own (`claude -p "hi"`, `codex exec "hi"`) in an empty sandbox directory. **Off unless
  asked for**, with `--quota-session` or `providers.quotaSession`. It works two ways:
  - **automatic** (`quotaSession: true`) — open a window whenever one is found closed, which keeps
    one running around the clock.
  - **on a schedule** (`quotaSession: { at: ['09:00', '14:00'] }`, or `--quota-session-at`) — open
    one only at those times, read in the watch's own clock (`timezoneOffsetMinutes`). **`at` turns
    the automatic mode off**: between the listed times a closed window stays closed. That is the
    point of it — a window opened at 04:00 is spent by the time the day starts. Nothing is made up
    for a time that passed while the watch was not running, each listed time fires at most once a
    day, and a time that comes round while a window is already open sends nothing and says so.

  It covers **both CLIs**, each decided on its own window, and a key per CLI says something
  different about one of them: `{ claude: { at: [...] }, codex: false }`. A CLI that is not
  installed is skipped with one line in the log.

  Either way, each row of the **service status** carries a second line saying which mode is on for
  that CLI and what it is waiting for — `session: manual · next refresh 14:00`, or `session: off` —
  so a setting that spends something can be read off the screen instead of out of the config file.

On a terminal the screen is operable, not only readable. Tab moves a cursor between the things on
it, and a verb runs on whatever the cursor is on:

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
into the same tmux pane
log pane: (f)ocus to fill the frame, again to go back
ssh: (a)dd  run ssh-add here (only shown while the agent has no key)
anywhere: (h)elp | (q)uit
```

Rows that overflow are **wrapped, not cut** — the tail of a line is where the error message and
the URL are. Off a terminal (a pipe, a log file) the panel is printed only when its content
actually changed, so a redirected watch does not fill a file with one panel a second.

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
builds, and a described server **is started when the watch starts**, because next-watch spawns
that child itself. Writing one out is supplying the four functions yourself, for a repository
whose starting and stopping are its own business — those are left alone at startup, since whether
such a server is already running is not something to decide on its behalf. The two forms may be
mixed in one `servers` array.

Everything optional below is commented out, with what turning it on gives you:

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
    // The array forms, in place of `true`, for a machine that watches other
    // pages or other CLIs. `autoUpdate: false` reports a new release and
    // installs nothing, where `tools: true` installs it.
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

Then run it:

```sh
bunx next-watch
```

A config file and `--start` work together: the scripts named on the command line are **added** to
the file's own `servers`, and an id that is already taken is refused rather than silently doubled.
`--build` belongs to the servers named on the command line — a described entry carries its own.
`providers` in the file always wins over what a flag would have switched on.

**`detached: true` is for a server that should not go down when the dashboard does.** It is
spawned into its own process group with its output going straight to its log file, and a note is
left in `<logDir>/servers/<id>.pid`. The next watch reads that note and **adopts** the process it
names — so reopening the dashboard shows the running server rather than failing to start a second
one onto a taken port. It is deliberately **not** stopped when the watch exits; stopping it is
something a person asks for, with `(s)top` on the screen.

The note is only trusted when the process it names is still the one it was written about: alive,
signalable by this user, running something whose command line still names the script, and — on
Linux, where `/proc` says so — started at the moment recorded. Pids get reused, and a note is a
hint about the world rather than a fact.

Two things a repository often reaches for are already above and need nothing new: `pull.blocked`
is where paths that must never arrive go, and `afterPull` is where a command that has to run once
a pull has landed goes. `--once --dry-run` prints what a pull would bring, which servers would
restart, and — for a described server — the steps each restart would take, without running any of
them.

The agent-session section finds Codex sessions by reading `/proc`, so **that half is Linux only**;
elsewhere those rows are simply absent and the watch carries on. tmux not being present is equally
ordinary — it only costs those rows their restart verb.

## Options

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

## The access-log panes

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

## What leaves the machine

Nothing at all until a provider is switched on — **except on a run with no config file**, where
every section but `quotaSession` is on and this is the traffic that follows. With all of them on,
and never more often than this:

| Where                                                                 | What for                          | How often                                                                                              | Off with                               |
| --------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `api.anthropic.com/api/oauth/usage`                                   | the usage windows                 | at most once a minute, and not at all while a cache written by something else on this machine is fresh | `quota: false`                         |
| `codex app-server` (a local process, not the network)                 | the same, for the other CLI       | at most once a minute                                                                                  | `quota: false`                         |
| `status.claude.com`, `status.openai.com`                              | the public status summaries       | at most once a minute                                                                                  | `services: false`                      |
| `api.github.com/repos/<repo>/releases/latest`                         | the newest published version      | at most once every ten minutes                                                                         | `tools: false`                         |
| `claude -p "hi"` (a local process, through the CLI's own credentials) | opening a closed five-hour window | at most once per closed window, or once per listed time                                                | `quotaSession: false`, `claude: false` |
| `codex exec "hi"` (the same, for the other CLI)                       | the same                          | the same                                                                                               | `quotaSession: false`, `codex: false`  |

Every one of them has a timeout, none of them can throw, and a failure costs its own section and
nothing else. The credentials the quota reads are the ones the CLI already wrote on this machine;
the token goes to the endpoint that issued it and reaches no log, no event and no file.

`git fetch` runs in a way that **cannot raise an authentication prompt**. On a checkout whose
remote is https and with nobody at the terminal, git would otherwise hang asking for credentials
and the watch would die without a word.

## Subpaths

| Import                  | What it is                                                          |
| ----------------------- | ------------------------------------------------------------------- |
| `next-watch`            | `startWatch`, and the config types                                  |
| `next-watch/core`       | everything the dashboard decides and draws, with no I/O             |
| `next-watch/term`       | frames, tables and terminal widths                                  |
| `next-watch/access-log` | reading and writing the access-log line                             |
| `next-watch/process`    | `ps` snapshots, liveness, signals                                   |
| `next-watch/quota`      | the quota shapes and arithmetic. **Pure — safe in a browser**       |
| `next-watch/quota/io`   | reading that quota from the credentials, the endpoint and the cache |

## Development

The toolchain is [bun](https://bun.sh): `bun install`, then `bun run lint`, `bun run typecheck`,
`bun test`, `bun run build`. **Using the package needs only node 22 or later** — what is published
is plain ESM, and it runs under bun as well.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
