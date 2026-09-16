import { describe, expect, it } from 'vitest';
import {
  claudeMessagesToMessages,
  codexItemsToMessages,
  normalizeAlternation,
  plainToMessages,
  renderForkContext,
  stripForkPreamble,
} from './forkTranscript';
import type { ChatMessage } from '../types/stream';

describe('codexItemsToMessages', () => {
  it('keeps user and agent text and drops tool output', () => {
    const result = codexItemsToMessages([
      { id: '1', type: 'userMessage', content: [{ type: 'text', text: 'hello' }, { type: 'image', url: 'data:image/png;base64,x' }] },
      { id: '2', type: 'reasoning', summary: ['thinking'] },
      { id: '3', type: 'commandExecution', command: 'ls', aggregatedOutput: 'a b' },
      { id: '4', type: 'agentMessage', text: ' hi there ' },
      { id: '5', type: 'agentMessage', text: '' },
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });
});

describe('claudeMessagesToMessages', () => {
  it('flattens text blocks and skips tool calls, thinking, and system notes', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', text: 'fix the bug', timestamp: 0 },
      { id: 's1', role: 'system', kind: 'info', text: 'note', timestamp: 0 },
      {
        id: 'a1',
        role: 'assistant',
        isStreaming: false,
        blocks: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'tool_use', id: 't', name: 'Read', input: {} },
          { type: 'text', text: 'Found it.' },
          { type: 'text', text: 'Fixed.' },
        ],
      },
    ];
    expect(claudeMessagesToMessages(messages)).toEqual([
      { role: 'user', content: 'fix the bug', timestamp: new Date(0).toISOString() },
      { role: 'assistant', content: 'Found it.\nFixed.' },
    ]);
  });
});

describe('plainToMessages and normalizeAlternation', () => {
  it('drops system rows, merges same-role runs, and never starts with the assistant', () => {
    const rows = plainToMessages([
      { role: 'assistant', content: 'greeting' },
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two', timestamp: 1000 },
      { role: 'assistant', content: 'three' },
    ]);
    expect(rows.map((r) => r.role)).toEqual(['assistant', 'user', 'user', 'assistant']);
    expect(rows[2].timestamp).toBe(new Date(1000).toISOString());
    expect(normalizeAlternation(rows)).toEqual([
      { role: 'user', content: 'one\n\ntwo', timestamp: undefined },
      { role: 'assistant', content: 'three', timestamp: undefined },
    ]);
  });
});

describe('renderForkContext', () => {
  it('labels roles and wraps the transcript with framing text', () => {
    const text = renderForkContext([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ], 'Codex · demo');
    expect(text).toContain('continued from "Codex · demo"');
    expect(text).toContain('User:\na');
    expect(text).toContain('Assistant:\nb');
    expect(text.endsWith('Continue from here as the assistant.]')).toBe(true);
  });

  it('keeps the newest messages and reports how many were dropped', () => {
    const transcript = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: `m${i}-${'x'.repeat(100)}`,
    }));
    const text = renderForkContext(transcript, 'src', 350);
    expect(text).toContain('m9-');
    expect(text).not.toContain('m0-');
    expect(text).toMatch(/oldest \d+ messages were omitted/);
    // Always keeps at least the newest message even if it exceeds the cap.
    expect(renderForkContext([{ role: 'user', content: 'y'.repeat(50) }], 'src', 10)).toContain('y'.repeat(50));
  });

  it('unpacks an older preamble back into turns so a fork of a fork keeps its history', () => {
    const preamble = renderForkContext([
      { role: 'user', content: 'old question\nwith two lines' },
      { role: 'assistant', content: 'old answer' },
    ], 'src');
    const wire = `${preamble}\n\nnew question`;
    expect(stripForkPreamble(wire)).toBe('new question');
    expect(stripForkPreamble('plain text')).toBe('plain text');
    expect(codexItemsToMessages([{ id: '1', type: 'userMessage', content: [{ type: 'text', text: wire }] }])).toEqual([
      { role: 'user', content: 'old question\nwith two lines' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'new question' },
    ]);
    // The boilerplate an earlier build appended after the preamble is dropped.
    const bootstrap = `${preamble}\n\nThe conversation above was forked from another panel. Reply with one short line.`;
    expect(plainToMessages([{ role: 'user', content: bootstrap }]).map((m) => m.content)).toEqual([
      'old question\nwith two lines', 'old answer',
    ]);
  });
});
