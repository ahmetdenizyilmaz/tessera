import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ensurePanelAtLevel, useGroupStore } from './groupStore';
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
  /** False until the first authoritative roster arrives on this connection. */
  registryReady?: boolean;
}

/** A computer that asked to connect and is waiting for Approve / Decline. */
export interface LanPairRequest {
  requestId: string;
  deviceId: string;
  name: string;
  address: string;
  fingerprint: string;
  receivedAt: number;
}

export interface LanStatus {
  sharing: boolean;
  deviceId: string;
  name: string;
  /** Short digest of this computer's key, shown on both sides during a request. */
  fingerprint: string;
  port: number;
  addresses: string[];
  peers: LanPeerState[];
  pendingRequests: LanPairRequest[];
}

interface LanStoreState {
  status: LanStatus | null;
  error: string | null;
  /** Address of an outgoing connection request still waiting for approval. */
  outgoing: string | null;
  /** Viewer-only preferences. Never sent to the owning computer. */
  hiddenPanelIds: string[];
  setStatus: (status: LanStatus) => void;
  setError: (error: string | null) => void;
  /**
   * Ask the computer at `address` to connect. Resolves to the paired device
   * id once its user approves, or null (with `error` set) otherwise.
   */
  requestPair: (address: string) => Promise<string | null>;
  respondPairRequest: (requestId: string, accept: boolean) => Promise<void>;
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
      outgoing: null,
      hiddenPanelIds: [],
      setStatus: (incoming) => {
        // The backend deliberately does not persist transcripts or panel
        // rosters. Retain the last public roster in localStorage so an offline
        // computer still has a useful, clearly marked subgroup.
        const previous = get().status?.peers ?? [];
        const peers = incoming.peers.map((peer) => {
          const cached = previous.find((p) => p.deviceId === peer.deviceId);
          const awaitingRoster = peer.registryReady === false;
          return peer.panels.length === 0 && (!peer.connected || awaitingRoster)
            ? { ...peer, panels: cached?.panels ?? [] } : peer;
        });
        const status = { ...incoming, peers };
        set({ status, error: null });
        scheduleWorkspaceSync();
      },
      setError: (error) => set({ error }),
      requestPair: async (address) => {
        const trimmed = address.trim();
        if (!trimmed || get().outgoing) return null;
        set({ outgoing: trimmed, error: null });
        try {
          const status = await invoke<LanStatus>('lan_request_pair', { address: trimmed });
          get().setStatus(status);
          // Build the subgroup now so the caller can reveal it immediately.
          flushWorkspaceSync();
          const ip = trimmed.split(':')[0];
          return status.peers.find((p) => p.address.split(':')[0] === ip)?.deviceId ?? null;
        } catch (err) {
          set({ error: String(err) });
          return null;
        } finally {
          set({ outgoing: null });
        }
      },
      respondPairRequest: async (requestId, accept) => {
        try {
          get().setStatus(await invoke<LanStatus>('lan_respond_pair_request', { requestId, accept }));
        } catch (err) {
          set({ error: String(err) });
        }
      },
    }),
    {
      name: 'tessera-lan-public-state',
      // Requests and in-flight state are meaningless after a restart.
      partialize: (state) => ({
        status: state.status ? { ...state.status, pendingRequests: [] } : null,
        hiddenPanelIds: state.hiddenPanelIds,
      }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<LanStoreState> | undefined;
        const saved = stored?.status ?? null;
        return {
          ...current,
          hiddenPanelIds: Array.isArray(stored?.hiddenPanelIds)
            ? stored.hiddenPanelIds.filter((id): id is string => typeof id === 'string' && !!splitRemotePanelId(id)) : [],
          status: saved ? { ...saved, fingerprint: saved.fingerprint ?? '', pendingRequests: [],
            peers: saved.peers.map(peer => ({ ...peer, connected: false, registryReady: false })),
          } : null,
          error: null,
          outgoing: null,
        };
      },
    },
  ),
);

let syncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleWorkspaceSync(delay = 50) {
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncRemoteGroups();
  }, delay);
}

function flushWorkspaceSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  syncRemoteGroups();
}

/** Close this viewer's tile only: no session cleanup or network command. */
export function closeRemotePanel(id: string) {
  if (!splitRemotePanelId(id)) return;
  useLanStore.setState((state) => state.hiddenPanelIds.includes(id) ? state
    : { hiddenPanelIds: [...state.hiddenPanelIds, id] });
  const layout = useLayoutStore.getState();
  if (layout.tabOrder.includes(id)) layout.removePanel(id);
  flushWorkspaceSync();
}

export function restoreRemotePanels(deviceId: string) {
  useLanStore.setState((state) => ({
    hiddenPanelIds: state.hiddenPanelIds.filter(id => splitRemotePanelId(id)?.deviceId !== deviceId),
  }));
  flushWorkspaceSync();
}

/** Bring a paired computer's subgroup tab to the front if it is on this level. */
export function revealRemoteGroup(deviceId: string) {
  const group = [...useGroupStore.getState().groups.values()].find((g) => g.remotePeerId === deviceId);
  if (!group) return;
  const layout = useLayoutStore.getState();
  if (layout.tabOrder.includes(group.id)) layout.setActiveTab(group.id);
}

export function syncRemoteGroups() {
  const { status, hiddenPanelIds } = useLanStore.getState();
  if (!status) return;
  const groupStore = useGroupStore.getState();

  for (const peer of status.peers) {
    let group = [...groupStore.groups.values()].find((g) => g.remotePeerId === peer.deviceId);
    if (!group) {
      const groupId = groupStore.createGroup(null, peer.name);
      useGroupStore.setState((state) => {
        const groups = new Map(state.groups);
        const created = groups.get(groupId);
        if (created) groups.set(groupId, { ...created, remotePeerId: peer.deviceId, color: '#51cf66' });
        return { groups };
      });
      group = useGroupStore.getState().groups.get(groupId);
    }
    if (!group) continue;
    // Restore can replace tabOrder after a peer's group was first created.
    // Repair its attachment even when the roster itself did not change.
    ensurePanelAtLevel(group.id, group.parentId, 'group');

    const childIds = peer.panels.map((panel) => remotePanelId(peer.deviceId, panel.id))
      .filter(id => !hiddenPanelIds.includes(id));
    const childrenChanged = group.childIds.join('\0') !== childIds.join('\0');
    const changed = group.name !== peer.name || childrenChanged;
    if (changed) {
      useGroupStore.setState((state) => {
        const groups = new Map(state.groups);
        const current = groups.get(group!.id);
        if (current) {
          groups.set(group!.id, {
            ...current,
            name: peer.name,
            childIds,
            layoutConfig: childrenChanged ? null : current.layoutConfig,
            panelRects: childrenChanged ? new Map() : current.panelRects,
            focusedChildId: childIds.includes(current.focusedChildId ?? '') ? current.focusedChildId : (childIds[0] ?? null),
            activeChildId: childIds.includes(current.activeChildId ?? '') ? current.activeChildId : (childIds[0] ?? null),
          });
        }
        return { groups };
      });
    }

    useLayoutStore.setState((state) => {
      const panelTypes = { ...state.panelTypes };
      let typesChanged = false;
      for (const id of Object.keys(panelTypes)) {
        if (splitRemotePanelId(id)?.deviceId === peer.deviceId && !childIds.includes(id)) {
          delete panelTypes[id];
          typesChanged = true;
        }
      }
      for (const id of childIds) if (panelTypes[id] !== 'remote') typesChanged = true;
      for (const id of childIds) panelTypes[id] = 'remote';
      return typesChanged ? { panelTypes } : state;
    });

    const openGroupId = useGroupStore.getState().getCurrentGroupId();
    if (openGroupId === group.id && useLayoutStore.getState().tabOrder.join('\0') !== childIds.join('\0')) {
      const currentLayout = useLayoutStore.getState();
      const focused = childIds.includes(currentLayout.focusedId ?? '') ? currentLayout.focusedId : (childIds[0] ?? null);
      const config = childIds.length ? getDefaultConfig(childIds, focused) : null;
      const rects = config ? computeRects(config, focused, currentLayout.stealFraction, currentLayout.sidebarSlotFractions) : new Map();
      currentLayout.restoreLayout(
        childIds, childIds.includes(currentLayout.activeTabId ?? '') ? currentLayout.activeTabId : focused,
        focused, config, rects, currentLayout.stealFraction,
        currentLayout.panelTypes, currentLayout.widgetKinds, currentLayout.sidebarSlotFractions,
      );
    }
  }
}

export function forgetRemoteGroup(deviceId: string) {
  useLanStore.setState((state) => ({
    hiddenPanelIds: state.hiddenPanelIds.filter(id => splitRemotePanelId(id)?.deviceId !== deviceId),
  }));
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
  useLayoutStore.subscribe(() => scheduleWorkspaceSync());
  useGroupStore.subscribe(() => scheduleWorkspaceSync());
  await listen<LanStatus>('lan-state', (event) => useLanStore.getState().setStatus(event.payload));
  await listen<string>('lan-error', (event) => useLanStore.getState().setError(event.payload));
  await listen<string>('lan-peer-forgotten', (event) => forgetRemoteGroup(event.payload));
  try {
    useLanStore.getState().setStatus(await invoke<LanStatus>('lan_status'));
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

