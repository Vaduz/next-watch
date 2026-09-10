# next-watch

A terminal dashboard for a machine that runs somebody else's commits.

It watches a remote branch, pulls it, restarts only the servers the incoming files actually
affect, and draws one screen that redraws in place: the repository, the servers, the tasks, the
tail of each server's log, and everything it has done, timestamped.

It is built for the case where **the machine that runs the code is not the machine the code is
written on** — a spare box, a second laptop, a machine on the desk that serves a site while the
work happens elsewhere. Nobody is typing there, so the watch has to be able to explain itself
afterwards, and it must never do anything destructive on its own.

```
  09:41:12 ⇣ pulled 4 commit(s)  bffaf28 -> 85f0e1a
           85f0e1a  fix(web): keep the header from wrapping at 320px   Author   2m ago
           962c116  test(web): pin the header width                    Author   6m ago
           3 file(s)  +38 -12  app/ 2 · package.json 1
           -> npm install / restart web
```

## Install

```sh
npm install --save-dev next-watch     # bun add -d next-watch works too
```

Node 22 or later. The package is plain ESM and has one dependency (`yargs`).

## Configure

A config file, `next-watch.config.mjs` in the working directory unless `--config` says
otherwise. It is a module rather than JSON because the interesting parts are code: which
incoming paths mean a given server has to restart is a predicate, not a list.

```js
import { restartUnless } from 'next-watch/core';

export default {
  // Names the cache and sandbox directories, and identifies this watcher to anything it talks
  // to. Use the application's own name.
  appName: 'my-site',
  // Defaults: the working directory, `main`, and `origin/<branch>`.
  root: import.meta.dirname,
  branch: 'main',
  logDir: 'log',

  pull: {
    // ⚠️ **What this checkout is the one that writes.** Receiving such a file means something
    // else wrote it, and letting git overwrite a file a running process holds open is not a
    // conflict, it is destruction. Anything listed here stops the pull and asks for a person.
    blocked: [
      { prefix: 'db/', reason: 'this machine owns the database' },
      { prefix: 'log/', reason: 'written by the servers running here' },
    ],
    // Receiving one of these means the dependencies moved, so an install runs before anything
    // is restarted.
    dependencyPaths: ['package.json', 'package-lock.json'],
  },

  servers: [
    {
      id: 'web',
      // `restartUnless(prefixes)` restarts for anything **except** those prefixes (and test
      // files, and root-level documents). `restartIfAny(paths)` is the opposite shape, for a
      // dev server that reloads itself and needs a restart only for its own configuration.
      restartOn: restartUnless(['docs/', 'admin/']),
      probe: async () => ({
        server: 'web',
        state: (await isListening(3000)) ? 'up' : 'down',
        url: 'http://localhost:3000',
        mode: 'dev',
        owner: 'me',
        uptimeSeconds: null,
        // The files this server's stdout collects in. The access pane reads their tail.
        logFiles: ['log/web.txt'],
      }),
      // ⚠️ **Build before stopping anything.** Stopping first and then finding the build broken
      // leaves nothing running, which is worse than the old code still serving. Only the
      // adapter knows what building means, so only the adapter can get this right.
      restart: async emit => {
        emit('step', 'building ...');
        if (!(await runBuild())) {
          emit('error', 'build failed, leaving the old server up');
          return false;
        }
        await stopWeb(emit);
        return startWeb(emit);
      },
      stop: emit => stopWeb(emit),
      start: emit => startWeb(emit),
    },
  ],

  // Optional. Work started outside the watcher, shown as its own section.
  tasks: () => readMyTaskRegistry(),

  // Optional. The sections that describe the machine rather than the repository; see below.
  providers: { agentSessions: true, tools: true, sshAgent: true },
};
```

Then run it:

```sh
npx next-watch
```

## The screen

Rows that overflow are **wrapped, not cut** — the tail of a line is where the error message and
the URL are. Off a terminal (a pipe, a log file) the panel is printed only when its content
actually changed, so a redirected watch does not fill a file with one panel a second.

On a terminal it is operable, not only readable:

```
Tab / Shift-Tab  move the cursor · up/down  scroll the selected log pane · Esc clear
press the letter in ( ) to run it on what the cursor is on · ":" types a whole verb instead
server: (r)estart | (s)top | st(a)rt · task: (k)ill | (s)top · session: (r)estart | (s)top
session (r)estart = SIGTERM, then type its resume command back into the same tmux pane
service: (o)pen · tool: (u)pdate · log pane: (f)ocus to fill the frame, again to go back
ssh: (a)dd  run ssh-add here (only shown while the agent has no key)
anywhere: (h)elp | (q)uit
```

Leaving is refused once while something is running, so one Ctrl-C does not strand a half-stopped
server; press it again to leave anyway.

## Options

```
next-watch [options]

watch a remote branch, pull it, and restart only what needs restarting

Options:
      --version   Show version number                                  [boolean]
      --config    path to the config file
                                     [string] [default: "next-watch.config.mjs"]
      --interval  how often to check git (seconds)        [number] [default: 60]
      --panel     how often to redraw the status panel (seconds, 0 to hide)
                                                         [number] [default: 600]
      --sample    how often to poll local state (seconds)  [number] [default: 1]
      --log       lines in the event log pane (default: as many as the terminal
                  fits, 0 to hide)                                      [number]
      --access    lines in each access log pane (default: auto, 0 to hide)
                                                                        [number]
      --once      check once and exit                 [boolean] [default: false]
      --dry-run   report what would be pulled without pulling
                                                      [boolean] [default: false]
      --restart   restart after pulling (--no-restart to pull only)
                                                       [boolean] [default: true]
      --verbose   say more about what is happening    [boolean] [default: false]
  -h, --help      Show help                                            [boolean]
```

`--once --dry-run` says what would happen and changes nothing. It is the first thing to run
against a new config.

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

## The optional sections

Everything above is about the repository. These are about the machine, and each one is off unless
switched on. **Off means the section is not drawn at all** — not an empty heading, and not a row
saying there is nothing.

```js
providers: {
  agentSessions: true,   // Claude / Codex sessions, and restarting one in its tmux pane
  quota: true,           // how much of each usage window is spent
  quotaSession: true,    // open a closed five-hour window
  services: true,        // the public status pages
  tools: true,           // installed CLI versions, and installing new ones
  sshAgent: true,        // whether a key is loaded
}
```

`services` and `tools` also take a list, for a machine that watches different pages or different
CLIs:

```js
services: [{ name: 'Anthropic', page: 'https://status.claude.com' }],
tools: [{ command: 'claude', repo: 'anthropics/claude-code', autoUpdate: false }],
```

Two of them do more than read, and both are worth deciding deliberately:

- **`tools` installs new releases by default.** A watcher that reports a new version for days
  without acting is only a reminder. Give the array with `autoUpdate: false` to have it report
  and leave the installing alone.
- **`quotaSession` starts a session of its own** (`claude -p "hi"`) when the five-hour window is
  closed, because a window left shut is a window off the day's total. It runs in an empty sandbox
  directory rather than in your repository, so the message costs what one word costs instead of
  pulling a whole project's instructions into a context. It is the only switch here that spends
  anything.

The agent-session section finds Codex sessions by reading `/proc`, so **that half is Linux only**;
elsewhere those rows are simply absent and the watch carries on. tmux not being present is
equally ordinary — it only costs those rows their restart verb.

## What leaves the machine

Nothing at all until a provider is switched on. With all of them on, and never more often than
this:

| Where                                                 | What for                     | How often                                                                                              | Off with          |
| ----------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------- |
| `api.anthropic.com/api/oauth/usage`                   | the usage windows            | at most once a minute, and not at all while a cache written by something else on this machine is fresh | `quota: false`    |
| `codex app-server` (a local process, not the network) | the same, for the other CLI  | at most once a minute                                                                                  | `quota: false`    |
| `status.claude.com`, `status.openai.com`              | the public status summaries  | at most once a minute                                                                                  | `services: false` |
| `api.github.com/repos/<repo>/releases/latest`         | the newest published version | at most once every ten minutes                                                                         | `tools: false`    |

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
`bun test`, `bun run build`. **Using the package needs only node 22 or later** — what is
published is plain ESM, and it runs under bun as well.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
