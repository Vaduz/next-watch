/** Wording for the ssh-agent row. Pure: reading the agent itself lives in `io/`. */
import type { SshAgentCard } from './types.js';

/** Read the state from what `ssh-add -l` exited with and said.
 *
 *  The exit code is OpenSSH's promise (0 = keys, 1 = none, 2 = no agent to reach), which is why
 *  none of this leans on the wording (`The agent has no identities.`) — that is translated. One
 *  key is one line, so the line count is the number of keys. */
export function parseSshAddList(code: number, output: string): SshAgentCard {
  const lines = output
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
  if (code === 0) return { state: lines.length > 0 ? 'loaded' : 'empty', keys: lines.length, error: null };
  if (code === 1) return { state: 'empty', keys: 0, error: null };
  if (code === 2) return { state: 'no-agent', keys: 0, error: lines[0] ?? 'cannot connect to ssh-agent' };
  return { state: 'unknown', keys: 0, error: lines[0] ?? `ssh-add -l exited with ${code}` };
}

export function sshAgentSummary(card: SshAgentCard): string {
  switch (card.state) {
    case 'loaded':
      return `ssh-agent: ${card.keys} key(s) loaded`;
    case 'empty':
      return 'ssh-agent: no key loaded · git over SSH will fail';
    case 'no-agent':
      return `ssh-agent: not reachable (${card.error ?? 'no agent'})`;
    default:
      return `ssh-agent: unknown (${card.error ?? 'ssh-add could not be run'})`;
  }
}

/** The key the cursor lands on. The targets and the screen both point at this one string. */
export const SSH_TARGET_KEY = 'ssh:agent';

/** Whether it makes sense to offer adding a key. In `no-agent` there is nowhere to add it, so
 *  the offer would go nowhere. */
export const sshAgentNeedsKey = (card: SshAgentCard): boolean => card.state === 'empty';
