# Contributing

Thanks for looking. Issues and pull requests are both welcome, and a small one that fixes
something real is worth more here than a large one that rearranges what already works.

## The toolchain is bun; the product is node

[bun](https://bun.sh) installs the dependencies, runs the scripts and runs the tests
(`bun:test` — there is no vitest). What is published is plain ESM that **node 22 or later** runs
on its own: `bin/next-watch.js` keeps a node shebang, and CI installs node next to bun and starts
the built binary with it, so the runtime the package claims to support is the one it is proved
against.

```sh
bun install
```

`typescript` is pinned to `^6` on purpose — 7 breaks typescript-eslint — and `tsc` stays in the
build because bun does not emit `.d.ts`.

## What has to pass

Five checks:

```sh
bun run check:format   # prettier
bun run lint           # eslint, warnings included
bun run typecheck      # tsc --noEmit
bun test
bun run build          # tsc -p tsconfig.build.json
```

`simple-git-hooks` runs the **first four** before every commit, so with the hook installed most of
this happens without being asked. CI runs **all five** on every push to `main` and on every pull
request, plus `node bin/next-watch.js --version` against what the build produced.

**Run `bun run build` yourself before opening a pull request.** It is the one check the commit
hook does not do, and it is the one that catches a type that only fails when declarations are
emitted.

Lint runs with `--max-warnings 0`. If a threshold is in the way — a function too long, a file too
complex — split the function or the file. Raising the threshold is not the fix.

## How the code is arranged

Three directories, and the dependency direction only ever points one way:

```
src/core/  ->  src/io/  ->  src/cli/
```

- `src/core/` is pure: no process, no terminal, no filesystem, no network, no clock that was not
  passed in. The decisions live here, which is why they can be tested as a table of inputs and
  expected outputs.
- `src/io/` talks to the outside world — reading git, listing processes, drawing to a terminal.
- `src/cli/` wires the two together and is the only layer that may call `process.exit`.

`eslint.config.mjs` enforces the direction. If a pure function seems to need I/O, pass the value
in rather than adding an exception.

Tests for pure functions are tables: the inputs and the expected outputs written down, not a
restatement of the implementation. A good check on a new test is whether it fails against the code
as it was before your change.

## Comments, and where decisions live

Comments explain **why** — the reason, the measured number, or the failure that motivated the
shape. The code already says what it does.

The standing decisions about this repository are in [AGENTS.md](./AGENTS.md): the layering rule,
the toolchain pins, the staging rules, and the release sequence. It is written for the coding
agents that work here, but it is the honest answer to "why is it like this", so read it before
changing something that looks arbitrary.

Everything in the code, the comments, the documentation and the commit messages is in English.

## Releases

Preparing a release — the changelog entry, the version bump, the tag — is ordinary work.

**Publishing is not, and is done by a person.** `npm publish` cannot be undone: once a version is
on the registry that number is spent for ever. Please do not include a version bump in a pull
request; it will be handled when the change is released.
