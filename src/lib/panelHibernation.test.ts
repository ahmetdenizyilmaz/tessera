import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useChatStore } from '../store/chatStore';
import { usePanelHibernationStore } from '../store/panelHibernationStore';
import { hibernatePanel, hibernateUnusedPanels, idlePanelIds, wakePanel } from './panelHibernation';
import { forgetPanelActivity, noteTerminalInput, setPanelViewed, touchPanel } from './panelActivityClock';
import { setPanelDraftProtection } from '../hooks/usePanelDraft';
import { useLayoutStore } from '../store/layoutStore';
import { useSettingsStore } from '../store/settingsStore';
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
  for (const id of useInstanceStore.getState().instances.keys()) forgetPanelActivity(id);
  useInstanceStore.setState({ instances: new Map() });
  useChatStore.setState({ sessions: new Map() });
  usePanelHibernationStore.setState({ previews: {}, phases: {}, errors: {} });
  useLayoutStore.setState({ panelTypes: {} });
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

function oldPanel(minutes = 30) {
  const id = idlePanel();
  useInstanceStore.getState().updateInstance(id, { hibernation: { sleeping: false, idleMs: minutes * 60_000 } });
  return id;
}

it('bulk hibernation uses a 30-minute threshold even when automatic hibernation is disabled', async () => {
  useSettingsStore.setState(s => ({ settings: { ...s.settings, panelHibernationMinutes: 0 } }));
  const fresh = oldPanel(29.999), eligible = oldPanel();
  expect(idlePanelIds()).toEqual([eligible]);
  expect(await hibernateUnusedPanels()).toEqual({ hibernated: 1, skipped: 0, failed: 0 });
  expect(useInstanceStore.getState().instances.get(fresh)?.hibernation?.sleeping).toBe(false);
  expect(useSettingsStore.getState().settings.panelHibernationMinutes).toBe(0);
});

it('bulk cleanup protects tasks, focus, drafts, unknown activity and non-agent panels', async () => {
  const busy = oldPanel(); useChatStore.getState().setStreaming(busy, true);
  const focused = oldPanel(); setPanelViewed(focused, true);
  const starting = oldPanel(); useInstanceStore.getState().setStatus(starting, 'starting');
  const draft = oldPanel(); setPanelDraftProtection(draft, true);
  const terminalDraft = oldPanel(); noteTerminalInput(terminalDraft, 'unsent');
  // Seed an old timer too: the draft itself must protect the panel.
  useInstanceStore.getState().updateInstance(terminalDraft, { hibernation: { sleeping: false, idleMs: 3600_000 } });
  const sleeping = oldPanel(); useInstanceStore.getState().updateInstance(sleeping, { hibernation: { sleeping: true, idleMs: 3600_000 } });
  const waking = oldPanel(); usePanelHibernationStore.setState({ phases: { [waking]: 'waking' } });
  const unknown = oldPanel(); useChatStore.getState().destroySession(unknown);
  const remote = oldPanel(); useLayoutStore.setState({ panelTypes: { [remote]: 'remote' } });
  const api = oldPanel(); useInstanceStore.getState().updateInstance(api, { config: { ...config,
    llmConfig: { provider: 'openrouter', model: 'test', systemPrompt: '' } } });
  const eligible = oldPanel();
  expect(idlePanelIds()).toEqual([eligible]);
  await hibernateUnusedPanels();
  expect(vi.mocked(invoke).mock.calls.filter(c => c[0] === 'panel_hibernate').map(c => c[1])).toEqual([
    expect.objectContaining({ id: eligible }),
  ]);
});

it('immediately resets old idle time on interaction and a brief focus, without waiting for the timer', async () => {
  const touched = oldPanel(), brieflyFocused = oldPanel();
  touchPanel(touched);
  setPanelViewed(brieflyFocused, true); setPanelViewed(brieflyFocused, false);
  expect(idlePanelIds()).toEqual([]);
  expect(await hibernateUnusedPanels()).toEqual({ hibernated: 0, skipped: 0, failed: 0 });
  expect(invoke).not.toHaveBeenCalled();
  expect(useInstanceStore.getState().instances.get(touched)?.hibernation?.idleMs).toBe(0);
});

it('rechecks queued panels when new activity arrives and deduplicates repeated bulk clicks', async () => {
  const firstId = oldPanel(), touched = oldPanel(), busy = oldPanel();
  let finish!: () => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = hibernateUnusedPanels(), second = hibernateUnusedPanels();
  expect(second).toBe(first);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  touchPanel(touched); useChatStore.getState().setStreaming(busy, true);
  finish();
  expect(await first).toEqual({ hibernated: 1, skipped: 2, failed: 0 });
  expect(invoke).toHaveBeenCalledWith('panel_hibernate', expect.objectContaining({ id: firstId }));
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('keeps failed panels alive, continues the batch and permits a retry', async () => {
  const failed = oldPanel(), success = oldPanel();
  vi.mocked(invoke).mockRejectedValueOnce(new Error('Preview could not be saved'));
  expect(await hibernateUnusedPanels()).toEqual({ hibernated: 1, skipped: 0, failed: 1 });
  expect(useInstanceStore.getState().instances.get(failed)?.hibernation?.sleeping).toBe(false);
  expect(useInstanceStore.getState().instances.get(success)?.hibernation?.sleeping).toBe(true);
  expect(await hibernateUnusedPanels()).toEqual({ hibernated: 1, skipped: 0, failed: 0 });
});
