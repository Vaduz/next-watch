// The spawn/stop path, against a two-line script in a temp directory rather than a Next.js
// application. What is worth checking here is what a table cannot reach:
//
//   - probing before anything was started must **not** start anything (`--once --dry-run` rests
//     on it),
//   - stopping must take the grandchild with it, because that is the process holding the port,
//   - stopping must **not** take a job the server started in a session of its own with it,
//   - the child's output must reach the log file the access pane reads.
import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChildServer } from './scriptServer.js';
import { isSignalable } from './processes.js';
import { sleep } from '../core/util.js';
import type { Emit } from '../config.js';

/** A server that spawns a child of its own, prints the pid of it, then announces an address in
 *  the shape Next.js uses. Both processes stay up until they are stopped. */
const SERVER = `
import { spawn } from 'node:child_process';
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 3600_000)'], { stdio: 'ignore' });
console.log('grandchild ' + grandchild.pid);
console.log('- Local:        http://localhost:31447');
setInterval(() => {}, 3600_000);
`;

/** The same, plus a job started the way a server starts one for the user: `detached: true`,
 *  which calls `setsid` and so gives it a session of its own. Stopping the server must leave it
 *  and its own child running. */
const SERVER_WITH_JOB = `
import { spawn } from 'node:child_process';
const forever = ['-e', 'setInterval(() => {}, 3600_000)'];
const own = spawn(process.execPath, forever, { stdio: 'ignore' });
const job = spawn(process.execPath, ['-e', \`
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 3600_000)'], { stdio: 'ignore' });
  console.error('jobchild ' + child.pid);
  setInterval(() => {}, 3600_000);
\`], { stdio: ['ignore', 'ignore', 'inherit'], detached: true });
job.unref();
console.log('own ' + own.pid);
console.log('job ' + job.pid);
console.log('- Local:        http://localhost:31447');
setInterval(() => {}, 3600_000);
`;

const dirs: string[] = [];
const servers: ChildServer[] = [];
/** Detached pids a test started. **Killed by pid**, never by a pattern: a `pkill -f` matches the
 *  shell that is running the suite as readily as the job it was aimed at. */
const detached: number[] = [];

function scratch(script: string): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-watch-test-'));
  dirs.push(dir);
  const file = path.join(dir, 'server.mjs');
  fs.writeFileSync(file, script);
  return { dir, file };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.stop(() => undefined);
  }
  for (const pid of detached.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone, which is the ordinary case for the ones a test expected to die */
    }
  }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** The log file, once it holds what is being waited for.
 *
 *  ⚠️ The write stream flushes on its own schedule, so a read taken the moment `start` resolves
 *  can find the file empty. Waiting for the line is the difference between a test that pins the
 *  behaviour and one that fails on a busy machine. */
async function logContaining(file: string, needle: RegExp): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (needle.test(text)) return text;
    await sleep(20);
  }
  throw new Error(`${file} never contained ${needle.source}`);
}

const collect = (): { events: string[]; emit: Emit } => {
  const events: string[] = [];
  return {
    events,
    emit: (mark, text) => {
      events.push(`${mark} ${text}`);
    },
  };
};

/** A server under test. **The timeout is short**: several of these never print an address, and
 *  nothing here should wait twenty seconds to learn that. */
const make = (dir: string, args: readonly string[]): ChildServer => {
  const server = new ChildServer({
    id: 'dev',
    command: process.execPath,
    args: [...args],
    cwd: dir,
    logFile: path.join(dir, 'log', 'dev.txt'),
    mode: 'test',
    readyTimeoutMs: 1_500,
  });
  servers.push(server);
  return server;
};

describe('ChildServer', () => {
  it('probes as down before anything is started, and starts nothing', () => {
    const { dir } = scratch(SERVER);
    const server = make(dir, [path.join(dir, 'server.mjs')]);

    expect(server.row()).toEqual({
      server: 'dev',
      state: 'down',
      url: '-',
      mode: 'test',
      owner: null,
      uptimeSeconds: null,
      logFiles: [path.join(dir, 'log', 'dev.txt')],
    });
    // Nothing was written, because nothing ran.
    expect(fs.existsSync(path.join(dir, 'log'))).toBe(false);
  });

  it('starts, reads the address off the output, and writes the output to the log file', async () => {
    const { dir, file } = scratch(SERVER);
    const server = make(dir, [file]);
    const { events, emit } = collect();

    expect(await server.start(emit)).toBe(true);

    const row = server.row();
    expect(row.state).toBe('up');
    expect(row.url).toBe('http://localhost:31447');
    expect(row.owner).toMatch(/^pid \d+$/);
    expect(events.some(e => e.includes('listening on http://localhost:31447'))).toBe(true);

    await logContaining(path.join(dir, 'log', 'dev.txt'), /- Local: {8}http:\/\/localhost:31447/);

    expect(await server.stop(emit)).toBe(true);
    expect(server.row().state).toBe('down');
  }, 20_000);

  it('stops the grandchild too, because that is what holds the port', async () => {
    const { dir, file } = scratch(SERVER);
    const server = make(dir, [file]);
    const { emit } = collect();

    await server.start(emit);
    // Printed by the script itself: the pid of the process it spawned, which is not the pid
    // next-watch spawned and would survive a stop that only signalled the child.
    const written = await logContaining(path.join(dir, 'log', 'dev.txt'), /grandchild \d+/);
    const grandchild = Number(/grandchild (\d+)/.exec(written)?.[1]);
    expect(grandchild).toBeGreaterThan(0);
    expect(isSignalable(grandchild)).toBe(true);

    expect(await server.stop(emit)).toBe(true);

    expect(isSignalable(grandchild)).toBe(false);
  }, 20_000);

  // ⚠️ **The regression this guards.** A restart once sent SIGTERM to a six-minute job the
  // server had started for the user, because it was a descendant. Parentage is not the question;
  // the session is.
  it('leaves a job the server started in its own session running', async () => {
    const { dir, file } = scratch(SERVER_WITH_JOB);
    const server = make(dir, [file]);
    const { events, emit } = collect();

    await server.start(emit);
    const written = await logContaining(path.join(dir, 'log', 'dev.txt'), /jobchild \d+/);
    const pids = (name: string): number => Number(new RegExp(`${name} (\\d+)`).exec(written)?.[1]);
    const own = pids('own');
    const job = pids('job');
    const jobchild = pids('jobchild');
    detached.push(job, jobchild);
    for (const pid of [own, job, jobchild]) expect(isSignalable(pid)).toBe(true);

    expect(await server.stop(emit)).toBe(true);

    // The server's own child goes, because it is the one that could still hold the port.
    expect(isSignalable(own)).toBe(false);
    // The job does not, and neither does what the job started.
    expect(isSignalable(job)).toBe(true);
    expect(isSignalable(jobchild)).toBe(true);
    // And the log says so, so that a reader wondering why the tree is still there can see it.
    expect(events.some(e => e.startsWith(`info dev: leaving pid ${job} (own session: `))).toBe(true);
    expect(events.some(e => e.includes(`leaving pid ${jobchild}`))).toBe(false);

    // ⚠️ The surviving job holds the stopped server's stderr pipe open, so the server child's
    // `close` arrives whenever the job ends — which is now routinely long after the stop. It
    // must not be reported as a crash of a server nobody is running any more.
    process.kill(job, 'SIGKILL');
    process.kill(jobchild, 'SIGKILL');
    await sleep(300);
    expect(events.filter(e => e.startsWith('error'))).toEqual([]);
  }, 20_000);

  it('reports a command that is not there rather than throwing', async () => {
    const { dir } = scratch(SERVER);
    const server = new ChildServer({
      id: 'dev',
      command: path.join(dir, 'no-such-command'),
      args: [],
      cwd: dir,
      logFile: path.join(dir, 'log', 'dev.txt'),
      readyTimeoutMs: 1_500,
    });
    servers.push(server);
    const { events, emit } = collect();

    expect(await server.start(emit)).toBe(false);
    expect(server.row().state).toBe('down');
    expect(events.some(e => e.startsWith('error dev could not start'))).toBe(true);
  }, 20_000);

  it('reports a server that exits on its own', async () => {
    const { dir, file } = scratch(`console.error('EADDRINUSE: port 3000 is taken'); process.exit(3);`);
    const server = make(dir, [file]);
    const { events, emit } = collect();

    // A start that fails is the case the caller has to be able to act on: it returns false
    // rather than waiting out the timeout and calling a dead server up.
    expect(await server.start(emit)).toBe(false);
    expect(server.row().state).toBe('down');
    expect(events.some(e => e === 'error dev exited with 3')).toBe(true);
  }, 20_000);

  it('reports a server that prints no address at all as up', async () => {
    const { dir, file } = scratch(`setInterval(() => {}, 3600_000);`);
    const server = make(dir, [file]);
    const { emit } = collect();

    // Nothing to parse, so the answer comes from the timeout: a server that says nothing is
    // still a server, and the address column says it is not known.
    expect(await server.start(emit)).toBe(true);
    expect(server.row()).toMatchObject({ state: 'up', url: '-' });
  }, 20_000);

  it('a second start does not spawn a second child', async () => {
    const { dir, file } = scratch(SERVER);
    const server = make(dir, [file]);
    const { events, emit } = collect();

    await server.start(emit);
    const first = server.row().owner;

    expect(await server.start(emit)).toBe(true);
    expect(server.row().owner).toBe(first);
    expect(events.some(e => e === 'info dev is already running')).toBe(true);
  }, 20_000);

  it('stopping something that is not running is not a failure', async () => {
    const { dir } = scratch(SERVER);
    const server = make(dir, [path.join(dir, 'server.mjs')]);
    const { events, emit } = collect();

    expect(await server.stop(emit)).toBe(true);
    expect(events).toEqual(['info dev is not running']);
  });
});
