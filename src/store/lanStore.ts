import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useGroupStore } from './groupStore';
import { computeRects, getDefaultConfig, useLayoutStore } from './layoutStore';

export interface RemotePanelInfo {
  id: string;
  name: string;
  cwd: string;
  kind: string;
  provider: string;
  status: string;
  busy: boolean;
  awaitingUser: boolean;
  model: string | null;
  reachable: boolean;
}

export interface LanPeerState {
  deviceId: string;
  name: string;
  address: string;
  connected: boolean;
  panels: RemotePanelInfo[];
}

export interface LanStatus {
  sharing: boolean;
  deviceId: string;
  name: string;
  port: number;
  addresses: string[];
  peers: LanPeerState[];
}

interface LanStoreState {
  status: LanStatus | null;
  error: string | null;
  setStatus: (status: LanStatus) => void;
  setError: (error: string | null) => void;
}

export const remotePanelId = (deviceId: string, panelId: string) => `lan:${deviceId}:${panelId}`;

export function splitRemotePanelId(id: string): { deviceId: string; panelId: string } | null {
  if (!id.startsWith('lan:')) return null;
  const second = id.indexOf(':', 4);
  if (second < 0) return null;
  return { deviceId: id.slice(4, second), panelId: id.slice(second + 1) };
}

export const useLanStore = create<LanStoreState>()(
  persist(
    (set, get) => ({
      status: null,
      error: null,
      setStatus: (incoming) => {
        // The backend deliberately does not persist transcripts or panel
        // rosters. Retain the last public roster in localStorage so an offline
        // computer still has a useful, clearly marked subgroup.
        const previous = get().status?.peers ?? [];
        const peers = incoming.peers.map((peer) => {
          const cached = previous.find((p) => p.deviceId === peer.deviceId);
          return peer.panels.length > 0 ? peer : { ...peer, panels: cached?.panels ?? [] };
        });
        const status = { ...incoming, peers };
        set({ status, error: null });
        scheduleWorkspaceSync();
      },
      setError: (error) => set({ error }),
    }),
    {
      name: 'tessera-lan-public-state',
      partialize: (state) => ({ status: state.status }),
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<LanStoreState>), error: null }),
    },
  ),
);

let syncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleWorkspaceSync(delay = 50) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncRemoteGroups();
  }, delay);
}

function syncRemoteGroups() {
  const status = useLanStore.getState().status;
  if (!status) return;
  const groupStore = useGroupStore.getState();
  const layout = useLayoutStore.getState();

  for (const peer of status.peers) {
    let group = [...groupStore.groups.values()].find((g) => g.remotePeerId === peer.deviceId);
    if (!group) {
      const parentId = groupStore.getCurrentGroupId();
      const groupId = groupStore.createGroup(parentId, peer.name);
      useGroupStore.setState((state) => {
        const groups = new Map(state.groups);
        const created = groups.get(groupId);
        if (created) groups.set(groupId, { ...created, remotePeerId: peer.deviceId, color: '#51cf66' });
        return { groups };
      });
      useLayoutStore.getState().addPanel(groupId, 'group', true);
      group = useGroupStore.getState().groups.get(groupId);
    }
    if (!group) continue;

    const childIds = peer.panels.map((panel) => remotePanelId(peer.deviceId, panel.id));
    const changed = group.name !== peer.name || group.childIds.join('\0') !== childIds.join('\0');
    if (changed) {
      useGroupStore.setState((state) => {
        const groups = new Map(state.groups);
        const current = groups.get(group!.id);
        if (current) {
          groups.set(group!.id, {
            ...current,
            name: peer.name,
            childIds,
            layoutConfig: null,
            panelRects: new Map(),
            focusedChildId: childIds.includes(current.focusedChildId ?? '') ? current.focusedChildId : (childIds[0] ?? null),
            activeChildId: childIds.includes(current.activeChildId ?? '') ? current.activeChildId : (childIds[0] ?? null),
          });
        }
        return { groups };
      });
    }

    useLayoutStore.setState((state) => {
      const panelTypes = { ...state.panelTypes };
      for (const id of childIds) panelTypes[id] = 'remote';
      return { panelTypes };
    });

    const openGroupId = useGroupStore.getState().getCurrentGroupId();
    if (openGroupId === group.id && changed) {
      const currentLayout = useLayoutStore.getState();
      const focused = childIds.includes(currentLayout.focusedId ?? '') ? currentLayout.focusedId : (childIds[0] ?? null);
      const config = childIds.length ? getDefaultConfig(childIds, focused) : null;
      const rects = config ? computeRects(config, focused, currentLayout.stealFraction, currentLayout.sidebarSlotFractions) : new Map();
      currentLayout.restoreLayout(
        childIds, focused, focused, config, rects, currentLayout.stealFraction,
        currentLayout.panelTypes, currentLayout.widgetKinds, currentLayout.sidebarSlotFractions,
      );
    }
  }
}

export function forgetRemoteGroup(deviceId: string) {
  const store = useGroupStore.getState();
  const group = [...store.groups.values()].find((g) => g.remotePeerId === deviceId);
  if (!group) return;
  if (store.getCurrentGroupId() === group.id) store.jumpToLevel(group.parentId);
  const children = new Set(group.childIds);
  useGroupStore.setState((state) => {
    const groups = new Map(state.groups);
    groups.delete(group.id);
    for (const [id, candidate] of groups) {
      if (candidate.childIds.includes(group.id)) groups.set(id, { ...candidate, childIds: candidate.childIds.filter((v) => v !== group.id) });
    }
    return { groups };
  });
  const ls = useLayoutStore.getState();
  if (ls.tabOrder.includes(group.id)) ls.removePanel(group.id);
  useLayoutStore.setState((state) => {
    const panelTypes = { ...state.panelTypes };
    delete panelTypes[group.id];
    for (const id of children) delete panelTypes[id];
    return { panelTypes };
  });
}

export async function initLanBridge() {
  await listen<LanStatus>('lan-state', (event) => useLanStore.getState().setStatus(event.payload));
  await listen<string>('lan-error', (event) => useLanStore.getState().setError(event.payload));
  await listen<string>('lan-peer-forgotten', (event) => forgetRemoteGroup(event.payload));
  try {
    useLanStore.getState().setStatus(await invoke<LanStatus>('lan_status'));
    // Workspace restore runs in a React effect. Repeat once afterward so the
    // remote group is present even when the restore cleared the initial sync.
    setTimeout(syncRemoteGroups, 1800);
  } catch (error) {
    useLanStore.getState().setError(String(error));
  }
}

export function remotePanelByCompositeId(id: string): { peer: LanPeerState; panel: RemotePanelInfo } | null {
  const parsed = splitRemotePanelId(id);
  if (!parsed) return null;
  const peer = useLanStore.getState().status?.peers.find((p) => p.deviceId === parsed.deviceId);
  const panel = peer?.panels.find((p) => p.id === parsed.panelId);
  return peer && panel ? { peer, panel } : null;
}

