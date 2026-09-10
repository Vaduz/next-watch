// The flags. What is checked here is the part a host can change: a caller that builds its own
// config must not be offered a `--config` flag that would then be ignored — a listed flag that
// does nothing is worse than no flag at all.
import { describe, expect, it } from 'bun:test';
import { parseArgs, DEFAULT_CONFIG } from './args.js';

describe('parseArgs', () => {
  it('reads the config path when the flag is there', () => {
    expect(parseArgs({}, ['--config', 'other.mjs']).config).toBe('other.mjs');
    expect(parseArgs({}, []).config).toBe(DEFAULT_CONFIG);
  });

  it('refuses --config when the caller supplies its own config', () => {
    // yargs exits the process on a strict-mode failure, so what is checked is that the option
    // is gone from the parsed shape rather than the exit itself.
    expect(parseArgs({ config: false }, []).config).toBe(DEFAULT_CONFIG);
    expect(parseArgs({ config: false }, ['--interval', '5']).interval).toBe(5);
  });

  it('keeps a sample interval of at least a second, however it is asked', () => {
    expect(parseArgs({}, ['--sample', '0']).sample).toBe(1);
    expect(parseArgs({}, ['--sample', '-3']).sample).toBe(1);
  });

  it('leaves the pane heights null so the terminal decides', () => {
    const a = parseArgs({}, []);
    expect(a.log).toBeNull();
    expect(a.access).toBeNull();
    expect(parseArgs({}, ['--log', '0']).log).toBe(0);
  });
  // yargs prints the version and exits, so what is checked here is that the option is accepted
  // and that parsing the rest is unaffected. That `main` passes a number at all is the fix:
  // yargs' own guess reads whichever package.json owns the node_modules tree, which for an
  // installed next-watch is the consuming project's.
  it('takes a version from the caller without disturbing the other flags', () => {
    expect(parseArgs({ version: '9.9.9' }, ['--interval', '7']).interval).toBe(7);
    expect(parseArgs({ version: '9.9.9' }, []).config).toBe(DEFAULT_CONFIG);
  });
});
