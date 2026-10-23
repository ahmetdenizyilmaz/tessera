import { beforeEach, expect, it, vi } from 'vitest';
import { useInstanceStore } from '../store/instanceStore';
import { useCodexStore } from '../store/codexStore';
import { useOpenCodeStore } from '../store/opencodeStore';
import { useAntigravityStore } from '../store/antigravityStore';
import { panelWorkState, recordPanelWorkState } from './panelWorkState';
import { ensureCodex } from './codexBridge';
import { ensureOpenCode } from './opencodeBridge';
import { ensureAntigravity } from './antigravityBridge';
import { invoke } from '@tauri-apps/api/core';
import type { AgentProvider } from '../types/codex';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
function panel(provider: AgentProvider, view: 'chat' | 'terminal' = 'terminal') {
  const id = useInstanceStore.getState().addInstance({ agentProvider: provider, panelView: view, cwd: 'C:/work', model: 'model',
    dangerouslySkipPermissions: false, permissionMode: 'auto', allowedTools: [], maxBudget: 0, systemPrompt: '', agentMode: false });
  useInstanceStore.getState().setStatus(id, 'running'); return id;
}
beforeEach(() => { vi.clearAllMocks(); useInstanceStore.setState({ instances: new Map() }); });
it('requires fresh proof of Claude terminal idleness and keeps quiet busy work protected', () => {
  const id = panel('claude');
  expect(panelWorkState(id).knownIdle).toBe(false);
  recordPanelWorkState(id, 'idle', performance.now());
  expect(panelWorkState(id)).toEqual({ busy: false, knownIdle: true });
  recordPanelWorkState(id, 'idle', performance.now() - 60_000);
  expect(panelWorkState(id).knownIdle).toBe(false);
  recordPanelWorkState(id, 'running_command', performance.now() - 60_000);
  expect(panelWorkState(id).busy).toBe(true);
});
it('treats Codex approvals as active even between turns', () => {
  const id = panel('codex');
  useCodexStore.getState().hydrate(id, { generation: 'g', thread: { id: 't', cwd: 'C:/work', updatedAt: 0, turns: [] }, threadId: 't',
    events: [], requests: [{ id: 1, method: 'item/commandExecution/requestApproval', params: {} }], busy: false, alive: true });
  expect(panelWorkState(id).busy).toBe(true);
});
it('protects OpenCode questions and only auto-sleeps Antigravity with structured activity', () => {
  const oc = panel('opencode');
  useOpenCodeStore.getState().receive(oc, { generation: 'g', sessionId: 's', connected: true, messages: [], status: { type: 'idle' },
    permissions: [], questions: [{ id: 'q', sessionID: 's', questions: [] }] });
  expect(panelWorkState(oc).busy).toBe(true);
  const ag = panel('antigravity');
  useAntigravityStore.getState().receive(ag, { generation: 'g', configured: true, processAlive: true, busy: false, items: [], conversationId: 'ag' });
  expect(panelWorkState(ag).knownIdle).toBe(false);
  const inst = useInstanceStore.getState().instances.get(ag)!;
  useInstanceStore.getState().updateInstance(ag, { config: { ...inst.config, panelView: 'chat' } });
  expect(panelWorkState(ag).knownIdle).toBe(true);
});
it('provider background bridges never configure a restored sleeping panel', async () => {
  for (const [provider, ensure] of [['codex', ensureCodex], ['opencode', ensureOpenCode], ['antigravity', ensureAntigravity]] as const) {
    const id = panel(provider);
    useInstanceStore.getState().updateInstance(id, { hibernation: { sleeping: true, idleMs: 3600_000 } });
    await ensure(id);
  }
  expect(invoke).not.toHaveBeenCalled();
});
