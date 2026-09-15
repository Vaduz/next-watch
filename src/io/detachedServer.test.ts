// A server that outlives the watch, and the adoption that makes that useful. What cannot be
// checked as a table is the part that matters: a process started by one run of this code being
// picked up by another, and not being picked up when it is somebody else's.
import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DetachedServer } from './detachedServer.js';
import { pidFilePath, readPidFile, writePidFile } from './pidFile.js';
import { isSignalable, killAll, psSnapshot } from './processes.js';
import { sleep } from '../core/util.js';
import type { Emit } from '../config.js';

/** A server that announces itself the way Next.js does and then stays up. */
const SERVER = `
console.log('  - Local:        http://localhost:31777');
setInterval(() => {}, 3600_000);
`;

const dirs: string[] = [];

/** ⚠️ **Whatever a test started has to die here.** These processes are detached on purpose, so
 *  nothing else is going to clean them up: a test that failed halfway would otherwise leave one
 *  running until the machine is rebooted.
 *
 *  The sweep is by **command line, not by pid file**, precisely because the pid file is one of
 *  the things under test — a bug that makes adoption fail spawns a second server and leaves the
 *  first one unnamed by any file. Asking the process table instead finds both. */
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    const mine = psSnapshot().procs.filter(p => p.command.includes(dir));
    if (mine.length > 0) await killAll(mine.map(p => p.pid));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function project(): { dir: string; logDir: string; script: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'next-watch-detached-')));
  dirs.push(dir);
  const script = path.join(dir, 'server.mjs');
  fs.writeFileSync(script, SERVER);
  return { dir, logDir: path.join(dir, 'log'), script };
}

/** A fresh handle onto the same project — which is what a *later watch* is. */
const serverFor = (o: { dir: string; logDir: string; script: string }): DetachedServer =>
  new DetachedServer({
    id: 'web',
    command: process.execPath,
    args: [o.script],
    cwd: o.dir,
    logFile: path.join(o.logDir, 'web.txt'),
    logDir: o.logDir,
    // What `isOurs` looks for in the command line. Here the command is `<node> <path>/server.mjs`
    // rather than `<pm> run dev`, and the file name is the part of it that is stable.
    script: path.basename(o.script),
  });

const collect = (): { events: string[]; emit: Emit } => {
  const events: string[] = [];
  return {
    events,
    emit: (mark, text) => {
      events.push(`${mark} ${text}`);
    },
  };
};

/** Wait until the server has written its address into the log. */
async function ready(server: DetachedServer): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (server.row().url !== '-') return;
    await sleep(20);
  }
  throw new Error('the detached server never printed its address');
}

describe('DetachedServer', () => {
  it('is down, and starts nothing, before anything has run', () => {
    const p = project();

    expect(serverFor(p).row()).toMatchObject({ server: 'web', state: 'down', url: '-', owner: null });
    expect(fs.existsSync(p.logDir)).toBe(false);
  });

  it('starts, leaves a pid file, and reads its address back out of the log', async () => {
    const p = project();
    const server = serverFor(p);
    const { events, emit } = collect();

    expect(await server.start(emit)).toBe(true);
    await ready(server);

    const note = readPidFile(pidFilePath(p.logDir, 'web'));
    expect(note?.script).toBe('server.mjs');
    expect(isSignalable(note?.pid ?? 0)).toBe(true);
    expect(server.row()).toMatchObject({ state: 'up', url: 'http://localhost:31777', owner: `pid ${note?.pid ?? 0}` });
    // The event log has to say that this one is not going to be cleaned up on the way out.
    expect(events.some(e => e.includes('will outlive this watch'))).toBe(true);
  }, 20_000);

  // The point of the whole file: the watch that started it is gone, and the next one picks it up
  // rather than starting a second server onto a port that is already taken.
  it('a later watch adopts it instead of starting another', async () => {
    const p = project();
    await serverFor(p).start(() => undefined);
    const first = readPidFile(pidFilePath(p.logDir, 'web'));

    const later = serverFor(p);
    await ready(later);
    const { events, emit } = collect();

    expect(later.adopted()).toBe(true);
    expect(await later.start(emit)).toBe(true);

    expect(readPidFile(pidFilePath(p.logDir, 'web'))?.pid).toBe(first?.pid ?? 0);
    expect(events.some(e => e.includes('already running detached'))).toBe(true);
    expect(later.row()).toMatchObject({ state: 'up', url: 'http://localhost:31777' });
  }, 20_000);

  it('stops it and takes the pid file away', async () => {
    const p = project();
    const server = serverFor(p);
    await server.start(() => undefined);
    await ready(server);
    const note = readPidFile(pidFilePath(p.logDir, 'web'));

    expect(await serverFor(p).stop(() => undefined)).toBe(true);

    expect(isSignalable(note?.pid ?? 0)).toBe(false);
    expect(fs.existsSync(pidFilePath(p.logDir, 'web'))).toBe(false);
    expect(serverFor(p).row().state).toBe('down');
  }, 20_000);

  // ⚠️ The check that keeps this from signalling a stranger. A pid file outlives the process it
  // names, and the operating system hands that number to somebody else.
  const strangers: [name: string, note: (pid: number) => Parameters<typeof writePidFile>[1]][] = [
    [
      'a pid that is not running anything of ours',
      pid => ({ pid, script: 'not-our-script', startedAt: 0, startTicks: null }),
    ],
    [
      'a pid whose start time is not the one recorded',
      pid => ({ pid, script: 'server.mjs', startedAt: 0, startTicks: '1' }),
    ],
    [
      'a pid that is not there at all',
      () => ({ pid: 2147483646, script: 'server.mjs', startedAt: 0, startTicks: null }),
    ],
  ];

  for (const [name, note] of strangers) {
    it(`does not adopt ${name}`, () => {
      const p = project();
      writePidFile(pidFilePath(p.logDir, 'web'), note(process.pid));

      expect(serverFor(p).adopted()).toBe(false);
      // The stale note is taken away as it is read, so every later probe does not repeat this.
      expect(fs.existsSync(pidFilePath(p.logDir, 'web'))).toBe(false);
    });
  }

  it('treats a pid file it cannot parse as no pid file', () => {
    const p = project();
    const file = pidFilePath(p.logDir, 'web');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'half a fi');

    expect(readPidFile(file)).toBeNull();
    expect(serverFor(p).adopted()).toBe(false);
  });

  // ⚠️ There is no child handle to hear an exit on, so without the settle wait a server that
  // died on a taken port would be reported started and the row would go quiet a second later.
  it('reports a server that exits the moment it starts', async () => {
    const p = project();
    fs.writeFileSync(p.script, `process.exit(1);\n`);
    const { events, emit } = collect();

    expect(await serverFor(p).start(emit)).toBe(false);

    expect(serverFor(p).row().state).toBe('down');
    expect(events.some(e => e.startsWith('error web exited right after starting'))).toBe(true);
    expect(fs.existsSync(pidFilePath(p.logDir, 'web'))).toBe(false);
  }, 20_000);

  it('stopping something that is not running is not a failure', async () => {
    const { events, emit } = collect();

    expect(await serverFor(project()).stop(emit)).toBe(true);
    expect(events).toEqual(['info web is not running']);
  });
});
