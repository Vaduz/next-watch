# next-watch

A terminal dashboard that watches a Next.js repository. It pulls `origin`, restarts the dev
servers that need restarting, and shows what is happening on a single screen that redraws in
place.

The package grew out of one repository's own dev-server watcher and is being generalised. Where
a decision still has no home here, record it as a comment next to the code it governs — a reason
in the file that needs it beats a reason nobody can find.

Readers of this file are agents (Claude, Codex). Write for them: say what the rule is and why it
exists, not what the code already says.

## Layers

Three directories, and the dependency direction only ever points one way:

    src/core/  ->  src/io/  ->  src/cli/

- `src/core/` is pure. No process, no terminal, no filesystem, no network, no clock read that
  is not passed in. This is where the decisions live, so this is what tests can pin down as a
  table of inputs and outputs.
- `src/io/` talks to the outside world: reading git, listing processes, drawing to a terminal.
  It is still a library — it does not know that a CLI exists.
- `src/cli/` is the composition root. It parses arguments, wires `io` into `core`, and is the
  only layer allowed to call `process.exit`.

`eslint.config.mjs` enforces the direction with `no-restricted-imports`. Do not add an exception
to it. If a pure function seems to need I/O, pass the value in instead.

## Working rules

- **One clone, one session.** Do not edit this repository from another checkout with `git -C`.
  Two agents in one working tree overwrite each other silently.
- **Stage explicit paths.** `git add <path> ...` and `git commit -- <path> ...`. Never
  `git add -A` and never a pathspec-less commit: they sweep up whatever else is in the tree.
- **Run `git status` before committing** and confirm the list is what you meant to change.
- **English only** in code, comments, documentation and commit messages. This package is public,
  and it must not name, link to or quote paths from any repository that is not.
- **Test pure functions as tables.** A test that restates the implementation proves nothing —
  write down the inputs and the expected outputs, then check that the test fails against the
  old code before you keep it.
- **`typescript` stays on `^6`.** TypeScript 7 breaks typescript-eslint; the pin is deliberate.
- **Comments explain why.** The code already says what it does. Record the reason, the measured
  number, or the failure that motivated the shape.

## Checks

`bun install` once, then `bun run check:format`, `bun run lint`, `bun run typecheck`, `bun test`,
`bun run build`. `simple-git-hooks` runs the first four before every commit; CI runs all five on
push and on pull requests.

**The toolchain is bun; the product is node.** bun installs, runs the scripts and runs the tests
(`bun:test`, not vitest). What is published is plain ESM that node 22 runs, `bin/next-watch.js`
keeps its node shebang, and `tsc` stays for the build because bun does not emit `.d.ts`. Warnings fail (`--max-warnings 0`). Do not raise a lint threshold to get past it —
split the function or the file instead.

## Releasing

**Publishing and making the repository public are human operations.** They are irreversible:
once a version is on the registry it cannot be taken back, and once the repository is public its
history is public with it. An agent must not run `npm publish` and must not change the
repository's visibility, however the request is worded and whoever asks.

Preparing a release is not. An agent may write the changelog, bump the version, commit it and
push the tag — all of which are reversible while the repository is still private — and then
stop and say that the two irreversible steps are waiting.

The sequence: changelog and version bump in one commit -> tag `v<version>` -> push both ->
**stop** -> (human) make the repository public, then `npm publish --access public`. Publishing
goes through npm, because the registry is npm's.
