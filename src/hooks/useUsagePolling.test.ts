import { expect, it } from 'vitest';
import { usageSource } from './useUsagePolling';

const base = { cwd: 'C:/p', agentProvider: undefined as string | undefined, panelView: 'chat' as string | undefined };

it('reads each panel from the source that actually knows its usage', () => {
  expect(usageSource({ config: base, claudeSessionId: 'c1' })).toEqual({ command: 'session_parse_usage', args: { sessionId: 'c1', projectPath: 'C:/p' }, provider: 'claude' });
  expect(usageSource({ config: { ...base, agentProvider: 'codex' }, codexThreadId: 't1' })).toEqual({ command: 'activity_session_usage', args: { provider: 'codex', sessionId: 't1' }, provider: 'codex' });
  expect(usageSource({ config: { ...base, agentProvider: 'antigravity' }, antigravityConversationId: 'a1' })).toEqual({ command: 'activity_session_usage', args: { provider: 'antigravity', sessionId: 'a1' }, provider: 'antigravity' });
});

it('leaves out panels that report nothing instead of showing zero', () => {
  expect(usageSource({ config: base })).toBeNull();
  expect(usageSource({ config: { ...base, agentProvider: 'antigravity', panelView: 'terminal' }, antigravityConversationId: 'a1' })).toBeNull();
  expect(usageSource({ config: { ...base, agentProvider: 'opencode' } })).toBeNull();
  expect(usageSource({ config: { ...base, llmConfig: {} }, claudeSessionId: 'c1' })).toBeNull();
  expect(usageSource({ config: { ...base, agentProvider: 'codex' } })).toBeNull();
});
