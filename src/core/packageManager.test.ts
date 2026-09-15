// Which manager a checkout installs with, and what gets run with it. Both are read off names,
// so both are tables.
import { describe, expect, it } from 'bun:test';
import { installCommand, packageManagerFor, type PackageManager } from './packageManager.js';

describe('packageManagerFor', () => {
  const cases: [name: string, entries: string[], manager: string, lockfile: string | null][] = [
    ['npm', ['package.json', 'package-lock.json'], 'npm', 'package-lock.json'],
    ['bun', ['package.json', 'bun.lock'], 'bun', 'bun.lock'],
    ['bun, binary lockfile', ['package.json', 'bun.lockb'], 'bun', 'bun.lockb'],
    ['pnpm', ['package.json', 'pnpm-lock.yaml'], 'pnpm', 'pnpm-lock.yaml'],
    ['yarn', ['package.json', 'yarn.lock'], 'yarn', 'yarn.lock'],
    // The case the order exists for: a repository that moved to bun and left the old lockfile
    // behind installs with bun, not with whichever name happened to be read first.
    ['bun beside a leftover package-lock.json', ['bun.lock', 'package-lock.json'], 'bun', 'bun.lock'],
    ['pnpm beside a leftover yarn.lock', ['yarn.lock', 'pnpm-lock.yaml'], 'pnpm', 'pnpm-lock.yaml'],
    ['no lockfile at all', ['package.json', 'src'], 'npm', null],
    ['an empty directory', [], 'npm', null],
    // A directory whose name looks like a lockfile is still not one, but this reader only sees
    // names: what matters is that a near miss does not match.
    ['a near miss', ['package-lock.json.bak', 'bun.lock.txt'], 'npm', null],
  ];

  for (const [name, entries, manager, lockfile] of cases) {
    it(name, () => {
      expect(packageManagerFor(entries)).toEqual({ manager, lockfile } as ReturnType<typeof packageManagerFor>);
    });
  }
});

describe('installCommand', () => {
  // What actually runs against somebody's checkout after a pull moved the dependencies.
  const cases: [manager: PackageManager, command: string, args: string[]][] = [
    ['npm', 'npm', ['install']],
    ['bun', 'bun', ['install']],
    ['pnpm', 'pnpm', ['install']],
    ['yarn', 'yarn', ['install']],
  ];

  for (const [manager, command, args] of cases) {
    it(manager, () => {
      expect(installCommand(manager)).toEqual({ command, args });
    });
  }
});
