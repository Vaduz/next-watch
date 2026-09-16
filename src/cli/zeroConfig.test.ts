// Putting a run together from a config file, from the flags, or from both. What is checked is
// the part a person meets on their first run: the defaults that get derived, and the three ways
// of asking for something that cannot be done, each of which has to say what to do instead.
import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from './args.js';
import { configFor } from './zeroConfig.js';

const dirs: string[] = [];
const cwd = process.cwd();

afterEach(() => {
  process.chdir(cwd);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A project on disk, and the working directory moved into it — the flags are read relative to
 *  wherever next-watch was run, so that is what has to be arranged. */
function project(files: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'next-watch-zero-')));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  process.chdir(dir);
  return dir;
}

const run = (argv: string[]): ReturnType<typeof configFor> => configFor(parseArgs({}, argv));

/** A config file with one server of its own, to check that the two sources are added together
 *  rather than one replacing the other. */
const CONFIG_FILE = `export default {
  appName: 'written-down',
  branch: 'release',
  pull: { blocked: [{ prefix: 'db/', reason: 'this machine owns it' }] },
  servers: [{ id: 'web', restartOn: () => true, probe: () => ({}), restart: () => true, stop: () => true, start: () => true }],
  providers: { quota: true },
};
`;

/** A config file whose server is described rather than written out. */
const SCRIPT_CONFIG_FILE = `export default {
  appName: 'described',
  pull: { blocked: [] },
  servers: [{ id: 'web', script: 'dev:web' }],
};
`;

describe('configFor, with no config file', () => {
  it('derives everything it needs from the directory', async () => {
    const dir = project({ 'package.json': '{"name":"@acme/site"}', 'bun.lock': '' });

    const config = await run(['--start', 'dev']);

    // The scope would otherwise put a separator into `join(tmpdir(), appName)`.
    expect(config.appName).toBe('acme-site');
    expect(config.root).toBe(dir);
    expect(config.branch).toBe('main');
    // Nothing is blocked, because nothing here knows what this checkout is the one that writes.
    expect(config.pull.blocked).toEqual([]);
    // The lockfile that is actually there, and only that one.
    expect(config.pull.dependencyPaths).toEqual(['package.json', 'bun.lock']);
    expect(config.servers.map(s => s.id)).toEqual(['dev']);
  });

  it('falls back to the directory name when there is no package.json', async () => {
    const dir = project({});

    const config = await run(['--start', 'dev']);

    expect(config.appName).toBe(path.basename(dir));
    expect(config.pull.dependencyPaths).toEqual(['package.json']);
  });

  it('draws every section, and leaves the one that spends something off', async () => {
    project({ 'package.json': '{"name":"site"}' });

    expect((await run(['--start', 'dev'])).providers).toEqual({
      agentSessions: true,
      quota: true,
      quotaSession: false,
      services: true,
      tools: true,
      sshAgent: true,
    });
    expect((await run(['--start', 'dev', '--quota-session'])).providers?.quotaSession).toBe(true);
  });

  it('turns named times into the schedule, with no --quota-session beside them', async () => {
    project({ 'package.json': '{"name":"site"}' });

    const config = await run(['--start', 'dev', '--quota-session-at', '09:00,14:00']);

    expect(config.providers?.quotaSession).toEqual({ at: ['09:00', '14:00'] });
  });

  it('keeps the scripts in the order they were named', async () => {
    project({ 'package.json': '{"name":"site"}' });

    expect((await run(['--start', 'web', '--start', 'admin'])).servers.map(s => s.id)).toEqual(['web', 'admin']);
  });

  it('describes the server rather than building it, and spawns nothing', async () => {
    project({ 'package.json': '{"name":"site"}' });

    const config = await run(['--start', 'dev']);

    // `--start dev` is exactly the entry a config file could have written by hand. Nothing is
    // spawned by assembling a run — `--once --dry-run --start dev` rests on that.
    expect(config.servers).toEqual([{ id: 'dev', script: 'dev', build: undefined }]);
  });

  it('gives --build to the servers named on the command line', async () => {
    project({ 'package.json': '{"name":"site"}' });

    expect((await run(['--start', 'start', '--build', 'build'])).servers).toEqual([
      { id: 'start', script: 'start', build: 'build' },
    ]);
  });
});

describe('configFor, with a config file', () => {
  it('appends the named scripts to the servers the file already has', async () => {
    project({ 'package.json': '{"name":"site"}', 'next-watch.config.mjs': CONFIG_FILE });

    const config = await run(['--start', 'dev']);

    // The file decides everything it speaks about; the flag only adds a server.
    expect(config.appName).toBe('written-down');
    expect(config.branch).toBe('release');
    expect(config.pull.blocked).toEqual([{ prefix: 'db/', reason: 'this machine owns it' }]);
    expect(config.providers).toEqual({ quota: true });
    expect(config.servers.map(s => s.id)).toEqual(['web', 'dev']);
  });

  it('leaves the file alone when no script was named', async () => {
    project({ 'package.json': '{"name":"site"}', 'next-watch.config.mjs': CONFIG_FILE });

    expect((await run([])).servers.map(s => s.id)).toEqual(['web']);
  });

  // ⚠️ `--build` is the command line's own. A file's entries carry their own `build`, and a flag
  // that quietly built for them would change what the file says without the file changing.
  it('does not give --build to the servers the file declared', async () => {
    project({ 'package.json': '{"name":"site"}', 'next-watch.config.mjs': SCRIPT_CONFIG_FILE });

    const servers = (await run(['--start', 'dev', '--build', 'build'])).servers;

    expect(servers).toEqual([
      { id: 'web', script: 'dev:web' },
      { id: 'dev', script: 'dev', build: 'build' },
    ]);
  });
});

/** What `configFor` refused with, as a value.
 *
 *  ⚠️ The refusal is **awaited here** rather than left to a matcher. `afterEach` removes the
 *  directory the call is still reading, so an assertion the test did not wait for would race
 *  the cleanup; and a run that wrongly succeeded has to fail this test rather than pass it
 *  quietly, which is what the explicit throw below is for. */
async function refusal(argv: string[]): Promise<string> {
  const thrown = await run(argv).then(
    () => null,
    (e: unknown) => e,
  );
  if (thrown === null) throw new Error(`next-watch ${argv.join(' ')} was accepted, and should not have been`);
  return thrown instanceof Error ? thrown.message : JSON.stringify(thrown);
}

describe('configFor, what it refuses', () => {
  it('will not put two servers under one id', async () => {
    project({ 'package.json': '{"name":"site"}', 'next-watch.config.mjs': CONFIG_FILE });

    // One id is one pane, one target under the cursor and one entry in the plan. Picking
    // either one silently would leave the other unreachable.
    expect(await refusal(['--start', 'web'])).toMatch(/already has a server with that id/);
  });

  it('will not take a build script with nothing to build for', async () => {
    project({ 'package.json': '{"name":"site"}' });

    expect(await refusal(['--build', 'build'])).toMatch(/--build applies to the servers named by --start/);
  });

  it('says both ways out when there is no file and no script', async () => {
    project({ 'package.json': '{"name":"site"}' });

    // The commonest cause is being in the wrong directory, and which remedy is wanted depends
    // on the repository, so the message names both.
    expect(await refusal([])).toMatch(/--start dev[\s\S]*--config/);
  });
});
