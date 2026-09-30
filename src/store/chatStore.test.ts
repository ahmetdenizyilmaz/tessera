import { beforeEach, expect, it } from 'vitest';
import { useChatStore } from './chatStore';
import { claudeSignal } from '../lib/officeActivity';
import type { StreamEvent } from '../types/stream';

const send = (event: StreamEvent) => useChatStore.getState().processEvent('agent', event);
const session = () => useChatStore.getState().sessions.get('agent')!;
beforeEach(() => { useChatStore.setState({ sessions: new Map() }); useChatStore.getState().initSession('agent'); });

it('keeps Claude busy between a streamed tool message and its turn result', () => {
  useChatStore.getState().addUserMessage('agent', 'Run the slow test suite');
  send({ type: 'message_start', message: { id: 'm1', role: 'assistant', model: 'claude' } });
  send({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool', name: 'Bash' } });
  send({ type: 'content_block_stop', index: 0 });
  send({ type: 'message_delta', delta: { stop_reason: 'tool_use' } });
  send({ type: 'message_stop' });
  expect(session().isStreaming).toBe(true);
  expect(claudeSignal(session()).activity).toBe('running_command');
  send({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool', content: 'Tests passed' }] } });
  expect(session().isStreaming).toBe(true);
  send({ type: 'message_start', message: { id: 'm2', role: 'assistant', model: 'claude' } });
  send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'The tests passed.' } });
  send({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
  send({ type: 'message_stop' });
  expect(session().isStreaming).toBe(true);
  send({ type: 'result', subtype: 'success' });
  expect(claudeSignal(session()).activity).toBe('idle');
});

it('recognizes complete-message activity without partial events and stops on failure', () => {
  send({ type: 'assistant', message: { id: 'm1', role: 'assistant', model: 'claude', content: [{ type: 'text', text: 'Working.' }] } });
  expect(session().isStreaming).toBe(true);
  send({ type: 'result', subtype: 'error_during_execution', is_error: true });
  expect(session().isStreaming).toBe(false);
  expect(claudeSignal(session()).activity).toBe('error');
});

it('does not turn restored history into live work, or revive a finished turn on duplicate message_stop', () => {
  useChatStore.getState().seedHistory('agent', [{ role: 'assistant', content: 'Previous answer' }]);
  expect(session().isStreaming).toBe(false);
  send({ type: 'message_stop' });
  expect(session().isStreaming).toBe(false);
});
