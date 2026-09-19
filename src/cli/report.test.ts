// The automatic install: what it says before it starts one, and when it starts one at all.
//
// This is the only thing on the screen that changes software on the machine without anybody
// asking, so the line it writes first is the whole audit trail. What it runs is the same path a
// typed `(u)pdate` takes, which `actions/` owns; here the starter is a recorder, so nothing is
// installed.
import { describe, expect, it } from 'bun:test';
import { maybeAutoUpdate, type AutoUpdateScreen } from './report.js';
import { initialState, type WatchState } from '../core/watchState.js';
import type { ResolvedConfig } from '../config.js';
import type { ToolVersionRow } from '../core/types.js';
import type { WatchTarget } from '../core/watchTargets.js';

/** A version row: installed `version`, newest `latest`. */
const row = (name: string, version: string | null, latest: string | null): ToolVersionRow => ({
  name,
  version,
  error: null,
  latest,
  latestError: null,
});

/** The screen, remembering what it was told rather than drawing it. */
function recorder(): AutoUpdateScreen & { said: string[] } {
  const said: string[] = [];
  return { said, event: (_atMs, _mark, text) => said.push(text) };
}

/** The watcher's state, with the versions already read once. */
function stateWith(versions: ToolVersionRow[] | null, over: Partial<WatchState> = {}): WatchState {
  return { ...initialState('a1b2c3d', 1_000), versions, ...over };
}

const config = (autoUpdate: readonly string[]): ResolvedConfig =>
  ({ providers: { autoUpdate } }) as unknown as ResolvedConfig;

/** `maybeAutoUpdate` with a recording screen and a recording starter. */
function run(
  conf: ResolvedConfig,
  state: WatchState,
): { said: string[]; started: { key: string; verb: string }[]; state: WatchState } {
  const screen = recorder();
  const started: { key: string; verb: string }[] = [];
  maybeAutoUpdate(conf, state, screen, (target: WatchTarget, verb: string) => started.push({ key: target.key, verb }));
  return { said: screen.said, started, state };
}

describe('maybeAutoUpdate', () => {
  it('says what it saw, then starts the same update a person would type', () => {
    const out = run(config(['claude']), stateWith([row('claude', '2.1.273', '2.1.280')]));

    expect(out.said).toEqual(['claude 2.1.280 is out (installed 2.1.273), updating ...']);
    expect(out.started).toEqual([{ key: 'tool:claude', verb: 'update' }]);
  });

  it('remembers the release it acted on, so the next pass does not run it again', () => {
    const state = stateWith([row('claude', '2.1.273', '2.1.280')]);
    const first = run(config(['claude']), state);
    const second = run(config(['claude']), state);

    expect(first.started).toHaveLength(1);
    expect(state.autoUpdated).toEqual({ claude: { latest: '2.1.280', from: '2.1.273' } });
    // ⚠️ The versions are only re-read when the update finishes, so the row still reads as behind
    // on the pass right after one is started. Without the memo that is an install every pass.
    expect(second.started).toEqual([]);
    expect(second.said).toEqual([]);
  });

  it('runs a second update when the first one landed short of the release it was aiming at', () => {
    // 2026-09-18: `codex update` resolved 0.155.0 while the watcher was aiming at 0.155.1, and
    // exited 0. What makes the second pass possible is that the memo written here holds where the
    // first attempt started from, so a version that moved no longer matches it.
    const state = stateWith([row('codex', '0.154.0', '0.155.1')]);
    const first = run(config(['codex']), state);
    state.versions = [row('codex', '0.155.0', '0.155.1')];
    const second = run(config(['codex']), state);

    expect(first.started).toEqual([{ key: 'tool:codex', verb: 'update' }]);
    expect(second.started).toEqual([{ key: 'tool:codex', verb: 'update' }]);
    expect(second.said).toEqual(['codex 0.155.1 is out (installed 0.155.0), updating ...']);
    expect(state.autoUpdated).toEqual({ codex: { latest: '0.155.1', from: '0.155.0' } });
  });

  const quiet: { name: string; conf: readonly string[]; state: WatchState }[] = [
    {
      name: 'nothing is switched on for auto-update',
      conf: [],
      state: stateWith([row('claude', '2.1.273', '2.1.280')]),
    },
    {
      // The list says which CLIs may install themselves, and a row outside it only reports.
      name: 'the tool that is behind was not one of them',
      conf: ['codex'],
      state: stateWith([row('claude', '2.1.273', '2.1.280')]),
    },
    { name: 'the versions have not been read yet', conf: ['claude'], state: stateWith(null) },
    {
      name: 'the installed version is already the newest',
      conf: ['claude'],
      state: stateWith([row('claude', '2.1.280', '2.1.280')]),
    },
    { name: 'upstream could not be read', conf: ['claude'], state: stateWith([row('claude', '2.1.273', null)]) },
    {
      // One child at a time: an install started while a build is running would make it
      // impossible to tell whose output is whose.
      name: 'something else is already running',
      conf: ['claude'],
      state: stateWith([row('claude', '2.1.273', '2.1.280')], {
        ui: { ...initialState('a1b2c3d', 1_000).ui, busy: 'build site' },
      }),
    },
  ];
  for (const c of quiet) {
    it(`starts nothing when ${c.name}`, () => {
      const out = run(config(c.conf), c.state);

      expect(out.started).toEqual([]);
      expect(out.said).toEqual([]);
    });
  }

  it('takes one tool per pass, leaving the other for the next one', () => {
    const state = stateWith([row('claude', '2.1.273', '2.1.280'), row('codex', '0.154.0', '0.155.0')]);

    expect(run(config(['claude', 'codex']), state).started).toEqual([{ key: 'tool:claude', verb: 'update' }]);
    expect(run(config(['claude', 'codex']), state).started).toEqual([{ key: 'tool:codex', verb: 'update' }]);
  });
});
