import { describe, expect, it } from 'bun:test';
import { toolsIn } from './toolsConfig.js';

/** Stand-ins for the two CLIs the package ships with, both keeping themselves up to date. */
interface Tool {
  command: string;
  repo: string;
  autoUpdate?: boolean;
}
const DEFAULTS: readonly Tool[] = [
  { command: 'claude', repo: 'anthropics/claude-code', autoUpdate: true },
  { command: 'codex', repo: 'openai/codex', autoUpdate: true },
];

describe('toolsIn', () => {
  const cases: {
    name: string;
    switched: Parameters<typeof toolsIn<Tool>>[0];
    want: readonly Tool[] | null;
  }[] = [
    { name: 'left out is off', switched: undefined, want: null },
    { name: 'false is off', switched: false, want: null },
    {
      name: 'true is the defaults, which update themselves',
      switched: true,
      want: [
        { command: 'claude', repo: 'anthropics/claude-code', autoUpdate: true },
        { command: 'codex', repo: 'openai/codex', autoUpdate: true },
      ],
    },
    {
      // The row the object form exists for: one line instead of a copy of the default list.
      name: 'the object form turns updating off for both without naming them',
      switched: { autoUpdate: false },
      want: [
        { command: 'claude', repo: 'anthropics/claude-code', autoUpdate: false },
        { command: 'codex', repo: 'openai/codex', autoUpdate: false },
      ],
    },
    {
      name: 'and can turn it back on the same way',
      switched: { autoUpdate: true },
      want: [
        { command: 'claude', repo: 'anthropics/claude-code', autoUpdate: true },
        { command: 'codex', repo: 'openai/codex', autoUpdate: true },
      ],
    },
    {
      // An object that says nothing says nothing: the defaults keep their own answer.
      name: 'an empty object is the defaults unchanged',
      switched: {},
      want: [
        { command: 'claude', repo: 'anthropics/claude-code', autoUpdate: true },
        { command: 'codex', repo: 'openai/codex', autoUpdate: true },
      ],
    },
    {
      name: 'an array is the list it gives, exactly',
      switched: [{ command: 'codex', repo: 'openai/codex', autoUpdate: true }],
      want: [{ command: 'codex', repo: 'openai/codex', autoUpdate: true }],
    },
    { name: 'an empty array is a list with nothing in it, not the defaults', switched: [], want: [] },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(toolsIn<Tool>(c.switched, DEFAULTS, 'providers.tools')).toEqual(c.want);
    });
  }

  it('does not touch the defaults it was given', () => {
    toolsIn<Tool>({ autoUpdate: false }, DEFAULTS, 'providers.tools');

    expect(DEFAULTS[0]?.autoUpdate).toBe(true);
  });

  const refused: { name: string; switched: unknown; says: string }[] = [
    // ⚠️ What this whole check is for. A config saying `autoupdate: false` and being obeyed as
    // `true` would install releases on a machine that asked for the opposite, and say nothing.
    { name: 'a misspelled key', switched: { autoupdate: false }, says: 'unknown key autoupdate' },
    { name: 'a key from another section', switched: { autoUpdate: false, repo: 'x' }, says: 'unknown key repo' },
    { name: 'a flag that is not a flag', switched: { autoUpdate: 'false' }, says: 'autoUpdate must be true or false' },
    { name: 'a string', switched: 'yes', says: 'must be true, false, an object, or an array' },
    // The type says this cannot happen; the config file it is read from never saw the type.
    { name: 'null', switched: null, says: 'must be true, false, an object, or an array' },
    { name: 'a number', switched: 1, says: 'must be true, false, an object, or an array' },
  ];
  for (const c of refused) {
    it(`refuses ${c.name}, naming it`, () => {
      expect(() =>
        toolsIn<Tool>(c.switched as Parameters<typeof toolsIn<Tool>>[0], DEFAULTS, 'site.mjs: providers.tools'),
      ).toThrow(c.says);
      expect(() =>
        toolsIn<Tool>(c.switched as Parameters<typeof toolsIn<Tool>>[0], DEFAULTS, 'site.mjs: providers.tools'),
      ).toThrow('site.mjs');
    });
  }
});
