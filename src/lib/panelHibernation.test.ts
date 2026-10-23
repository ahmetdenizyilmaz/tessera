import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useChatStore } from '../store/chatStore';
import { usePanelHibernationStore } from '../store/panelHibernationStore';
import { hibernatePanel, wakePanel } from './panelHibernation';
import { cleanupPty, markFreshMount } from '../hooks/usePty';
import { clearTerminalState } from '../components/terminal/XTermView';
import { stopOpenCodeWatch } from './opencodeBridge';
import { stopAntigravityWatch } from './antigravityBridge';
import type { InstanceConfig } from '../types/instance';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('../hooks/usePty', () => ({ cleanupPty: vi.fn(), markFreshMount: vi.fn() }));
vi.mock('../components/terminal/XTermView', () => ({ clearTerminalState: vi.fn() }));
vi.mock('./opencodeBridge', () => ({ stopOpenCodeWatch: vi.fn() }));
vi.mock('./antigravityBridge', () => ({ stopAntigravityWatch: vi.fn() }));

const config: InstanceConfig = { cwd: 'C:/project', model: 'opus', permissionMode: 'bypassPermissions',
  dangerouslySkipPermissions: true, allowedTools: [], maxBudget: 0, systemPrompt: '', agentMode: false, panelView: 'chat' };
function idlePanel() {
  const id = useInstanceStore.getState().addInstance(config, 'Saved conversation');
  useInstanceStore.getState().updateInstance(id, { status: 'running', claudeSessionId: 'saved-claude-session' });
  useChatStore.getState().initSession(id);
  useChatStore.getState().seedHistory(id, [{ role: 'user', content: 'Keep my work' }, { role: 'assistant', content: 'Saved answer' }]);
  return id;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(invoke).mockResolvedValue(undefined);
  useInstanceStore.setState({ instances: new Map() });
  useChatStore.setState({ sessions: new Map() });
  usePanelHibernationStore.setState({ previews: {}, phases: {}, errors: {} });
});

it('saves content before stopping, frees renderers/watchers, and wakes the exact session without sending a message', async () => {
  const id = idlePanel();
  await hibernatePanel(id);
  expect(invoke).toHaveBeenCalledWith('panel_hibernate', expect.objectContaining({ id, preview: expect.objectContaining({ text: expect.stringContaining('Saved answer') }) }));
  expect(cleanupPty).toHaveBeenCalledWith(id, false);
  expect(clearTerminalState).toHaveBeenCalledWith(id);
  expect(stopOpenCodeWatch).toHaveBeenCalledWith(id); expect(stopAntigravityWatch).toHaveBeenCalledWith(id);
  expect(useChatStore.getState().sessions.has(id)).toBe(false);
  expect(useInstanceStore.getState().instances.get(id)?.hibernation?.sleeping).toBe(true);
  await wakePanel(id);
  expect(invoke).toHaveBeenCalledWith('panel_wake', { id });
  expect(useInstanceStore.getState().instances.get(id)).toMatchObject({ config, claudeSessionId: 'saved-claude-session', status: 'starting', hibernation: { sleeping: false, idleMs: 0 } });
  expect(markFreshMount).toHaveBeenCalledWith(id);
  expect(vi.mocked(invoke).mock.calls.map(c => c[0])).toEqual(['panel_hibernate', 'panel_wake']);
});

it('never kills a busy turn or a pending approval', async () => {
  const id = idlePanel();
  useChatStore.getState().setStreaming(id, true);
  await expect(hibernatePanel(id)).rejects.toThrow('current turn');
  expect(invoke).not.toHaveBeenCalled();
  expect(useChatStore.getState().sessions.has(id)).toBe(true);
});

it('keeps the live UI and history if native saving/cleanup fails', async () => {
  const id = idlePanel();
  vi.mocked(invoke).mockRejectedValueOnce(new Error('Disk is full'));
  await expect(hibernatePanel(id)).rejects.toThrow('Disk is full');
  expect(useInstanceStore.getState().instances.get(id)?.hibernation?.sleeping).not.toBe(true);
  expect(useChatStore.getState().sessions.has(id)).toBe(true);
  expect(cleanupPty).not.toHaveBeenCalled();
  expect(usePanelHibernationStore.getState().errors[id]).toBe('Disk is full');
});

it('deduplicates sleep requests and does not resurrect a panel closed during IPC', async () => {
  const id = idlePanel();
  let finish!: () => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = hibernatePanel(id), second = hibernatePanel(id);
  expect(first).toBe(second);
  await Promise.resolve();
  useInstanceStore.getState().removeInstance(id);
  finish(); await first;
  expect(useInstanceStore.getState().instances.has(id)).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('keeps sleeping on a failed wake so the user can retry', async () => {
  const id = idlePanel(); await hibernatePanel(id);
  vi.mocked(invoke).mockRejectedValueOnce(new Error('Temporarily unavailable'));
  await expect(wakePanel(id)).rejects.toThrow('Temporarily unavailable');
  expect(useInstanceStore.getState().instances.get(id)?.hibernation?.sleeping).toBe(true);
  await wakePanel(id);
  expect(useInstanceStore.getState().instances.get(id)?.hibernation?.sleeping).toBe(false);
});
