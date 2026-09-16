// Whether a command can be run here. The watcher asks before spawning an agent CLI, so a
// machine with only one of the two collects one log line instead of a failed spawn a second.
import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandInstalled } from './installed.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A directory holding the given files, each with the mode it is given. */
function bin(files: Record<string, number>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-watch-bin-'));
  dirs.push(dir);
  for (const [name, mode] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), '#!/bin/sh\nexit 0\n', { mode });
  }
  return dir;
}

describe('commandInstalled', () => {
  it('finds an executable on the path', () => {
    const dir = bin({ codex: 0o755 });

    expect(commandInstalled('codex', dir)).toBe(true);
  });

  it('does not find one that is not there', () => {
    expect(commandInstalled('codex', bin({ claude: 0o755 }))).toBe(false);
  });

  it('does not find a file that cannot be executed', () => {
    expect(commandInstalled('codex', bin({ codex: 0o644 }))).toBe(false);
  });

  it('looks in every directory of the path, not only the first', () => {
    const first = bin({ claude: 0o755 });
    const second = bin({ codex: 0o755 });

    expect(commandInstalled('codex', [first, second].join(path.delimiter))).toBe(true);
  });

  it('survives a path with empty entries and directories that do not exist', () => {
    const dir = bin({ codex: 0o755 });

    expect(commandInstalled('codex', ['', '/no/such/place', dir, ''].join(path.delimiter))).toBe(true);
    expect(commandInstalled('codex', '')).toBe(false);
  });

  const refused: [name: string, command: string][] = [
    ['an empty name', ''],
    // PATH is for bare names, and the callers here pass `claude` and `codex`. A path of its own
    // would be looked up relative to each PATH entry, which answers a question nobody asked.
    ['a relative path', './codex'],
    ['an absolute path', '/usr/local/bin/codex'],
  ];
  for (const [name, command] of refused) {
    it(`says no to ${name}`, () => {
      expect(commandInstalled(command, bin({ codex: 0o755 }))).toBe(false);
    });
  }
});
