import { useLayoutStore } from '../store/layoutStore';
import { useGroupStore } from '../store/groupStore';
import { usePluginStore } from '../store/pluginStore';
import { useEventBusStore } from '../store/eventBusStore';
import { useLlmChatStore } from '../store/llmChatStore';
import { useChatStore } from '../store/chatStore';
import { useInstanceStore } from '../store/instanceStore';
import { cleanupPty } from '../hooks/usePty';
import { destroyTerminal } from '../hooks/useTerminal';
import { clearTerminalState } from '../components/terminal/XTermView';
import { invoke } from '@tauri-apps/api/core';

/**
 * Shared panel close/cleanup logic used by TabBar and TabItem.
 * Handles resource teardown based on panel type, then removes the panel.
 */
export async function closePanel(id: string): Promise<void> {
  const panelType = useLayoutStore.getState().panelTypes[id];

  if (panelType === 'group') {
    useGroupStore.getState().deleteGroup(id);
  } else if (panelType === 'widget') {
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

  useLayoutStore.getState().removePanel(id);

  // Remove the closed panel from any group that still lists it as a child so
  // no ghost childIds linger (and get persisted)
  const groups = useGroupStore.getState().groups;
  for (const [groupId, group] of groups) {
    if (group.childIds.includes(id)) {
      useGroupStore.getState().removeFromGroup(groupId, id);
    }
  }

  if (panelType !== 'group' && panelType !== 'widget' && panelType !== 'plugin') {
    useInstanceStore.getState().removeInstance(id);
  }
}
