import { useCodexStore } from '../store/codexStore';
import { useLayoutStore } from '../store/layoutStore';
import { captureGroupSnapshot, removePanelsFromWorkspace, useGroupStore } from '../store/groupStore';
import { usePluginStore } from '../store/pluginStore';
import { useEventBusStore } from '../store/eventBusStore';
import { useLlmChatStore } from '../store/llmChatStore';
import { useChatStore } from '../store/chatStore';
import { useInstanceStore } from '../store/instanceStore';
import { cleanupPty } from '../hooks/usePty';
import { destroyTerminal } from '../hooks/useTerminal';
import { clearTerminalState } from '../components/terminal/XTermView';
import { invoke } from '@tauri-apps/api/core';
import { closeRemoteGroup, closeRemotePanel, splitRemotePanelId } from '../store/lanStore';

const closing = new Set<string>();

/**
 * Shared panel close/cleanup logic used by TabBar and TabItem.
 * Handles resource teardown based on panel type, then removes the panel.
 */
export async function closePanel(id: string): Promise<void> {
  if (closing.has(id)) return;
  closing.add(id);
  try { await closePanelContents(id); }
  finally { closing.delete(id); }
}

async function closePanelContents(id: string): Promise<void> {
  // Remote tiles belong only to this viewer; never run local or remote teardown.
  // Check the qualified ID too, in case restore has not populated panelTypes yet.
  if (splitRemotePanelId(id)) {
    closeRemotePanel(id);
    return;
  }
  const group = useGroupStore.getState().groups.get(id);
  if (group?.remotePeerId) {
    closeRemoteGroup(group.remotePeerId);
    return;
  }
  const panelType = useLayoutStore.getState().panelTypes[id];
  if (group || panelType === 'group') {
    // Include live children and saved ancestors before leaving an open subtree.
    const snapshot = captureGroupSnapshot();
    useGroupStore.setState({ groups: snapshot.groups });
    if (group && useGroupStore.getState().groupStack.includes(id)) {
      useGroupStore.getState().jumpToLevel(group.parentId);
    }
    for (const childId of snapshot.groups.get(id)?.childIds ?? []) await closePanel(childId);
    removePanelsFromWorkspace([id]);
    return;
  }
  if (useInstanceStore.getState().instances.get(id)?.config.agentProvider === 'codex') {
    await invoke('codex_close', { id }).catch(() => {});
    useCodexStore.getState().remove(id);
  }
  if (panelType === 'widget') {
    // Nothing special for widgets
  } else if (panelType === 'plugin') {
    usePluginStore.getState().destroyInstance(id);
    useEventBusStore.getState().cleanupInstance(id);
  } else if (panelType === 'llm') {
    try {
      await invoke('llm_destroy_session', { id });
    } catch {
      // Session may not exist
    }
    useLlmChatStore.getState().removeConversation(id);
  } else {
    // terminal / computer / default
    clearTerminalState(id);
    cleanupPty(id);
    destroyTerminal(id);
    try {
      await invoke('pty_kill', { id });
    } catch {
      // PTY may already be dead
    }
    try {
      await invoke('stream_kill', { id });
    } catch {
      // Stream may already be dead
    }
    // Drop the in-memory transcript + accumulator; otherwise every closed chat
    // panel's messages stay in chatStore for the life of the app.
    useChatStore.getState().destroySession(id);
  }

  removePanelsFromWorkspace([id]);

  if (panelType !== 'widget' && panelType !== 'plugin') {
    useInstanceStore.getState().removeInstance(id);
  }
}
