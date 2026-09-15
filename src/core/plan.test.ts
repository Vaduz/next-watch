// The mechanism, not any one repository's rules. Which paths a repository blocks and which of
// them mean a rebuild belong to its own config, and are tested there. What is checked here is
// that the policy and the servers this is given are honoured.
import { describe, expect, it } from 'bun:test';
import {
  conflictingDirtyPaths,
  describePlan,
  hooksToRun,
  planFromIncoming,
  restartIfAny,
  restartUnless,
  runIfAny,
  type AfterPullHook,
  type PullPolicy,
  type WatchPlan,
  type WatchServerPolicy,
} from './plan.js';

const POLICY: PullPolicy = {
  blocked: [
    { prefix: 'data/db.sqlite3', reason: 'the database came from the remote' },
    { prefix: 'data/images/', reason: 'the images move with the database' },
  ],
  dependencyPaths: ['package.json', 'package-lock.json'],
};

/** Two servers with the two shapes that exist: one that rebuilds for almost anything, and a
 *  dev server that only needs its build configuration. */
const SERVERS: WatchServerPolicy[] = [
  { id: 'admin', restartOn: restartUnless(['web/', 'docs/', 'scripts/']) },
  { id: 'web', restartOn: restartIfAny(['web/next.config.ts', 'web/tsconfig.json']) },
];

const plan = (paths: readonly string[]): WatchPlan => planFromIncoming(paths, POLICY, SERVERS);

describe('planFromIncoming', () => {
  const cases: { name: string; paths: string[]; blocked: boolean; restart: string[]; install: boolean }[] = [
    {
      name: 'stops on a blocked path',
      paths: ['data/db.sqlite3'],
      blocked: true,
      restart: [],
      install: false,
    },
    {
      name: 'stops on a blocked prefix, not just an exact path',
      paths: ['data/images/801.jpg'],
      blocked: true,
      restart: [],
      install: false,
    },
    {
      name: 'stops even when the blocked path arrives among ordinary code',
      paths: ['lib/service/thing.ts', 'data/db.sqlite3'],
      blocked: true,
      restart: [],
      install: false,
    },
    {
      name: 'does not stop on a path that merely looks similar',
      paths: ['data/seeds/media.sql'],
      blocked: false,
      restart: ['admin'],
      install: false,
    },
    {
      name: 'restarts the server whose rule matches',
      paths: ['admin/app/page.tsx'],
      blocked: false,
      restart: ['admin'],
      install: false,
    },
    {
      name: 'restarts nothing for paths every rule ignores',
      paths: ['web/app/page.tsx', 'web/components/Article.tsx'],
      blocked: false,
      restart: [],
      install: false,
    },
    {
      name: 'restarts only the server that asked for that exact path',
      paths: ['web/next.config.ts'],
      blocked: false,
      restart: ['web'],
      install: false,
    },
    {
      name: 'installs and restarts everything when the dependencies move',
      paths: ['package.json', 'package-lock.json'],
      blocked: false,
      restart: ['admin', 'web'],
      install: true,
    },
    {
      name: 'ignores documents at the root and under an ignored directory',
      paths: ['AGENTS.md', 'docs/development.md'],
      blocked: false,
      restart: [],
      install: false,
    },
    {
      name: 'ignores test-only files, which reach no build',
      paths: ['lib/service/thing.test.ts', 'src/core/plan.test.ts'],
      blocked: false,
      restart: [],
      install: false,
    },
    {
      name: 'falls on the restarting side for an unfamiliar path',
      paths: ['newdir/thing.ts'],
      blocked: false,
      restart: ['admin'],
      install: false,
    },
    {
      name: 'does nothing when nothing changed',
      paths: [],
      blocked: false,
      restart: [],
      install: false,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = plan(c.paths);
      expect(result.blockers.length > 0).toBe(c.blocked);
      expect(result.restart).toEqual(c.restart);
      expect(result.install).toBe(c.install);
    });
  }

  it('names the path that triggered a blocker and why', () => {
    const { blockers } = plan(['data/db.sqlite3']);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.path).toBe('data/db.sqlite3');
    expect(blockers[0]?.reason).toContain('database');
  });

  // Not pulling and then restarting would build from the old code and take down a running
  // server, so no field is left set for a caller to misread.
  it('leaves install and restart empty whenever anything is blocked', () => {
    const result = planFromIncoming(['package.json', 'data/db.sqlite3'], POLICY, SERVERS);
    expect(result.install).toBe(false);
    expect(result.restart).toEqual([]);
  });

  it('restarts in the order the servers were given', () => {
    const reversed = [...SERVERS].reverse();
    expect(planFromIncoming(['package.json'], POLICY, reversed).restart).toEqual(['web', 'admin']);
  });

  it('works with no servers at all, and with no dependency paths', () => {
    expect(planFromIncoming(['anything.ts'], { blocked: [] }, []).restart).toEqual([]);
    expect(planFromIncoming(['package.json'], { blocked: [] }, SERVERS).install).toBe(false);
  });

  it('restarts every server for a dependency change, however many there are', () => {
    const many: WatchServerPolicy[] = ['a', 'b', 'c'].map(id => ({ id, restartOn: () => false }));
    expect(planFromIncoming(['package.json'], POLICY, many).restart).toEqual(['a', 'b', 'c']);
  });
});

describe('restartUnless', () => {
  const rule = restartUnless(['web/', 'docs/']);

  it('restarts for anything outside the listed prefixes', () => {
    expect(rule(['lib/a.ts'])).toBe(true);
    expect(rule(['web/a.ts', 'lib/a.ts'])).toBe(true);
  });

  it('does not restart when everything is inside them', () => {
    expect(rule(['web/a.ts', 'docs/b.md'])).toBe(false);
    expect(rule([])).toBe(false);
  });

  it('never counts a test-only file or a document at the root', () => {
    expect(rule(['lib/a.test.ts', 'lib/b.test.tsx', 'README.md'])).toBe(false);
    // A document inside a directory is not exempt: only the root ones are.
    expect(rule(['lib/notes.md'])).toBe(true);
  });
});

describe('restartIfAny', () => {
  const rule = restartIfAny(['web/next.config.ts']);

  it('restarts only for an exact match', () => {
    expect(rule(['web/next.config.ts'])).toBe(true);
    expect(rule(['web/next.config.ts.bak'])).toBe(false);
    expect(rule(['web/app/page.tsx'])).toBe(false);
  });
});

describe('conflictingDirtyPaths', () => {
  it('returns only the uncommitted changes a pull would overwrite', () => {
    const dirty = ['data/db.sqlite3', 'admin/app/page.tsx'];
    expect(conflictingDirtyPaths(dirty, ['admin/app/page.tsx', 'lib/x.ts'])).toEqual(['admin/app/page.tsx']);
  });

  it('finds no conflict for a file the pull does not touch', () => {
    expect(conflictingDirtyPaths(['data/db.sqlite3'], ['lib/x.ts'])).toEqual([]);
  });
});

describe('describePlan', () => {
  it('says only that it was skipped when something is blocked', () => {
    expect(describePlan(plan(['data/db.sqlite3']))).toContain('skipped');
  });

  it('says so when there is nothing to do', () => {
    expect(describePlan(plan(['web/app/page.tsx']))).toContain('nothing to restart');
  });

  it('names each server it will restart', () => {
    expect(describePlan(plan(['package.json']))).toBe('npm install / restart admin / restart web');
  });

  // The row has to name the command that will actually run. A bun checkout told it was going to
  // run `npm install` said something untrue about its own tree.
  it('names the package manager the install will use', () => {
    expect(describePlan(plan(['package.json']), 'bun')).toBe('bun install / restart admin / restart web');
    expect(describePlan(plan(['package.json']), 'pnpm')).toContain('pnpm install');
    // Omitted means npm, which is what every caller written before there was a second argument
    // meant by leaving it out.
    expect(describePlan(plan(['package.json']))).toContain('npm install');
  });
});

describe('hooksToRun', () => {
  const hook = (label: string, runOn?: (paths: readonly string[]) => boolean): AfterPullHook =>
    runOn === undefined ? { label, command: 'npm' } : { label, command: 'npm', runOn };

  /** The three shapes a hook list has: one that always runs, one gated on a path, and the
   *  order they come back in. */
  const HOOKS: AfterPullHook[] = [
    hook('always'),
    hook('cron:restore', runIfAny(['cron/schedule.json'])),
    hook('warm:cache', runIfAny(['web/app/page.tsx', 'web/app/layout.tsx'])),
  ];

  const cases: [name: string, hooks: AfterPullHook[], paths: string[], expected: string[]][] = [
    ['a pull that touches nothing gated still runs the ungated one', HOOKS, ['README.md'], ['always']],
    ['a gated hook runs when its path arrives', HOOKS, ['cron/schedule.json'], ['always', 'cron:restore']],
    [
      'two gates can match at once',
      HOOKS,
      ['cron/schedule.json', 'web/app/page.tsx'],
      ['always', 'cron:restore', 'warm:cache'],
    ],
    // The prefix is not enough: `runIfAny` matches whole paths, the same as `restartIfAny`.
    ['a path that merely starts the same does not match', HOOKS, ['cron/schedule.json.bak'], ['always']],
    ['no hooks configured is not an error', [], ['cron/schedule.json'], []],
    ['a gated hook and nothing it wants', [hook('cron:restore', runIfAny(['cron/schedule.json']))], ['lib/x.ts'], []],
  ];

  for (const [name, hooks, paths, expected] of cases) {
    it(name, () => {
      expect(hooksToRun(hooks, paths).map(h => h.label)).toEqual(expected);
    });
  }

  it('keeps the order the config gave, not the order the paths arrived in', () => {
    const paths = ['web/app/page.tsx', 'cron/schedule.json'];
    expect(hooksToRun(HOOKS, paths).map(h => h.label)).toEqual(['always', 'cron:restore', 'warm:cache']);
  });
});
