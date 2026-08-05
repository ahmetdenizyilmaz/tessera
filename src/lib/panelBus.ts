/**
 * Panel bus — the frontend half of cross-panel messaging.
 *
 * Rust owns routing, delivery and turn detection (a webview's timers get
 * throttled to 1/s in an occluded window, so nothing that has to *wait* can
 * live here). This file does exactly two things:
 *
 *   1. Mirrors the panel list into Rust so `list_panels` can answer even when
 *      the window is minimised or a panel's React tree was never mounted.
 *   2. Paints injected messages into the target's transcript.
 *
 * Both subscriptions are installed once from `main.tsx`, at app root — NOT per
 * panel. Panels inside a collapsed group render as a preview and never mount
 * their ChatView, and those are exactly the panels that would otherwise go
 * missing from the roster.
 */
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore } from '../store/layoutStore';
import { useChatStore } from '../store/chatStore';

declare global {
  interface Window {
    __panelInject?: (instanceId: string, text: string) => void;
  }
}

interface PanelInfoPayload {
  id: string;
  name: string;
  cwd: string;
  kind: 'chat' | 'terminal' | 'llm';
  status: string;
  busy: boolean;
  awaiting_user: boolean;
  model: string | null;
  session_id: string | null;
}

const SYNC_DEBOUNCE_MS = 250;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let lastSerialized = '';

function snapshot(): PanelInfoPayload[] {
  const chat = useChatStore.getState().sessions;
  const instances = useInstanceStore.getState().instances;
  // Only panels that actually have a tab. instanceStore accumulates orphans
  // (instances whose panel was closed, and stale entries carried forward by
  // workspace restore), and listing those would bury the real panels in dead
  // entries with duplicate names.
  return useLayoutStore
    .getState()
    .tabOrder.map((id) => instances.get(id))
    .filter((inst): inst is NonNullable<typeof inst> => Boolean(inst))
    .map((inst) => {
      const session = chat.get(inst.id);
      const kind: PanelInfoPayload['kind'] = inst.config.llmConfig
        ? 'llm'
        : inst.config.panelView === 'terminal'
          ? 'terminal'
          : 'chat';
      return {
        id: inst.id,
        name: inst.name,
        cwd: inst.config.cwd,
        kind,
        status: inst.status,
        busy: session?.isStreaming ?? false,
        awaiting_user: (session?.controlRequests?.length ?? 0) > 0,
        model: inst.config.model || null,
        session_id: inst.claudeSessionId || null,
      };
    });
}

function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const panels = snapshot();
    // Skip no-op pushes: chatStore fires on every streamed token.
    const serialized = JSON.stringify(panels);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    invoke('panel_registry_sync', { panels }).catch((err) => {
      console.error('[panelBus] registry sync failed:', err);
    });
  }, SYNC_DEBOUNCE_MS);
}

export function initPanelBus() {
  window.__panelInject = (instanceId: string, text: string) => {
    // Rust has already written this to the target's stdin; this is purely so
    // the person watching that panel sees where the turn came from.
    const store = useChatStore.getState();
    if (!store.sessions.has(instanceId)) {
      // Panel exists but has no UI session yet (collapsed group, never opened).
      // The message is still on its way to the CLI; the transcript will pick it
      // up from the session file when the panel is opened.
      return;
    }
    store.addUserMessage(instanceId, text);
    store.setStreaming(instanceId, true);
  };

  useInstanceStore.subscribe(scheduleSync);
  useLayoutStore.subscribe(scheduleSync);
  useChatStore.subscribe(scheduleSync);
  scheduleSync();
}
