import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { initPanelBus, snapshot } from './panelBus';
import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore } from '../store/layoutStore';
import { useGroupStore } from '../store/groupStore';
import { useChatStore } from '../store/chatStore';
import type { InstanceConfig } from '../types/instance';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
const config: InstanceConfig = { cwd: 'C:/test', model: 'test', systemPrompt: '', permissionMode: 'default',
  dangerouslySkipPermissions: false, allowedTools: [], maxBudget: 0, agentMode: false, panelView: 'terminal' };
let cleanup: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('window', {});
  useInstanceStore.setState({ instances: new Map() });
  useLayoutStore.setState({ tabOrder: [], panelTypes: {}, panelRects: new Map(), layoutConfig: null, activeTabId: null, focusedId: null });
  useGroupStore.getState().restoreGroups(new Map());
  useGroupStore.setState({ groups: new Map() });
  cleanup = initPanelBus();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const add = (name: string, view: 'terminal' | 'chat' = 'terminal', provider: 'claude' | 'codex' = 'claude') => {
  const id = useInstanceStore.getState().addInstance({ ...config, panelView: view, agentProvider: provider }, name);
  useLayoutStore.getState().addPanel(id);
  return id;
};

it('publishes every root and grouped panel with its true view while navigating nested groups', () => {
  const root = add('Root terminal');
  const group = useGroupStore.getState().createGroup(null);
  useLayoutStore.getState().addPanel(group, 'group');
  useGroupStore.getState().enterGroup(group);
  useGroupStore.getState().commitEnterGroup();
  const child = add('Codex terminal', 'terminal', 'codex');
  const nested = useGroupStore.getState().createGroup(group);
  useLayoutStore.getState().addPanel(nested, 'group');
  useGroupStore.getState().enterGroup(nested);
  useGroupStore.getState().commitEnterGroup();
  const chat = add('Chat', 'chat');
  useInstanceStore.getState().addInstance(config, 'Orphan');
  expect(snapshot().map(p => p.id).sort()).toEqual([root, child, chat].sort());
  expect(snapshot().find(p => p.id === child)).toMatchObject({ kind: 'terminal', provider: 'codex' });
  expect(snapshot().find(p => p.id === chat)?.kind).toBe('chat');
});

it('publishes within 250ms even while chat tokens arrive continuously', async () => {
  add('Busy host');
  for (let i = 0; i < 10; i++) {
    useChatStore.setState({ sessions: new Map() });
    await vi.advanceTimersByTimeAsync(50);
  }
  expect(invoke).toHaveBeenCalledWith('panel_registry_sync', { panels: snapshot() });
});

it('retries a failed push without requiring another store change', async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error('temporary IPC failure'));
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  add('Retry');
  await vi.advanceTimersByTimeAsync(1250);
  expect(vi.mocked(invoke).mock.calls.filter(c => c[0] === 'panel_registry_sync')).toHaveLength(2);
  logged.mockRestore();
});

it('publishes membership changes made only to a collapsed group', async () => {
  const group = useGroupStore.getState().createGroup(null);
  useLayoutStore.getState().addPanel(group, 'group');
  const child = useInstanceStore.getState().addInstance(config, 'Hidden');
  await vi.advanceTimersByTimeAsync(250);
  vi.mocked(invoke).mockClear();
  useGroupStore.getState().addToGroup(group, child);
  await vi.advanceTimersByTimeAsync(250);
  expect(invoke).toHaveBeenCalledWith('panel_registry_sync', { panels: expect.arrayContaining([expect.objectContaining({ id: child })]) });
});
