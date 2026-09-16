// Reading a config file, and the four ways a `servers` entry can be wrong. Each refusal exists
// because the entry reads as if it meant two things, and resolving it either way would leave the
// repository believing the other.
import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './load.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A config file on disk, and its path. The name is unique per call because an ES module is
 *  imported once and cached for the life of the process. */
let nth = 0;
function configFile(body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-watch-load-'));
  dirs.push(dir);
  const file = path.join(dir, `config-${(nth += 1)}.mjs`);
  fs.writeFileSync(file, body);
  return file;
}

const withServers = (servers: string): string =>
  `export default { appName: 'site', pull: { blocked: [] }, servers: ${servers} };\n`;

/** An adapter written out in full, as a string of source. */
const ADAPTER = `{ id: 'web', restartOn: () => true, probe: () => ({}), restart: () => true, stop: () => true, start: () => true }`;

describe('loadConfig, the shape of servers', () => {
  const accepted: [name: string, servers: string, ids: string[]][] = [
    ['a described server', `[{ id: 'web', script: 'dev' }]`, ['web']],
    [
      'a described server with every optional key',
      `[{ id: 'web', script: 'dev', build: 'build', preStart: 'prepare', restartPaths: ['web/'] }]`,
      ['web'],
    ],
    ['an adapter written out', `[${ADAPTER}]`, ['web']],
    // The two forms are not alternatives: a repository with one server it had to write by hand
    // can describe the other three.
    ['both forms in one array', `[${ADAPTER}, { id: 'admin', script: 'start:admin' }]`, ['web', 'admin']],
    ['no servers at all', `[]`, []],
    [
      'a preStart function rather than a script name',
      `[{ id: 'web', script: 'dev', preStart: async () => {} }]`,
      ['web'],
    ],
    ['ignorePaths instead of restartPaths', `[{ id: 'web', script: 'dev', ignorePaths: ['docs/'] }]`, ['web']],
  ];

  for (const [name, servers, ids] of accepted) {
    it(`accepts ${name}`, async () => {
      const config = await loadConfig(configFile(withServers(servers)));
      expect(config.servers.map(s => s.id)).toEqual(ids);
    });
  }

  const refused: [name: string, servers: string, message: RegExp][] = [
    [
      'both `script` and `start`',
      `[{ id: 'web', script: 'dev', start: () => true }]`,
      /server web has both `script` and `start`/,
    ],
    [
      'both path lists, which together say nothing',
      `[{ id: 'web', script: 'dev', restartPaths: ['web/'], ignorePaths: ['docs/'] }]`,
      /server web has both `restartPaths` and `ignorePaths`/,
    ],
    ['neither a script nor the adapter functions', `[{ id: 'web', build: 'build' }]`, /server web needs either/],
    ['no id', `[{ script: 'dev' }]`, /every server needs an id/],
    ['an empty id, which is no id', `[{ id: '', script: 'dev' }]`, /every server needs an id/],
    ['something that is not an object', `['dev']`, /every entry in servers must be an object/],
  ];

  for (const [name, servers, message] of refused) {
    it(`refuses ${name}`, async () => {
      const file = configFile(withServers(servers));
      const thrown = await loadConfig(file).then(
        () => null,
        (e: unknown) => (e instanceof Error ? e.message : JSON.stringify(e)),
      );
      if (thrown === null) throw new Error(`${file} was accepted, and should not have been`);
      expect(thrown).toMatch(message);
      // The path comes first in every message, because the commonest failure is having run
      // from the wrong directory.
      expect(thrown.startsWith(file)).toBe(true);
    });
  }
});

// The schedule is checked while the file's path is still in hand. `buildProviders` checks it
// too, but from there the only name it can give is the key, and a mistyped time is a typing
// mistake whose answer is the file it is in.
describe('loadConfig, the quota-session schedule', () => {
  const withProviders = (providers: string): string =>
    `export default { appName: 'site', pull: { blocked: [] }, servers: [], providers: ${providers} };\n`;

  const accepted: [name: string, providers: string][] = [
    ['no providers at all', `undefined`],
    ['the automatic mode', `{ quotaSession: true }`],
    ['a schedule', `{ quotaSession: { at: ['09:00', '14:00'] } }`],
    ['a schedule and a sandbox together', `{ quotaSession: { cwd: '/tmp/box', at: ['09:00'] } }`],
  ];
  for (const [name, providers] of accepted) {
    it(`accepts ${name}`, async () => {
      await loadConfig(configFile(withProviders(providers)));
    });
  }

  const refused: [name: string, providers: string, message: RegExp][] = [
    ['a single-digit hour', `{ quotaSession: { at: ['9:00'] } }`, /is not a time/],
    ['an hour that does not exist', `{ quotaSession: { at: ['24:00'] } }`, /is not a time/],
    ['a duplicate', `{ quotaSession: { at: ['09:00', '09:00'] } }`, /listed twice/],
    ['an empty list, which says nothing at all', `{ quotaSession: { at: [] } }`, /at least one time/],
    ['a string where a list belongs', `{ quotaSession: { at: '09:00' } }`, /must be an array of times/],
  ];
  for (const [name, providers, message] of refused) {
    it(`refuses ${name}`, async () => {
      const file = configFile(withProviders(providers));
      const thrown = await loadConfig(file).then(
        () => null,
        (e: unknown) => (e instanceof Error ? e.message : JSON.stringify(e)),
      );
      if (thrown === null) throw new Error(`${file} was accepted, and should not have been`);
      expect(thrown).toMatch(message);
      expect(thrown.startsWith(file)).toBe(true);
    });
  }
});
