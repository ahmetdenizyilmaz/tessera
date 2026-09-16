// Pure helpers for forking a conversation into another panel. No Tauri or
// store imports here so the unit tests run in plain node.
import { isAssistantMessage, isSystemNote, isUserMessage, type ChatMessage } from '../types/stream';
import type { CodexItem } from '../types/codex';
import type { ForkMessage } from '../types/instance';

/** Upper bound for the text prepended to the first message of a forked panel. */
export const FORK_CONTEXT_MAX_CHARS = 30_000;
export const FORK_PREAMBLE_START = '[Conversation continued from';
export const FORK_PREAMBLE_END = '[End of the earlier conversation. Continue from here as the assistant.]';

/**
 * A forked panel's first message carries the earlier conversation as a
 * preamble. When that message comes back from disk or from the agent's echo,
 * show only what the user typed.
 */
export function stripForkPreamble(text: string): string {
  if (!text.startsWith(FORK_PREAMBLE_START)) return text;
  const end = text.indexOf(FORK_PREAMBLE_END);
  return end < 0 ? text : text.slice(end + FORK_PREAMBLE_END.length).trim();
}

/** Boilerplate an earlier build appended after the preamble; carries no content. */
const BOOTSTRAP_NOTE = 'The conversation above was forked from another panel.';

/**
 * Forks made by earlier builds carried the history only as a text preamble in
 * their first message. When such a panel is forked again, unpack that preamble
 * into the turns it describes so the history survives instead of being dropped.
 * Returns null when `text` is an ordinary message.
 */
export function expandForkPreamble(text: string): ForkMessage[] | null {
  if (!text.startsWith(FORK_PREAMBLE_START)) return null;
  const end = text.indexOf(FORK_PREAMBLE_END);
  if (end < 0) return null;
  const headerEnd = text.indexOf(']');
  const body = text.slice(headerEnd + 1, end);
  const out: ForkMessage[] = [];
  let role: ForkMessage['role'] | null = null;
  let buffer: string[] = [];
  const flush = () => {
    const content = buffer.join('\n').trim();
    if (role && content) out.push({ role, content });
    buffer = [];
  };
  for (const line of body.split('\n')) {
    if (line === 'User:' || line === 'Assistant:') {
      flush();
      role = line === 'User:' ? 'user' : 'assistant';
    } else {
      buffer.push(line);
    }
  }
  flush();
  const tail = text.slice(end + FORK_PREAMBLE_END.length).trim();
  if (tail && !tail.startsWith(BOOTSTRAP_NOTE)) out.push({ role: 'user', content: tail });
  return out;
}

function pushUser(out: ForkMessage[], text: string, timestamp?: string): void {
  const expanded = expandForkPreamble(text);
  if (expanded) {
    out.push(...expanded);
    return;
  }
  const content = text.trim();
  if (content) out.push({ role: 'user', content, timestamp });
}

/** Codex transcript items → role/content pairs. Tool output and reasoning are dropped. */
export function codexItemsToMessages(items: CodexItem[]): ForkMessage[] {
  const out: ForkMessage[] = [];
  for (const item of items) {
    if (item.type === 'userMessage') {
      pushUser(out, (item.content ?? [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text as string)
        .join('\n')
        .trim());
    } else if (item.type === 'agentMessage') {
      const text = (item.text ?? '').trim();
      if (text) out.push({ role: 'assistant', content: text });
    }
  }
  return out;
}

/** Claude chat-store messages → role/content pairs. Tool calls and thinking are dropped. */
export function claudeMessagesToMessages(messages: ChatMessage[]): ForkMessage[] {
  const out: ForkMessage[] = [];
  for (const message of messages) {
    if (isSystemNote(message)) continue;
    if (isUserMessage(message)) {
      pushUser(out, message.text.trim(), new Date(message.timestamp).toISOString());
      continue;
    }
    if (isAssistantMessage(message)) {
      const text = message.blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n')
        .trim();
      if (!text) continue;
      if (message.role === 'user') pushUser(out, text);
      else out.push({ role: 'assistant', content: text });
    }
  }
  return out;
}

/** Plain role/content rows (disk history, LLM store) → validated ForkMessages. */
export function plainToMessages(rows: Array<{ role: string; content: string; timestamp?: string | number | null }>): ForkMessage[] {
  const out: ForkMessage[] = [];
  for (const row of rows) {
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    const timestamp = typeof row.timestamp === 'number' ? new Date(row.timestamp).toISOString() : row.timestamp ?? undefined;
    if (row.role === 'user') {
      pushUser(out, row.content.trim(), timestamp);
      continue;
    }
    const text = row.content.trim();
    if (text) out.push({ role: 'assistant', content: text, timestamp });
  }
  return out;
}

/**
 * Chat APIs such as Anthropic and Gemini reject consecutive turns with the
 * same role and a conversation that opens with the assistant. Merge runs and
 * drop a leading assistant turn so a seeded LLM transcript is always valid.
 */
export function normalizeAlternation(messages: ForkMessage[]): ForkMessage[] {
  const out: ForkMessage[] = [];
  for (const m of messages) {
    if (out.length === 0 && m.role === 'assistant') continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      out[out.length - 1] = { ...last, content: `${last.content}\n\n${m.content}` };
    } else {
      out.push({ ...m });
    }
  }
  return out;
}

/**
 * Plain-text block that carries the earlier conversation into the new agent.
 * Keeps the newest turns that fit in `maxChars` and says so when older ones were cut.
 */
export function renderForkContext(transcript: ForkMessage[], sourceName: string, maxChars = FORK_CONTEXT_MAX_CHARS): string {
  const kept: string[] = [];
  let used = 0;
  let dropped = 0;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    const block = `${m.role === 'user' ? 'User' : 'Assistant'}:\n${m.content}`;
    if (kept.length > 0 && used + block.length > maxChars) {
      dropped = i + 1;
      break;
    }
    kept.unshift(block);
    used += block.length + 2;
  }
  const header = dropped > 0
    ? `${FORK_PREAMBLE_START} "${sourceName}". The oldest ${dropped} message${dropped === 1 ? '' : 's'} were omitted for length; the most recent turns follow.]`
    : `${FORK_PREAMBLE_START} "${sourceName}". Earlier turns, possibly with a different assistant:]`;
  return `${header}\n\n${kept.join('\n\n')}\n\n${FORK_PREAMBLE_END}`;
}
