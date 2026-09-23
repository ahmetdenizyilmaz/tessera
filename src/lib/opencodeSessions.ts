import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore, canAddPanel, notifyPanelLimit } from '../store/layoutStore';
import { useGroupStore } from '../store/groupStore';
import { useSettingsStore } from '../store/settingsStore';
import { ensureOpenCode, stopOpenCodeWatch } from './opencodeBridge';
import { applyForkToInstance } from './forkActions';
import { cleanupPty } from '../hooks/usePty';
import { clearTerminalState } from '../components/terminal/XTermView';
import type { OpenCodeOptions } from '../types/opencode';

export async function openOpenCodeSession(options: OpenCodeOptions, cwd: string, panelView: 'chat' | 'terminal', wizardId?: string): Promise<string> {
  if (!wizardId && !canAddPanel()) { notifyPanelLimit(); throw new Error('Panel limit reached'); }
  const store = useInstanceStore.getState();
  const group = useGroupStore.getState().getCurrentGroupId();
  const id = store.addInstance({ agentProvider: 'opencode', opencode: { ...options }, model: options.model, cwd, panelView,
    systemPrompt: '', dangerouslySkipPermissions: false, permissionMode: 'default', allowedTools: [], maxBudget: 0, agentMode: false,
  }, `OpenCode · ${options.model.split('/').pop()}`);
  store.updateInstance(id, { opencodeDataId: crypto.randomUUID() });
  try {
    await ensureOpenCode(id);
    if (wizardId && !useLayoutStore.getState().panelTypes[wizardId]) throw new Error('Panel creation was cancelled.');
    if (!wizardId && !canAddPanel()) throw new Error('Panel limit reached');
  } catch (e) {
    stopOpenCodeWatch(id);
    store.removeInstance(id);
    await invoke('opencode_close', { id }).catch(() => {});
    throw e;
  }
  // Do not consume the wizard's fork until CLI/key/startup validation succeeds.
  // The mounted panel seeds this pending context through ensureOpenCode, and a
  // transient import failure stays retryable on that panel instead of losing it.
  await applyForkToInstance(id);
  if (wizardId) useLayoutStore.getState().removePanel(wizardId);
  useLayoutStore.getState().addPanel(id);
  if (group) useGroupStore.getState().addToGroup(group, id);
  useSettingsStore.getState().updateSettings({ lastCwd: cwd, lastPanelView: panelView,
    lastSessionPreset: { kind: 'opencode', opencode: { ...options }, model: options.model, cwd, panelView } });
  return id;
}
export async function restartOpenCode(id: string): Promise<void> {
  stopOpenCodeWatch(id);
  useInstanceStore.getState().setStatus(id, 'starting');
  await invoke('pty_kill', { id }).catch(() => {});
  cleanupPty(id, false);
  clearTerminalState(id);
  await invoke('opencode_close', { id });
  await ensureOpenCode(id);
}
