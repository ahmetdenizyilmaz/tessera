import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore, canAddPanel, notifyPanelLimit } from '../store/layoutStore';
import { useGroupStore } from '../store/groupStore';
import { useSettingsStore } from '../store/settingsStore';
import { useAntigravityStore } from '../store/antigravityStore';
import { ensureAntigravity, refreshAntigravity, stopAntigravityWatch } from './antigravityBridge';
import { antigravityModelLabel } from './antigravityConfig';
import { applyForkToInstance, markForkConsumed, takeForkOpeningMessage } from './forkActions';
import { renderForkContext } from './forkTranscript';
import { cleanupPty } from '../hooks/usePty';
import { clearTerminalState } from '../components/terminal/XTermView';
import type { AntigravityOptions } from '../types/antigravity';

/** Windows command lines are capped at 32 KB; the fork context rides on one argument. */
const TERMINAL_PROMPT_MAX_CHARS = 12_000;

export async function openAntigravitySession(options: AntigravityOptions, cwd: string, panelView: 'chat' | 'terminal', wizardId?: string): Promise<string> {
  if (!wizardId && !canAddPanel()) { notifyPanelLimit(); throw new Error('Panel limit reached'); }
  const store = useInstanceStore.getState();
  const group = useGroupStore.getState().getCurrentGroupId();
  const id = store.addInstance({ agentProvider: 'antigravity', antigravity: { ...options }, model: options.model, cwd, panelView,
    systemPrompt: '', dangerouslySkipPermissions: false, permissionMode: 'default', allowedTools: [], maxBudget: 0, agentMode: false,
  }, `Antigravity · ${antigravityModelLabel(options.model)}`);
  store.updateInstance(id, { antigravityDataId: crypto.randomUUID() });
  try {
    // Chat: start agy now, so a missing CLI, sign-in or model is reported here in
    // the wizard and the panel owns an exact conversation ID before its first turn.
    // Terminal: the native TUI is also where sign-in happens, so it starts on mount.
    await ensureAntigravity(id, panelView === 'chat');
    if (wizardId && !useLayoutStore.getState().panelTypes[wizardId]) throw new Error('Panel creation was cancelled.');
    if (!wizardId && !canAddPanel()) throw new Error('Panel limit reached');
  } catch (e) {
    stopAntigravityWatch(id);
    store.removeInstance(id);
    await invoke('antigravity_close', { id }).catch(() => {});
    throw e;
  }
  await applyForkToInstance(id);
  if (wizardId) useLayoutStore.getState().removePanel(wizardId);
  useLayoutStore.getState().addPanel(id);
  if (group) useGroupStore.getState().addToGroup(group, id);
  useSettingsStore.getState().updateSettings({ lastCwd: cwd, lastPanelView: panelView,
    lastSessionPreset: { kind: 'antigravity', antigravity: { ...options }, model: options.model, cwd, panelView } });
  return id;
}

/** Stop this panel's processes and register it again. The conversation is resumed by ID. */
export async function restartAntigravity(id: string): Promise<void> {
  stopAntigravityWatch(id);
  const terminal = useInstanceStore.getState().instances.get(id)?.config.panelView === 'terminal';
  if (terminal) useInstanceStore.getState().setStatus(id, 'starting');
  await invoke('pty_kill', { id }).catch(() => {});
  cleanupPty(id, false);
  clearTerminalState(id);
  await invoke('antigravity_close', { id });
  await ensureAntigravity(id);
}

/** Recovery when the saved conversation does not exist on this PC. */
export async function newAntigravityConversation(id: string): Promise<void> {
  await invoke('antigravity_new_conversation', { id });
  useInstanceStore.getState().updateInstance(id, { antigravityConversationId: undefined });
  useAntigravityStore.getState().error(id, undefined);
  await refreshAntigravity(id, true);
}

/** A forked terminal has no composer to carry its inherited conversation, so it
 *  starts agy with `--prompt-interactive`. Returns null for an ordinary terminal. */
export function takeTerminalForkPrompt(id: string): string | null {
  const fork = useInstanceStore.getState().instances.get(id)?.config.fork;
  if (!fork) return null;
  const context = fork.pending ? renderForkContext(fork.transcript, fork.sourceName, TERMINAL_PROMPT_MAX_CHARS) : '';
  const opening = takeForkOpeningMessage(id) ?? '';
  if (context) markForkConsumed(id);
  if (!context && !opening) return null;
  return [context, opening || (context ? 'This is the conversation so far. Reply briefly that you have the context, then wait for my next instruction.' : '')].filter(Boolean).join('\n\n');
}
