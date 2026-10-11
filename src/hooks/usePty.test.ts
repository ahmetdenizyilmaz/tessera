import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { usePty, cleanupPty, restartPty } from './usePty';
import { useInstanceStore } from '../store/instanceStore';

const { listeners } = vi.hoisted(() => ({ listeners: new Map<string, (event: { payload: unknown }) => void>() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name, callback) => {
  listeners.set(name, callback);
  return () => { if (listeners.get(name) === callback) listeners.delete(name); };
}) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('../lib/routingEnv', () => ({ buildRoutingEnv: vi.fn(async () => ({})) }));
vi.mock('../lib/codexBridge', () => ({ ensureCodex: vi.fn() }));
vi.mock('../lib/opencodeBridge', () => ({ ensureOpenCode: vi.fn() }));
vi.mock('../lib/antigravityBridge', () => ({ ensureAntigravity: vi.fn(), refreshAntigravity: vi.fn() }));
vi.mock('../lib/antigravitySessions', () => ({ takeTerminalForkPrompt: vi.fn() }));

const agent = () => useInstanceStore.getState().addInstance({ cwd: 'C:/project', model: 'sonnet',
  systemPrompt: '', permissionMode: 'default', dangerouslySkipPermissions: false,
  allowedTools: [], maxBudget: 0, agentMode: false, panelView: 'terminal' });

afterEach(() => {
  for (const id of useInstanceStore.getState().instances.keys()) cleanupPty(id, false);
  useInstanceStore.setState({ instances: new Map() });
  vi.mocked(invoke).mockReset(); listeners.clear();
});

it('records startup and /resume session IDs before saving, without adopting a neighboring panel', async () => {
  const id = agent(); const neighbor = agent();
  const initial = crypto.randomUUID(); const resumed = crypto.randomUUID();
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'pty_spawn') listeners.get(`pty-claude-session-${id}`)!({ payload: { sessionId: initial } });
    return undefined;
  });
  await usePty(id).spawn(100, 30);
  expect(useInstanceStore.getState().instances.get(id)?.claudeSessionId).toBe(initial);
  listeners.get(`pty-claude-session-${id}`)!({ payload: { sessionId: resumed } });
  expect(useInstanceStore.getState().instances.get(id)?.claudeSessionId).toBe(resumed);
  expect(useInstanceStore.getState().instances.get(neighbor)?.claudeSessionId).toBeUndefined();
});

it('revokes old listeners on restart and tracks /clear in the replacement terminal', async () => {
  const id = agent(); await usePty(id).spawn(100, 30);
  const stale = listeners.get(`pty-claude-session-${id}`)!;
  await restartPty(id);
  await usePty(id).spawn(100, 30);
  const cleared = crypto.randomUUID();
  listeners.get(`pty-claude-session-${id}`)!({ payload: { sessionId: cleared } });
  stale({ payload: { sessionId: crypto.randomUUID() } });
  expect(useInstanceStore.getState().instances.get(id)?.claudeSessionId).toBe(cleared);
  await usePty(id).kill();
  expect(listeners.has(`pty-claude-session-${id}`)).toBe(false);
});
