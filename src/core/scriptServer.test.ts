// The three readings `--start <script>` rests on. Each one is a string in and a value out, so
// each one is a table: which manager a tree installs with, what a line of a server's output
// says about its address, and what a package name may be used as a directory name.
import { describe, expect, it } from 'bun:test';
import { packageManagerFor, parseServerAddress, safeAppName } from './scriptServer.js';

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

describe('parseServerAddress', () => {
  const cases: [name: string, line: string, expected: { url: string; port: number | null } | null][] = [
    ['Next 13 and later', '   - Local:        http://localhost:3000', { url: 'http://localhost:3000', port: 3000 }],
    ['a single space after the label', '- Local: http://localhost:4000', { url: 'http://localhost:4000', port: 4000 }],
    [
      'Next 12',
      'ready - started server on 0.0.0.0:3000, url: http://localhost:3000',
      { url: 'http://localhost:3000', port: 3000 },
    ],
    ['the network address, which is also the server', '- Network: http://192.168.0.4:3000', null],
    ['https with an explicit port', '- Local: https://localhost:8443', { url: 'https://localhost:8443', port: 8443 }],
    // No port in the URL means none was read. Filling in 80 would be a guess printed as a
    // reading, and the panel cannot tell the two apart.
    ['no port in the url', '- Local: http://example.test', { url: 'http://example.test', port: null }],
    [
      'a trailing slash is not part of the address',
      '- Local: http://localhost:3000/',
      { url: 'http://localhost:3000', port: 3000 },
    ],
    ['a trailing full stop', 'url: http://localhost:3000.', { url: 'http://localhost:3000', port: 3000 }],
    // The reason the label is required at all: these lines all carry a URL, and none of them is
    // the server saying where it listens.
    ['a request line', ' GET /about 200 in 741ms', null],
    ['a URL in an error message', 'Error: failed to fetch https://status.example.test/api', null],
    ['a bare URL on its own', 'http://localhost:3000', null],
    ['a label that is part of a longer word', 'nolocal: http://localhost:3000', null],
    ['a label with nothing after it', '- Local:', null],
    ['something that is not a URL at all', '- Local: nowhere', null],
    ['an empty line', '', null],
  ];

  for (const [name, line, expected] of cases) {
    it(name, () => {
      expect(parseServerAddress(line)).toEqual(expected);
    });
  }
});

describe('safeAppName', () => {
  // The value goes into `join(tmpdir(), appName)`, so what is checked is that nothing comes out
  // that would move the path somewhere else.
  const cases: [name: string, input: string, expected: string][] = [
    ['a plain name', 'my-site', 'my-site'],
    ['a scoped package', '@acme/site', 'acme-site'],
    ['a name with a dot', 'site.dev', 'site.dev'],
    ['a path separator', 'a/b/c', 'a-b-c'],
    ['a parent directory', '../escape', 'escape'],
    ['a leading dot, which would hide the directory', '.hidden', 'hidden'],
    ['spaces', 'my site', 'my-site'],
    ['nothing usable', '@/', 'next-watch'],
    ['nothing at all', '', 'next-watch'],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(safeAppName(input)).toBe(expected);
    });
  }
});
