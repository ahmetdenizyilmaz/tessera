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

/** Codex transcript items → role/content pairs. Tool output and reasoning are dropped. */
export function codexItemsToMessages(items: CodexItem[]): ForkMessage[] {
  const out: ForkMessage[] = [];
  for (const item of items) {
    if (item.type === 'userMessage') {
      const text = stripForkPreamble((item.content ?? [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text as string)
        .join('\n')
        .trim());
      if (text) out.push({ role: 'user', content: text });
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
      const text = stripForkPreamble(message.text.trim());
      if (text) out.push({ role: 'user', content: text, timestamp: new Date(message.timestamp).toISOString() });
      continue;
    }
    if (isAssistantMessage(message)) {
      const text = message.blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n')
        .trim();
      if (!text) continue;
      if (message.role === 'user') out.push({ role: 'user', content: stripForkPreamble(text) });
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
    const text = row.role === 'user' ? stripForkPreamble(row.content.trim()) : row.content.trim();
    if (!text) continue;
    const timestamp = typeof row.timestamp === 'number' ? new Date(row.timestamp).toISOString() : row.timestamp ?? undefined;
    out.push({ role: row.role, content: text, timestamp });
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
