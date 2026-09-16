/** The facts a row needs, read from **the head** and **the tail** of a rollout.
 *
 *  One jsonl is looked at from both ends: the head for what never changes (the name, the first
 *  model), the tail for the current state. The middle is never read — this runs every second,
 *  and a wider window makes it heavy. */
import { asRecord } from '../../util.js';
import { str } from '../codex.js';
import { parseRolloutLine } from './rollout.js';

/** How much of a prompt becomes the name. */
const MAX_NAME_CHARS = 40;

/** The strings out of a user message's `content`, joined into one. */
function userMessageText(item: Record<string, unknown>): string | null {
  const content = item.content;
  if (!Array.isArray(content)) return null;
  const texts = content.map(c => str(asRecord(c)?.text)).filter((t): t is string => t !== null);
  return texts.length ? texts.join(' ') : null;
}

/** **The prompt a person typed**, out of one line. Two shapes exist, old and new.
 *
 *   - Newer — `event_msg` / `item_completed` with `item.type === 'UserMessage'`
 *   - Older — `event_msg` / `user_message` with a `message` string
 *
 *  ⚠️ `response_item` with `role: 'user'` is not read. Instruction files and environment
 *  information are stacked there as if the user had said them, so reading it would give every
 *  session the same name. */
function promptOf(payload: Record<string, unknown>): string | null {
  const type = str(payload.type);
  if (type === 'user_message') return str(payload.message);
  if (type !== 'item_completed') return null;
  const o = asRecord(payload.item);
  if (o === null) return null;
  if (str(o.type) !== 'UserMessage' && str(o.item_type) !== 'UserMessage') return null;
  return userMessageText(o);
}

/** Fold into something that fits a row: whitespace collapsed, and cut if too long. */
function tidyName(text: string): string {
  const one = text.replace(/\s+/gu, ' ').trim();
  // Counted in code points: `slice` would cut a surrogate pair in half.
  const chars = Array.from(one);
  return chars.length > MAX_NAME_CHARS ? `${chars.slice(0, MAX_NAME_CHARS).join('')}…` : one;
}

/** The model one record names, or null when it names none.
 *
 *  ⚠️ **Two shapes, and one of them is not an `event_msg`.** Codex 0.154.0 writes a top-level
 *  `turn_context` record at the start of every turn, with the model on it; older versions wrote
 *  an `event_msg` / `thread_settings_applied` carrying `thread_settings.model`. Reading only the
 *  second is how every Codex row came to show `-` for its model: the `turn_context` line was
 *  filtered out before anything looked at it. Both are read, so a rollout from either version
 *  answers. */
function modelIn(record: { type: string; payload: Record<string, unknown> }): string | null {
  if (record.type === 'turn_context') return str(record.payload.model);
  if (record.type !== 'event_msg' || str(record.payload.type) !== 'thread_settings_applied') return null;
  return str(asRecord(record.payload.thread_settings)?.model);
}

/** What the head of a rollout yields, or null when it has not appeared yet. */
export interface CodexHeadFacts {
  /** The first prompt a person typed. */
  name: string | null;
  /** The model settled on first. */
  model: string | null;
}

/** The name and the model, from the head of a rollout.
 *
 *  The name is the first prompt, which means it **never changes for the life of the session**.
 *  Renaming every turn would fill the event log with `session renamed`.
 *
 *  The model appears **only at the start of a turn**. During a long turn it is pushed out of
 *  the tail's reading window, so the first one found at the head is kept as a fallback; a
 *  newer one read from the tail wins, which is what makes a `/model` part-way through show. */
export function codexHeadFacts(head: string): CodexHeadFacts {
  const facts: CodexHeadFacts = { name: null, model: null };
  for (const line of head.split('\n')) {
    const record = parseRolloutLine(line);
    if (record === null) continue;
    facts.model ??= modelIn(record);
    if (record.type !== 'event_msg') continue;
    if (facts.name === null) {
      const prompt = promptOf(record.payload);
      if (prompt !== null) facts.name = tidyName(prompt);
    }
    if (facts.name !== null && facts.model !== null) break;
  }
  return facts;
}

/** What the tail yields, null where it cannot be read; the status falls back to `'?'`. */
export interface CodexTip {
  /** busy while a turn runs, idle when it has finished, `'?'` when the tail says neither. */
  status: string;
  statusAtMs: number | null;
  model: string | null;
  contextTokens: number | null;
}

/** The turn boundaries, and the status each implies. */
const TURN_STATUS: Record<string, string | undefined> = {
  task_started: 'busy',
  task_complete: 'idle',
  turn_aborted: 'idle',
};

/** **The context size right now**, from the most recent token count.
 *
 *  `last_token_usage.total_tokens` is used as it is. The cached input count is a **breakdown
 *  of** the input count rather than something to add to it, so adding them would double-count. */
function contextTokensOf(payload: Record<string, unknown>): number | null {
  const last = asRecord(asRecord(payload.info)?.last_token_usage);
  if (last === null) return null;
  const total = last.total_tokens;
  return typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : null;
}

/** Read the tail **backwards**, stopping once the status, the model and the context size are
 *  all known.
 *
 *  When the tail says nothing — one turn larger than the reading window — `'?'` is the right
 *  answer. Widening the window to chase it would make a once-a-second read heavy. */
export function codexTranscriptTip(tail: string): CodexTip {
  const tip: CodexTip = { status: '?', statusAtMs: null, model: null, contextTokens: null };
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const record = parseRolloutLine(lines[i]);
    if (record === null) continue;
    tip.model ??= modelIn(record);
    if (record.type !== 'event_msg') continue;
    const type = str(record.payload.type) ?? '';
    const status = TURN_STATUS[type];
    if (status !== undefined && tip.status === '?') {
      tip.status = status;
      tip.statusAtMs = record.atMs;
    }
    if (type === 'token_count' && tip.contextTokens === null) tip.contextTokens = contextTokensOf(record.payload);
    if (tip.status !== '?' && tip.model !== null && tip.contextTokens !== null) break;
  }
  return tip;
}
