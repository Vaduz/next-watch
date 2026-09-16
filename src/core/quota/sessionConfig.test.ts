import { describe, expect, it } from 'bun:test';
import { quotaSessionPlans, type QuotaSessionPlan, type QuotaSessionSwitch } from './sessionConfig.js';

describe('quotaSessionPlans', () => {
  const cases: {
    name: string;
    switched: QuotaSessionSwitch | undefined;
    want: QuotaSessionPlan[];
  }[] = [
    { name: 'left out: nothing at all', switched: undefined, want: [] },
    { name: 'false: nothing at all', switched: false, want: [] },
    {
      name: 'true: both CLIs, whenever the window is closed',
      switched: true,
      want: [
        { cli: 'claude', at: null },
        { cli: 'codex', at: null },
      ],
    },
    {
      name: 'a schedule with no CLI named applies to both',
      switched: { at: ['06:00', '11:00'] },
      want: [
        { cli: 'claude', at: [360, 660] },
        { cli: 'codex', at: [360, 660] },
      ],
    },
    {
      name: 'a sandbox alone leaves both on the automatic mode',
      switched: { cwd: '/tmp/box' },
      want: [
        { cli: 'claude', at: null },
        { cli: 'codex', at: null },
      ],
    },
    {
      name: 'one each',
      switched: { claude: true, codex: false },
      want: [{ cli: 'claude', at: null }],
    },
    {
      // Naming one CLI is a statement about that CLI. Turning the other off is `codex: false`.
      name: 'turning one off leaves the other on what the outer setting says',
      switched: { at: ['09:00'], claude: false },
      want: [{ cli: 'codex', at: [540] }],
    },
    {
      name: 'a CLI with its own times, beside one on the outer ones',
      switched: { cwd: '/tmp/box', at: ['09:00'], codex: { at: ['06:00', '21:00'] } },
      want: [
        { cli: 'claude', at: [540] },
        { cli: 'codex', at: [360, 1260] },
      ],
    },
    {
      name: 'a CLI switched on with no times of its own falls back to the outer ones',
      switched: { at: ['09:00'], codex: true },
      want: [
        { cli: 'claude', at: [540] },
        { cli: 'codex', at: [540] },
      ],
    },
    {
      name: 'one CLI on a schedule while the other has none at all',
      switched: { claude: { at: ['14:00'] } },
      want: [
        { cli: 'claude', at: [840] },
        { cli: 'codex', at: null },
      ],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(quotaSessionPlans(c.switched, 'providers.quotaSession')).toEqual(c.want);
    });
  }

  it('keeps the CLIs in one order, so the screen and the log never reorder themselves', () => {
    const plans = quotaSessionPlans({ codex: true, claude: true }, 'providers.quotaSession');

    expect(plans.map(p => p.cli)).toEqual(['claude', 'codex']);
  });

  const refused: { name: string; switched: QuotaSessionSwitch; says: string }[] = [
    { name: 'a bad time in the outer list', switched: { at: ['9:00'] }, says: 'providers.quotaSession.at' },
    {
      name: "a bad time in one CLI's own list",
      switched: { codex: { at: ['24:00'] } },
      says: 'providers.quotaSession.codex.at',
    },
    { name: 'an empty list', switched: { claude: { at: [] } }, says: 'at least one time' },
  ];
  for (const c of refused) {
    it(`refuses ${c.name}, naming where it was written`, () => {
      expect(() => quotaSessionPlans(c.switched, 'providers.quotaSession')).toThrow(c.says);
    });
  }
});
