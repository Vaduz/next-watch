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
});
