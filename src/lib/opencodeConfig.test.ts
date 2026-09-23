import { expect, it } from 'vitest';
import { DEFAULT_OPENCODE_OPTIONS, openCodeEndpoint, openCodeKeySlot, openCodeTranscript } from './opencodeConfig';
it('normalizes local roots without duplicating API paths', () => {
  expect(openCodeEndpoint('ollama', '')).toBe('http://127.0.0.1:11434/v1');
  expect(openCodeEndpoint('lmstudio', 'http://localhost:1234/')).toBe('http://localhost:1234/v1');
  expect(openCodeEndpoint('custom', 'https://server.example/api/v1/')).toBe('https://server.example/api/v1');
});
it('does not accept credential-bearing or non-HTTP endpoints in saved settings', () => {
  for (const url of ['file:///tmp/test', 'https://key@server.example', 'http://localhost?key=secret', 'http://localhost#secret']) expect(() => openCodeEndpoint('custom', url)).toThrow();
});
it('reuses cloud credentials but isolates compatible-server keys by endpoint', () => {
  expect(openCodeKeySlot(DEFAULT_OPENCODE_OPTIONS)).toBe('openrouter');
  expect(openCodeKeySlot({ ...DEFAULT_OPENCODE_OPTIONS, provider: 'gemini' })).toBe('gemini');
  expect(openCodeKeySlot({ ...DEFAULT_OPENCODE_OPTIONS, provider: 'custom', baseUrl: 'https://server.example/v1' })).toBe('opencode:https://server.example/v1');
});
it('exports conversation text without treating tool output or reasoning as a user message', () => {
  expect(openCodeTranscript([{ info: { id: 'one', role: 'assistant' }, parts: [{ id: 'p', type: 'text', text: 'Answer' }, { id: 'tool', type: 'tool', text: 'internal' }] }])).toEqual([{ role: 'assistant', content: 'Answer' }]);
});
