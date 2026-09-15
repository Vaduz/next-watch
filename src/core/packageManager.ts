/** **Which package manager a checkout uses, and what to run with it.** Pure: the answer is
 *  read off a directory listing.
 *
 *  Two places need it and they must not disagree. `--start <script>` spawns `<pm> run <script>`,
 *  and the install that follows a dependency change runs `<pm> install` — running one project
 *  with two managers is how a `package-lock.json` appears in a bun repository and how
 *  `node_modules` stops matching what the lockfile pins. */

export type PackageManager = 'npm' | 'bun' | 'pnpm' | 'yarn';

/** Which lockfile means which manager, **in the order they are looked for**.
 *
 *  ⚠️ The order is the whole content of this list, because a tree with several lockfiles is
 *  ordinary: a repository that moved from npm to bun and never deleted `package-lock.json`
 *  still installs with bun. The first hit wins, so npm is last — it is also the answer for a
 *  tree with no lockfile at all, which is an npm tree nobody has installed yet. */
const LOCKFILES: readonly { lockfile: string; manager: PackageManager }[] = [
  { lockfile: 'bun.lock', manager: 'bun' },
  { lockfile: 'bun.lockb', manager: 'bun' },
  { lockfile: 'pnpm-lock.yaml', manager: 'pnpm' },
  { lockfile: 'yarn.lock', manager: 'yarn' },
  { lockfile: 'package-lock.json', manager: 'npm' },
];

export interface PackageManagerChoice {
  manager: PackageManager;
  /** The lockfile it was read from, or null when there was none. It is also what counts as a
   *  dependency change, so the caller needs the name and not only the manager. */
  lockfile: string | null;
}

/** The package manager for a directory holding these entries. */
export function packageManagerFor(entries: readonly string[]): PackageManagerChoice {
  const found = LOCKFILES.find(l => entries.includes(l.lockfile));
  return found === undefined ? { manager: 'npm', lockfile: null } : { ...found };
}

/** How to install with a given manager.
 *
 *  All four spell it the same way today. It is a function rather than a template because this
 *  is the one place to change if one of them ever needs an argument — a frozen install, say —
 *  and because what runs against a person's checkout is worth being able to read as a table. */
export function installCommand(manager: PackageManager): { command: string; args: readonly string[] } {
  return { command: manager, args: ['install'] };
}
