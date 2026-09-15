/** Reading a checkout to find out which package manager it uses.
 *
 *  ⚠️ **Read it when the answer is needed, never once at startup.** The pull that migrates a
 *  repository from one manager to another — a `bun.lock` arriving, a `package-lock.json` going
 *  — is exactly the pull that moves the dependencies and so triggers an install. A value read
 *  when the watch began would answer with the manager the repository has just stopped using. */
import fs from 'node:fs';
import { packageManagerFor, type PackageManagerChoice } from '../core/packageManager.js';

/** What is in a directory. **Unreadable answers the same as empty**, because the reading taken
 *  from it has a defensible answer for a directory with nothing in it: npm. */
function entriesOf(root: string): string[] {
  try {
    return fs.readdirSync(root);
  } catch {
    return [];
  }
}

/** The package manager this checkout installs with, as it stands right now. */
export function packageManagerAt(root: string): PackageManagerChoice {
  return packageManagerFor(entriesOf(root));
}
