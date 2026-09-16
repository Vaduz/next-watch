// Sending the message that opens a window. Nothing here runs the real agent CLIs: a stub of the
// right name is put on `PATH`, so what is checked is the boundary — the command that is built,
// and that a failure becomes one line rather than an exception.
import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quotaSessionCommand, startQuotaSession } from './quota.js';

const dirs: string[] = [];
const realPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = realPath;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Put a stub of `name` at the front of `PATH`, and return a directory to run in. */
function stub(name: string, script: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-watch-quota-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  process.env.PATH = [dir, realPath].join(path.delimiter);
  return path.join(dir, 'sandbox');
}

/** Run one send and collect what it said. */
async function send(cli: 'claude' | 'codex', cwd: string): Promise<string[]> {
  const said: string[] = [];
  await startQuotaSession(cli, cwd, (mark, text) => said.push(`${mark} ${text}`));
  return said;
}

describe('quotaSessionCommand', () => {
  const cases: [cli: 'claude' | 'codex', want: string][] = [
    ['claude', 'claude -p "hi"'],
    // `codex exec` is how Codex is given one message with nobody at a terminal, and the flag is
    // what lets it run in a sandbox that is deliberately not a git repository.
    ['codex', 'codex exec --skip-git-repo-check "hi"'],
  ];
  for (const [cli, want] of cases) {
    it(`${cli} is sent as ${want}`, () => {
      expect(quotaSessionCommand(cli)).toBe(want);
    });
  }
});

describe('startQuotaSession', () => {
  it('runs the CLI in the sandbox, making it if it is not there yet', async () => {
    const cwd = stub('codex', 'pwd');

    const said = await send('codex', cwd);

    expect(fs.existsSync(cwd)).toBe(true);
    expect(said.some(l => l.startsWith('step codex exec --skip-git-repo-check "hi" done'))).toBe(true);
  });

  // ⚠️ The argument list itself, read back from a stub that writes what it was given. Codex
  // 0.154.0 exits 1 in a tenth of a second without the flag, because the sandbox is deliberately
  // not a git repository, and the log line alone would not have caught its absence.
  it('gives Codex the flag that lets it run outside a repository, with the prompt last', async () => {
    const cwd = stub('codex', 'printf "%s\\n" "$@" > "$(dirname "$0")/argv.txt"');

    await send('codex', cwd);

    const argv = fs
      .readFileSync(path.join(path.dirname(cwd), 'argv.txt'), 'utf8')
      .trimEnd()
      .split('\n');
    expect(argv).toEqual(['exec', '--skip-git-repo-check', 'hi']);
  });

  it('gives Claude the prompt through -p, and nothing else', async () => {
    const cwd = stub('claude', 'printf "%s\\n" "$@" > "$(dirname "$0")/argv.txt"');

    await send('claude', cwd);

    const argv = fs
      .readFileSync(path.join(path.dirname(cwd), 'argv.txt'), 'utf8')
      .trimEnd()
      .split('\n');
    expect(argv).toEqual(['-p', 'hi']);
  });

  // Codex says `Reading additional input from stdin...` and then reaches end of file at once,
  // because `streamCommand` gives every child `'ignore'` for stdin. A child that could wait on
  // a terminal that is not there would hang until the two-minute timeout.
  it('gives the CLI no stdin to wait on', async () => {
    const cwd = stub('codex', 'cat > "$(dirname "$0")/stdin.txt"; exit 0');

    const said = await send('codex', cwd);

    expect(fs.readFileSync(path.join(path.dirname(cwd), 'stdin.txt'), 'utf8')).toBe('');
    expect(said.some(l => l.includes('done'))).toBe(true);
  });

  // ⚠️ One line, and no exception. The watch carries on, and nothing is retried until the next
  // decision says to — which is what keeps a broken CLI from being run once a second.
  it('turns a non-zero exit into one line', async () => {
    const cwd = stub('codex', 'echo "not logged in" >&2\nexit 3');

    const said = await send('codex', cwd);

    const failures = said.filter(l => l.startsWith('error codex exec --skip-git-repo-check "hi" failed'));
    expect(failures).toHaveLength(1);
  });

  it('turns a command that is not there into one line as well', async () => {
    const cwd = stub('claude', 'exit 0');
    // The stub is named `claude`, so `codex` is genuinely missing from this PATH.
    process.env.PATH = path.dirname(cwd);

    const said = await send('codex', cwd);

    expect(said.filter(l => l.startsWith('error codex exec --skip-git-repo-check "hi" failed'))).toHaveLength(1);
  });
});
