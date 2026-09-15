// Turning a described server into an adapter. What is worth pinning is the part a repository
// writes and then trusts: which incoming paths restart it, and what a restart is going to do.
import { describe, expect, it } from 'bun:test';
import { scriptAdapter, type ScriptServerContext } from './scriptServer.js';
import type { ScriptServerEntry } from '../config.js';

const CONTEXT: ScriptServerContext = { manager: 'bun', root: '/repo', logDir: '/repo/log' };

const adapterFor = (entry: Omit<ScriptServerEntry, 'id'>): ReturnType<typeof scriptAdapter> =>
  scriptAdapter({ id: 'web', ...entry }, CONTEXT);

describe('scriptAdapter, the restart rule', () => {
  // The three shapes that survive validation. `restartPaths` and `ignorePaths` together are
  // refused in `load.ts`, so there is no fourth.
  const cases: [name: string, entry: Omit<ScriptServerEntry, 'id'>, paths: string[], restarts: boolean][] = [
    [
      'restartPaths, a path under a listed prefix',
      { script: 'dev', restartPaths: ['web/', 'lib/'] },
      ['web/a.tsx'],
      true,
    ],
    ['restartPaths, nothing listed', { script: 'dev', restartPaths: ['web/'] }, ['admin/a.tsx'], false],
    // The prefix is what makes a directory usable in a hand-written list.
    ['restartPaths, a whole file name', { script: 'dev', restartPaths: ['package.json'] }, ['package.json'], true],
    ['ignorePaths, something outside them', { script: 'dev', ignorePaths: ['docs/'] }, ['lib/a.ts'], true],
    ['ignorePaths, something inside them', { script: 'dev', ignorePaths: ['docs/'] }, ['docs/a.md'], false],
    // `restartUnless` exempts these whatever the list says; `restartIfPrefixed` does not.
    ['ignorePaths, a root document', { script: 'dev', ignorePaths: ['docs/'] }, ['README.md'], false],
    [
      'restartPaths, a root document that was named',
      { script: 'dev', restartPaths: ['README.md'] },
      ['README.md'],
      true,
    ],
    // Neither list keeps what `--start dev` has always done: restart for anything that reaches a
    // build, because a flag cannot say which paths a script's output depends on.
    ['neither list, an ordinary file', { script: 'dev' }, ['lib/a.ts'], true],
    ['neither list, a test file', { script: 'dev' }, ['lib/a.test.ts'], false],
  ];

  for (const [name, entry, paths, restarts] of cases) {
    it(name, () => {
      expect(adapterFor(entry).restartOn(paths)).toBe(restarts);
    });
  }
});

describe('scriptAdapter, what a restart will do', () => {
  // `--dry-run` prints this, so it has to be the real order: everything that can fail happens
  // before the stop, which is what leaves something running when it does.
  const cases: [name: string, entry: Omit<ScriptServerEntry, 'id'>, steps: string[]][] = [
    ['a bare script', { script: 'dev' }, ['stop', 'start (dev)']],
    ['with a build', { script: 'start', build: 'build' }, ['build (build)', 'stop', 'start (start)']],
    [
      'with a named preStart',
      { script: 'start', build: 'build', preStart: 'prepare:web' },
      ['build (build)', 'preStart (prepare:web)', 'stop', 'start (start)'],
    ],
    // A function has no name worth printing, but that it runs at all is the part a reader needs.
    [
      'with a preStart function',
      { script: 'dev', preStart: () => Promise.resolve() },
      ['preStart', 'stop', 'start (dev)'],
    ],
  ];

  for (const [name, entry, steps] of cases) {
    it(name, () => {
      expect(adapterFor(entry).describeRestart?.()).toEqual(steps);
    });
  }
});

/** A restart driven against a fake runner, returning the order things actually happened in.
 *
 *  Nothing is spawned: the scripts go through the injected `run`, and the server itself is never
 *  started, so `stop` finds nothing running and says so. What is being pinned is the **order**,
 *  which is the whole of what this adapter decides. */
async function orderOf(entry: Omit<ScriptServerEntry, 'id'>, o: { buildFails?: boolean } = {}): Promise<string[]> {
  const steps: string[] = [];
  const adapter = scriptAdapter(
    { id: 'web', ...entry },
    {
      ...CONTEXT,
      run: r => {
        const script = r.args[1];
        steps.push(`run ${script}`);
        return Promise.resolve(
          o.buildFails === true && script === entry.build
            ? { ok: false, detail: 'exited with 1' }
            : { ok: true, detail: null },
        );
      },
    },
  );
  await adapter.restart(mark => {
    if (mark === 'info') steps.push('stop (nothing was running)');
  });
  return steps;
}

describe('scriptAdapter, the order a restart takes', () => {
  // ⚠️ The reason the order is what it is: everything that can fail runs **before** the stop, so
  // a failure leaves the old server serving rather than leaving nothing at all.
  it('builds and prepares before it stops anything', async () => {
    expect(await orderOf({ script: 'start', build: 'build', preStart: 'prepare' })).toEqual([
      'run build',
      'run prepare',
      'stop (nothing was running)',
    ]);
  });

  it('prepares even when there is nothing to build', async () => {
    expect(await orderOf({ script: 'dev', preStart: 'prepare' })).toEqual([
      'run prepare',
      'stop (nothing was running)',
    ]);
  });

  it('does not prepare when the build failed, and does not stop either', async () => {
    // A build that failed means the new code is not there to prepare for, and the server that is
    // running is serving the old code that does work.
    expect(await orderOf({ script: 'start', build: 'build', preStart: 'prepare' }, { buildFails: true })).toEqual([
      'run build',
    ]);
  });

  it('does not stop when the preparation failed', async () => {
    const steps: string[] = [];
    const adapter = scriptAdapter(
      { id: 'web', script: 'dev', preStart: () => Promise.reject(new Error('no assets')) },
      { ...CONTEXT, run: () => Promise.resolve({ ok: true, detail: null }) },
    );
    const emits: string[] = [];

    const up = await adapter.restart((mark, text) => {
      emits.push(`${mark} ${text}`);
      if (mark === 'info') steps.push('stop');
    });

    expect(steps).toEqual([]);
    expect(up).toBe(false);
    expect(emits.some(e => e.startsWith('error web: preStart failed (no assets)'))).toBe(true);
  });

  it('runs the preparation before a plain start too', async () => {
    const steps: string[] = [];
    const adapter = scriptAdapter(
      { id: 'web', script: 'dev', preStart: 'prepare' },
      {
        ...CONTEXT,
        run: r => {
          steps.push(`run ${r.args[1]}`);
          return Promise.resolve({ ok: false, detail: 'stop here' });
        },
      },
    );

    // The preparation failed, so the start never happens — which is also how this test avoids
    // spawning anything.
    expect(await adapter.start(() => undefined)).toBe(false);
    expect(steps).toEqual(['run prepare']);
  });
});

describe('scriptAdapter, the row it probes', () => {
  it('reads as down, and starts nothing, before anything has run', async () => {
    const row = await adapterFor({ script: 'dev' }).probe();

    expect(row).toEqual({
      server: 'web',
      state: 'down',
      url: '-',
      mode: 'bun',
      owner: null,
      uptimeSeconds: null,
      logFiles: ['/repo/log/web.txt'],
    });
  });

  it('takes the label the entry gave it', () => {
    expect(scriptAdapter({ id: 'web', script: 'dev', label: 'the site' }, CONTEXT).label).toBe('the site');
  });
});
