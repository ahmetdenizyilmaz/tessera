import { expect, it } from 'vitest';
import { remoteMessages } from './remoteConversation';

it('reads Codex turn items and Claude messages as conversation text', () => {
  expect(remoteMessages([
    { id: 'turn', items: [
      { type: 'userMessage', content: [{ type: 'text', text: 'Where is my work?' }] },
      { type: 'commandExecution', command: 'private command', aggregatedOutput: 'tool detail' },
      { type: 'reasoning', text: 'not a conversation message' },
      { type: 'agentMessage', text: 'Your files are still here.' },
    ] },
    { role: 'user', content: 'And Claude?' },
    { role: 'assistant', content: [{ type: 'text', text: 'Here too.' }], timestamp: '2026-10-19' },
  ])).toEqual([
    { role: 'user', content: 'Where is my work?', timestamp: null },
    { role: 'assistant', content: 'Your files are still here.', timestamp: null },
    { role: 'user', content: 'And Claude?', timestamp: null },
    { role: 'assistant', content: 'Here too.', timestamp: '2026-10-19' },
  ]);
});
it('bounds the flattened tail and ignores malformed provider entries', () => {
  expect(remoteMessages(null)).toEqual([]);
  expect(remoteMessages([null, {}, { content: { privateMetadata: 'hidden' } }])).toEqual([]);
  const result = remoteMessages([{ items: Array.from({ length: 150 }, (_, i) => ({ type: 'agentMessage', text: `Message ${i}` })) }]);
  expect(result).toHaveLength(100); expect(result[0].content).toBe('Message 50');
});
