// The install that follows a dependency change. `RunCommand` is injected so a test can watch
// what would have run, which is the only way to pin **which package manager** is used without
// installing anything.
import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPlan } from './apply.js';
import { resolveConfig } from '../config.js';
import type { WatchPlan } from '../core/plan.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A checkout holding these files and nothing else. */
function checkout(...files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-watch-install-'));
  dirs.push(dir);
  for (const name of files) fs.writeFileSync(path.join(dir, name), '');
  return dir;
}

const INSTALLING: WatchPlan = { blockers: [], install: true, restart: [] };

/** Run the plan against a `run` that installs nothing, and return what it was asked to run. */
async function commandsFor(root: string, plan: WatchPlan = INSTALLING): Promise<string[]> {
  const ran: string[] = [];
  const config = resolveConfig({ appName: 'site', root, pull: { blocked: [] }, servers: [] });
  await applyPlan(
    config,
    plan,
    () => undefined,
    o => {
      ran.push([o.command, ...o.args].join(' '));
      return Promise.resolve({ ok: true, detail: null });
    },
  );
  return ran;
}

describe('applyPlan, the install', () => {
  // ⚠️ The bug this table exists for: every one of these used to run `npm install`. In a bun,
  // pnpm or yarn checkout npm ignores the lockfile that is there, can write a
  // `package-lock.json` of its own into the tree, and leaves `node_modules` out of step with
  // what the lockfile pins.
  const cases: [name: string, files: string[], expected: string][] = [
    ['npm', ['package-lock.json'], 'npm install'],
    ['bun', ['bun.lock'], 'bun install'],
    ['bun, binary lockfile', ['bun.lockb'], 'bun install'],
    ['pnpm', ['pnpm-lock.yaml'], 'pnpm install'],
    ['yarn', ['yarn.lock'], 'yarn install'],
    ['no lockfile at all', ['package.json'], 'npm install'],
    ['bun beside a leftover package-lock.json', ['bun.lock', 'package-lock.json'], 'bun install'],
  ];

  for (const [name, files, expected] of cases) {
    it(name, async () => {
      expect(await commandsFor(checkout(...files))).toEqual([expected]);
    });
  }

  it('installs nothing when the plan does not call for it', async () => {
    expect(await commandsFor(checkout('bun.lock'), { blockers: [], install: false, restart: [] })).toEqual([]);
  });

  it('reads the lockfile that is there now, not the one that was there at startup', async () => {
    // The pull that migrates a repository from npm to bun is exactly the pull that triggers an
    // install. A manager read once when the watch started would still say npm.
    const root = checkout('package-lock.json');
    expect(await commandsFor(root)).toEqual(['npm install']);

    fs.rmSync(path.join(root, 'package-lock.json'));
    fs.writeFileSync(path.join(root, 'bun.lock'), '');

    expect(await commandsFor(root)).toEqual(['bun install']);
  });
});
