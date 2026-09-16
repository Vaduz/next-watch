import { describe, expect, it } from 'bun:test';
import { codexHeadFacts, codexTranscriptTip } from './tip.js';

/** A real first line, reduced to the fields that are read. */
const META = JSON.stringify({
  timestamp: '2026-08-21T18:16:00.375Z',
  ordinal: 0,
  type: 'session_meta',
  payload: {
    session_id: '01a02588-fc7c-7070-b611-629df45b305e',
    id: '01a02588-fc7c-7070-b611-629df45b305e',
    timestamp: '2026-08-21T18:15:29.669Z',
    cwd: '/home/user/site',
    originator: 'codex-tui',
    cli_version: '0.149.0',
    source: 'cli',
    thread_source: 'user',
    model_provider: 'openai',
  },
});

const line = (type: string, payload: object, timestamp = '2026-08-21T18:32:00.000Z'): string =>
  JSON.stringify({ timestamp, type, payload });

/** A real `turn_context`, cut to the fields that are read. Codex writes one at the start of
 *  every turn; the rest of it is the sandbox and approval policy. */
const TURN_CONTEXT = line('turn_context', {
  turn_id: '01a0a836-35af-7260-bfa7-72e6ee640161',
  cwd: '/home/user/site',
  model: 'gpt-6-astra',
  effort: 'medium',
  approval_policy: 'on-request',
});

describe('codexHeadFacts', () => {
  const userMessage = (text: string): string =>
    line('event_msg', { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text }] } });

  it('takes the first user message as the name', () => {
    const head = [META, line('event_msg', { type: 'task_started' }), userMessage('can it read text aloud?')].join('\n');
    expect(codexHeadFacts(head).name).toBe('can it read text aloud?');
  });

  it('never names a session from a response_item, which would name them all the same', () => {
    const injected = line('response_item', {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '# AGENTS.md instructions for /home/user/site' }],
    });
    expect(codexHeadFacts([META, injected].join('\n')).name).toBeNull();
  });

  it('reads the older shape too, a plain user_message string', () => {
    expect(codexHeadFacts(line('event_msg', { type: 'user_message', message: 'do the hooks run?' })).name).toBe(
      'do the hooks run?',
    );
  });

  it('collapses newlines and cuts what is too long', () => {
    const { name } = codexHeadFacts(userMessage(`${'x'.repeat(60)}\n\nmore`));
    expect(name).toBe(`${'x'.repeat(40)}…`);
  });

  it('has no name before anything has been said', () => {
    expect(codexHeadFacts(META).name).toBeNull();
  });

  it("keeps the head's settings line as a fallback model, which a long turn pushes out of the tail", () => {
    const settings = line('event_msg', { type: 'thread_settings_applied', thread_settings: { model: 'gpt-5.6-sol' } });
    expect(codexHeadFacts([META, settings, userMessage('fix it')].join('\n'))).toEqual({
      name: 'fix it',
      model: 'gpt-5.6-sol',
    });
  });

  // ⚠️ The record 0.154.0 actually writes, and the reason every Codex row showed `-`: it is a
  // top-level `turn_context`, not an `event_msg`, so the loop dropped it before reading it.
  it('reads the model off a turn_context, which is what a current rollout carries', () => {
    expect(codexHeadFacts([META, TURN_CONTEXT, userMessage('fix it')].join('\n'))).toEqual({
      name: 'fix it',
      model: 'gpt-6-astra',
    });
  });
});

describe('codexTranscriptTip', () => {
  const tokenCount = line('event_msg', {
    type: 'token_count',
    info: {
      last_token_usage: { input_tokens: 85970, cached_input_tokens: 73472, output_tokens: 502, total_tokens: 86472 },
      model_context_window: 258400,
    },
  });
  const settings = line('event_msg', { type: 'thread_settings_applied', thread_settings: { model: 'gpt-5.6-sol' } });

  it('is busy while a turn runs, with the time it started', () => {
    const started = line('event_msg', { type: 'task_started' }, '2026-08-21T18:31:20.034Z');
    const tip = codexTranscriptTip([settings, started, tokenCount].join('\n'));
    expect(tip.status).toBe('busy');
    expect(tip.statusAtMs).toBe(Date.parse('2026-08-21T18:31:20.034Z'));
    expect(tip.model).toBe('gpt-5.6-sol');
  });

  it('is idle once it has finished, an abort included', () => {
    expect(codexTranscriptTip(line('event_msg', { type: 'task_complete' })).status).toBe('idle');
    expect(codexTranscriptTip(line('event_msg', { type: 'turn_aborted' })).status).toBe('idle');
  });

  it('takes the context size from last_token_usage.total_tokens, adding nothing to it', () => {
    expect(codexTranscriptTip(tokenCount).contextTokens).toBe(86472);
  });

  it('leaves the status as ? when the tail says nothing, rather than widening the window', () => {
    const tip = codexTranscriptTip(line('response_item', { type: 'reasoning' }));
    expect(tip.status).toBe('?');
    expect(tip.statusAtMs).toBeNull();
  });

  it('reads the model off a turn_context, which is what a current rollout carries', () => {
    expect(codexTranscriptTip([TURN_CONTEXT, line('event_msg', { type: 'task_complete' })].join('\n')).model).toBe(
      'gpt-6-astra',
    );
  });

  // Read backwards, so a `/model` part-way through a session is what the row shows.
  it('takes the newest of several, not the first', () => {
    const older = line('turn_context', { model: 'gpt-5.6-sol' });
    const tail = [older, line('event_msg', { type: 'task_started' }), TURN_CONTEXT].join('\n');

    expect(codexTranscriptTip(tail).model).toBe('gpt-6-astra');
  });

  it('has no model when nothing in the tail names one', () => {
    expect(codexTranscriptTip(line('event_msg', { type: 'task_complete' })).model).toBeNull();
  });
});
