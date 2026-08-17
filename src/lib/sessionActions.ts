/**
 * Repair actions for a panel's Claude session, reachable from the tab's
 * right-click menu.
 *
 * These exist because a panel can end up pinned to the wrong conversation —
 * the pre-pinning builds guessed ids from the filesystem — and the only fix
 * used to be closing the panel and rebuilding it by hand.
 *
 * Both actions kill the panel's process and re-point it; the panel itself is
 * untouched (name, color, layout slot, group membership all stay).
 */
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useChatStore } from '../store/chatStore';
import { useEventBusStore } from '../store/eventBusStore';
import { isPtySpawned, restartPty } from '../hooks/usePty';
import { findOpenPanelBySession } from './openSession';
import { notify } from './toast';

function panelKind(instanceId: string): 'chat' | 'terminal' | null {
  const inst = useInstanceStore.getState().instances.get(instanceId);
  if (!inst || inst.config.llmConfig) return null;
  return inst.config.panelView === 'terminal' ? 'terminal' : 'chat';
}

/** True for panels that host a Claude session (not LLM/plugin/widget/group). */
export function isClaudePanel(instanceId: string): boolean {
  return panelKind(instanceId) !== null;
}

/**
 * Drop the panel's session and start an empty conversation in the same
 * folder. The chat path is exactly what typing /clear does.
 */
export async function startFreshSession(instanceId: string): Promise<void> {
  const kind = panelKind(instanceId);
  if (!kind) return;

  if (kind === 'chat') {
    try {
      await invoke('stream_clear', { id: instanceId });
    } catch (err) {
      console.error(`[sessionActions] stream_clear failed for ${instanceId}:`, err);
    }
    useChatStore.getState().reset(instanceId);
    useInstanceStore.getState().setClaudeSessionId(instanceId, '');
  } else {
    // Clear the pin first: usePty.spawn mints a new uuid when none is set.
    useInstanceStore.getState().setClaudeSessionId(instanceId, '');
    if (isPtySpawned(instanceId)) {
      await restartPty(instanceId);
    }
    // TerminalPanel listens and remounts its XTermView, which respawns.
    useEventBusStore.getState().dispatch('panel:restart', { instanceId }, instanceId);
  }
  notify('Started a fresh session.');
}

/**
 * Re-point the panel at an existing conversation (same or different folder).
 * Refuses ids already open elsewhere — two panels on one session file rewind
 * and interleave each other.
 */
export async function switchSession(
  instanceId: string,
  target: { sessionId: string; project: string },
): Promise<void> {
  const kind = panelKind(instanceId);
  if (!kind) return;

  const holder = findOpenPanelBySession(target.sessionId);
  if (holder && holder !== instanceId) {
    const name = useInstanceStore.getState().instances.get(holder)?.name ?? 'another panel';
    notify(`That conversation is already open in "${name}".`);
    return;
  }

  const inst = useInstanceStore.getState().instances.get(instanceId);
  if (!inst) return;

  // The session file lives under its project's directory — the panel must
  // follow it or the resume cannot find the JSONL.
  const cwd = target.project;

  if (kind === 'chat') {
    // Kill the old process and its Rust-side entry, then register a fresh
    // config carrying the new id. The next send resumes it; ChatView's
    // transcript-restore effect reseeds the visible history from the file.
    try {
      await invoke('stream_kill', { id: instanceId });
    } catch (err) {
      console.error(`[sessionActions] stream_kill failed for ${instanceId}:`, err);
    }
    useChatStore.getState().reset(instanceId);
    useInstanceStore.getState().updateInstance(instanceId, {
      config: { ...inst.config, cwd },
    });
    useInstanceStore.getState().setClaudeSessionId(instanceId, target.sessionId);
    try {
      await invoke('stream_configure', {
        id: instanceId,
        cwd,
        model: inst.config.model || null,
        systemPrompt: inst.config.systemPrompt || null,
        sessionId: target.sessionId,
        mcpConfigPath: null,
        permissionMode: inst.config.permissionMode || null,
        allowedTools: inst.config.allowedTools.length > 0 ? inst.config.allowedTools : null,
        dangerouslySkipPermissions: inst.config.dangerouslySkipPermissions,
      });
    } catch (err) {
      console.error(`[sessionActions] stream_configure failed for ${instanceId}:`, err);
    }
  } else {
    useInstanceStore.getState().updateInstance(instanceId, {
      config: { ...inst.config, cwd },
    });
    useInstanceStore.getState().setClaudeSessionId(instanceId, target.sessionId);
    if (isPtySpawned(instanceId)) {
      await restartPty(instanceId);
    }
    useEventBusStore.getState().dispatch('panel:restart', { instanceId }, instanceId);
  }
  notify('Switched — the panel now continues that conversation.');
}
