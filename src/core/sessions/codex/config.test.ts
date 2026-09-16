import { describe, expect, it } from 'bun:test';
import { codexConfigModel } from './config.js';
import { codexInvocation } from './invocation.js';

describe('codexConfigModel', () => {
  const cases: { name: string; toml: string; want: string | null }[] = [
    { name: 'the key on its own', toml: 'model = "gpt-6-astra"\n', want: 'gpt-6-astra' },
    { name: 'single quotes', toml: "model = 'gpt-6-astra'\n", want: 'gpt-6-astra' },
    { name: 'no spaces around the equals', toml: 'model="gpt-6-astra"\n', want: 'gpt-6-astra' },
    { name: 'leading whitespace', toml: '   model = "gpt-6-astra"\n', want: 'gpt-6-astra' },
    { name: 'a trailing comment', toml: 'model = "gpt-6-astra"  # the default\n', want: 'gpt-6-astra' },
    {
      name: 'other keys above it',
      toml: 'approval_policy = "on-request"\nmodel = "gpt-6-astra"\n',
      want: 'gpt-6-astra',
    },
    { name: 'nothing at all', toml: '', want: null },
    { name: 'a file with no model key', toml: 'approval_policy = "on-request"\n', want: null },
    { name: 'a commented-out key', toml: '# model = "gpt-6-astra"\n', want: null },
    // ⚠️ The row this exists for. A machine that has been used for a while has tables with a
    // `model` key of their own, and none of them is this session's model.
    {
      name: "a model inside a table, which is somebody else's",
      toml: 'approval_policy = "on-request"\n\n[tui]\nmodel = "gpt-4.1"\n',
      want: null,
    },
    {
      name: 'a model inside a project table',
      toml: '[projects."/home/user/site"]\nmodel = "gpt-4.1"\n',
      want: null,
    },
    {
      name: 'the top-level one still wins over a table below it',
      toml: 'model = "gpt-6-astra"\n\n[tui]\nmodel = "gpt-4.1"\n',
      want: 'gpt-6-astra',
    },
  ];
  for (const c of cases) {
    it(`${c.name} -> ${String(c.want)}`, () => {
      expect(codexConfigModel(c.toml)).toBe(c.want);
    });
  }
});

describe('codexInvocation', () => {
  const cases: { name: string; command: string; model: string | null; profile: string | null }[] = [
    { name: 'a plain codex', command: 'codex', model: null, profile: null },
    { name: 'the short model flag', command: 'codex -m gpt-6-astra', model: 'gpt-6-astra', profile: null },
    { name: 'the long one', command: 'codex --model gpt-6-astra', model: 'gpt-6-astra', profile: null },
    { name: 'the short one with an equals', command: 'codex -m=gpt-6-astra', model: 'gpt-6-astra', profile: null },
    { name: 'the long one with an equals', command: 'codex --model=gpt-6-astra', model: 'gpt-6-astra', profile: null },
    { name: 'a profile', command: 'codex -p work', model: null, profile: 'work' },
    {
      name: 'both, and a full path to the binary',
      command: '/home/user/.local/bin/codex --profile work --model gpt-6-astra',
      model: 'gpt-6-astra',
      profile: 'work',
    },
    { name: 'a flag with nothing after it', command: 'codex --model', model: null, profile: null },
    { name: 'extra spacing', command: 'codex   -m    gpt-6-astra', model: 'gpt-6-astra', profile: null },
    {
      // The word after the flag is the value, wherever else the string mentions one.
      name: 'a prompt that talks about models',
      command: 'codex exec which -m model do you use',
      model: 'model',
      profile: null,
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(codexInvocation(c.command)).toEqual({ model: c.model, profile: c.profile });
    });
  }
});
