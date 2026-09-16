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
    // `codex exec` is how Codex is given one message with nobody at a terminal.
    ['codex', 'codex exec "hi"'],
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
    expect(said.some(l => l.startsWith('step codex exec "hi" done'))).toBe(true);
  });

  // ⚠️ One line, and no exception. The watch carries on, and nothing is retried until the next
  // decision says to — which is what keeps a broken CLI from being run once a second.
  it('turns a non-zero exit into one line', async () => {
    const cwd = stub('codex', 'echo "not logged in" >&2\nexit 3');

    const said = await send('codex', cwd);

    const failures = said.filter(l => l.startsWith('error codex exec "hi" failed'));
    expect(failures).toHaveLength(1);
  });

  it('turns a command that is not there into one line as well', async () => {
    const cwd = stub('claude', 'exit 0');
    // The stub is named `claude`, so `codex` is genuinely missing from this PATH.
    process.env.PATH = path.dirname(cwd);

    const said = await send('codex', cwd);

    expect(said.filter(l => l.startsWith('error codex exec "hi" failed'))).toHaveLength(1);
  });
});
