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
import { useGroupStore } from '../store/groupStore';
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
  const ls = useLayoutStore.getState();
  const groups = useGroupStore.getState().groups;

  // Every real panel, not just the current nav level. tabOrder holds only the
  // level being viewed (inside a group it's that group's children; at root the
  // grouped panels are absent), so union it with every group's childIds.
  // Filtering to this set also drops the orphan instances that accumulate in
  // instanceStore. Non-Claude panel types (computer/plugin/widget/group) are
  // excluded — they have no messageable session.
  const realIds = new Set<string>(ls.tabOrder);
  for (const g of groups.values()) for (const c of g.childIds) realIds.add(c);

  const out: PanelInfoPayload[] = [];
  for (const id of realIds) {
    const inst = instances.get(id);
    if (!inst) continue; // group/widget/plugin id, or an orphan — skip
    const session = chat.get(inst.id);
    const kind: PanelInfoPayload['kind'] = inst.config.llmConfig
      ? 'llm'
      : inst.config.panelView === 'terminal'
        ? 'terminal'
        : 'chat';
    out.push({
      id: inst.id,
      name: inst.name,
      cwd: inst.config.cwd,
      kind,
      status: inst.status,
      busy: session?.isStreaming ?? false,
      awaiting_user: (session?.controlRequests?.length ?? 0) > 0,
      model: inst.config.model || null,
      session_id: inst.claudeSessionId || null,
    });
  }
  return out;
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
    // Rust has already written this to the target's stdin; this makes the
    // person watching that panel see where the turn came from.
    const store = useChatStore.getState();
    if (store.sessions.has(instanceId)) {
      store.addUserMessage(instanceId, text);
      store.setStreaming(instanceId, true);
      return;
    }
    // No UI session yet (a panel that was never opened, e.g. in a collapsed
    // group). Don't just drop it: the streamed reply would later create a bare
    // session that then BLOCKS the file reseed, so the panel would open showing
    // an answer with no question and no prior history. Create the session,
    // seed the real history from disk, then append the injected turn.
    const inst = useInstanceStore.getState().instances.get(instanceId);
    if (!inst) return;
    store.initSession(instanceId);
    const sid = inst.claudeSessionId;
    const seedThenAdd = () => {
      useChatStore.getState().addUserMessage(instanceId, text);
      useChatStore.getState().setStreaming(instanceId, true);
    };
    if (sid && inst.config.cwd) {
      invoke<Array<{ role: string; content: string; timestamp?: string | null }>>(
        'session_load_history',
        { sessionId: sid, projectPath: inst.config.cwd },
      )
        .then((items) => {
          if (items && items.length) useChatStore.getState().seedHistory(instanceId, items);
        })
        .catch(() => {})
        .finally(seedThenAdd);
    } else {
      seedThenAdd();
    }
  };

  useInstanceStore.subscribe(scheduleSync);
  useLayoutStore.subscribe(scheduleSync);
  useChatStore.subscribe(scheduleSync);
  scheduleSync();
}
