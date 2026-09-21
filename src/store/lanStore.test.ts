import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { closeRemoteGroup, closeRemotePanel, restoreRemotePanels, syncRemoteGroups, useLanStore, type LanStatus, type RemotePanelInfo } from './lanStore';
import { useGroupStore } from './groupStore';
import { useLayoutStore } from './layoutStore';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
const { storage } = vi.hoisted(() => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  return { storage };
});
const panel: RemotePanelInfo = { id: 'terminal-1', name: 'Terminal', kind: 'terminal', provider: 'claude',
  cwd: 'C:/test', status: 'running', busy: false, awaitingUser: false, reachable: true, model: null };
const status = (panels: RemotePanelInfo[], connected = true, registryReady = true): LanStatus => ({
  sharing: true, deviceId: 'local', name: 'Local', fingerprint: '', port: 43721, addresses: [], pendingRequests: [],
  peers: [{ deviceId: 'peer', name: 'Other PC', address: '192.168.1.2', connected, registryReady, panels }],
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useLayoutStore.setState({ tabOrder: [], panelTypes: {}, panelRects: new Map(), layoutConfig: null, focusedId: null, activeTabId: null, maximizedId: null });
  useGroupStore.getState().restoreGroups(new Map());
  useGroupStore.setState({ groups: new Map() });
  useLanStore.setState({ status: null, hiddenPanelIds: [], hiddenPeerIds: [] });
});
afterEach(async () => { await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); });
const remoteGroup = () => [...useGroupStore.getState().groups.values()].find(g => g.remotePeerId === 'peer')!;

it('reattaches an unchanged remote group after workspace restore overwrites the layout', () => {
  useLanStore.getState().setStatus(status([panel]));
  syncRemoteGroups();
  const id = remoteGroup().id;
  useLayoutStore.setState({ tabOrder: ['local'], panelTypes: { local: 'terminal' } });
  syncRemoteGroups();
  expect(useLayoutStore.getState().tabOrder).toEqual(['local', id]);
  expect(useLayoutStore.getState().panelTypes['lan:peer:terminal-1']).toBe('remote');
});

it('attaches newly discovered computers at root while the user is inside another group', () => {
  const local = useGroupStore.getState().createGroup(null);
  useLayoutStore.getState().addPanel(local, 'group');
  useGroupStore.getState().enterGroup(local);
  useGroupStore.getState().commitEnterGroup();
  useLanStore.getState().setStatus(status([panel]));
  syncRemoteGroups();
  expect(remoteGroup().parentId).toBeNull();
  expect(useLayoutStore.getState().tabOrder).toEqual([]);
  useGroupStore.getState().exitGroup();
  expect(useLayoutStore.getState().tabOrder).toContain(remoteGroup().id);
});

it('keeps offline/pending cached panels, but honors an authoritative empty roster', () => {
  useLanStore.getState().setStatus(status([panel]));
  useLanStore.getState().setStatus(status([], false));
  expect(useLanStore.getState().status?.peers[0].panels).toEqual([panel]);
  useLanStore.getState().setStatus(status([], true, false));
  expect(useLanStore.getState().status?.peers[0].panels).toEqual([panel]);
  useLanStore.getState().setStatus(status([], true, true));
  expect(useLanStore.getState().status?.peers[0].panels).toEqual([]);
});

it('updates an open group when panels are added or removed and clears stale panel types', () => {
  useLanStore.getState().setStatus(status([panel]));
  syncRemoteGroups();
  useGroupStore.getState().enterGroup(remoteGroup().id);
  useGroupStore.getState().commitEnterGroup();
  expect(useLayoutStore.getState().tabOrder).toEqual(['lan:peer:terminal-1']);
  useLanStore.getState().setStatus(status([{ ...panel, id: 'terminal-2' }]));
  syncRemoteGroups();
  expect(useLayoutStore.getState().tabOrder).toEqual(['lan:peer:terminal-2']);
  expect(useLayoutStore.getState().panelTypes['lan:peer:terminal-1']).toBeUndefined();
  useLanStore.getState().setStatus(status([]));
  syncRemoteGroups();
  expect(useLayoutStore.getState().tabOrder).toEqual([]);
});

it('closes only the local view, preserving the host roster and the remaining focus', () => {
  useLanStore.getState().setStatus(status([panel, { ...panel, id: 'chat', kind: 'chat' }]));
  syncRemoteGroups();
  useGroupStore.getState().enterGroup(remoteGroup().id);
  useGroupStore.getState().commitEnterGroup();
  useLayoutStore.setState({ maximizedId: 'lan:peer:terminal-1' });
  closeRemotePanel('lan:peer:terminal-1');
  expect(useLayoutStore.getState().tabOrder).toEqual(['lan:peer:chat']);
  expect(useLayoutStore.getState().focusedId).toBe('lan:peer:chat');
  expect(useLayoutStore.getState().maximizedId).toBeNull();
  expect(remoteGroup().childIds).toEqual(['lan:peer:chat']);
  expect(useLayoutStore.getState().panelTypes['lan:peer:terminal-1']).toBeUndefined();
  expect(useLanStore.getState().status?.peers[0].panels).toHaveLength(2);
  expect(invoke).not.toHaveBeenCalled();
});

it('keeps panels closed across refresh, reconnect and workspace restore, while discovering new panels', () => {
  useLanStore.getState().setStatus(status([panel]));
  syncRemoteGroups();
  closeRemotePanel('lan:peer:terminal-1');
  useLanStore.getState().setStatus(status([], false));
  syncRemoteGroups();
  expect(remoteGroup().childIds).toEqual([]);
  useLanStore.getState().setStatus(status([panel, { ...panel, id: 'new' }]));
  useGroupStore.getState().restoreGroups(new Map());
  useGroupStore.setState({ groups: new Map() });
  syncRemoteGroups();
  expect(remoteGroup().childIds).toEqual(['lan:peer:new']);
  useGroupStore.getState().enterGroup(remoteGroup().id);
  useGroupStore.getState().commitEnterGroup();
  restoreRemotePanels('peer');
  expect(useLayoutStore.getState().tabOrder).toEqual(['lan:peer:terminal-1', 'lan:peer:new']);
  expect(useLanStore.getState().hiddenPanelIds).toEqual([]);
  expect(invoke).not.toHaveBeenCalled();
});

it('persists local closes across application hydration and migrates old saved state', async () => {
  useLanStore.getState().setStatus(status([panel]));
  closeRemotePanel('lan:peer:terminal-1');
  const saved = storage.getItem('tessera-lan-public-state')!;
  expect(JSON.parse(saved).state.hiddenPanelIds).toEqual(['lan:peer:terminal-1']);
  useLanStore.setState({ status: null, hiddenPanelIds: [] });
  storage.setItem('tessera-lan-public-state', saved);
  await useLanStore.persist.rehydrate();
  syncRemoteGroups();
  expect(useLanStore.getState().hiddenPanelIds).toEqual(['lan:peer:terminal-1']);
  expect(remoteGroup().childIds).toEqual([]);
  expect(useLanStore.getState().status?.peers[0].connected).toBe(false);
  storage.setItem('tessera-lan-public-state', JSON.stringify({ state: { status: status([panel]) }, version: 0 }));
  await useLanStore.persist.rehydrate();
  expect(useLanStore.getState().hiddenPanelIds).toEqual([]);
});

it('scopes close/restore to one computer, including identical panel IDs and offline panels', () => {
  const incoming = status([panel], false);
  incoming.peers.push({ ...incoming.peers[0], deviceId: 'another-peer' });
  useLanStore.getState().setStatus(incoming);
  syncRemoteGroups();
  closeRemotePanel('lan:peer:terminal-1');
  const otherGroup = [...useGroupStore.getState().groups.values()].find(g => g.remotePeerId === 'another-peer')!;
  expect(otherGroup.childIds).toEqual(['lan:another-peer:terminal-1']);
  closeRemotePanel('lan:another-peer:terminal-1');
  restoreRemotePanels('peer');
  expect(remoteGroup().childIds).toEqual(['lan:peer:terminal-1']);
  expect(useLanStore.getState().hiddenPanelIds).toEqual(['lan:another-peer:terminal-1']);
  expect(invoke).not.toHaveBeenCalled();
});

it('can close the last visible panel and restore the empty open group', () => {
  useLanStore.getState().setStatus(status([panel]));
  syncRemoteGroups();
  useGroupStore.getState().enterGroup(remoteGroup().id);
  useGroupStore.getState().commitEnterGroup();
  closeRemotePanel('lan:peer:terminal-1');
  expect(useLayoutStore.getState().tabOrder).toEqual([]);
  expect(useLayoutStore.getState().activeTabId).toBeNull();
  expect(useLayoutStore.getState().focusedId).toBeNull();
  expect(useGroupStore.getState().getCurrentGroupId()).toBe(remoteGroup().id);
  restoreRemotePanels('peer');
  expect(useLayoutStore.getState().tabOrder).toEqual(['lan:peer:terminal-1']);
  expect(useLayoutStore.getState().activeTabId).toBe('lan:peer:terminal-1');
  expect(invoke).not.toHaveBeenCalled();
});

it('closes an open remote group locally and keeps it hidden through reconnects and new host panels', () => {
  useLanStore.getState().setStatus(status([panel]));
  syncRemoteGroups();
  const groupId = remoteGroup().id;
  useGroupStore.getState().enterGroup(groupId);
  useGroupStore.getState().commitEnterGroup();
  closeRemoteGroup('peer');
  expect(useGroupStore.getState().getCurrentGroupId()).toBeNull();
  expect(useGroupStore.getState().groups.has(groupId)).toBe(false);
  expect(useLayoutStore.getState().tabOrder).toEqual([]);
  expect(useLayoutStore.getState().panelTypes).toEqual({});
  useLanStore.getState().setStatus(status([], false));
  syncRemoteGroups();
  useLanStore.getState().setStatus(status([panel, { ...panel, id: 'new' }]));
  syncRemoteGroups();
  expect(remoteGroup()).toBeUndefined();
  expect(useLanStore.getState().status?.peers[0].panels).toHaveLength(2);
  restoreRemotePanels('peer');
  expect(remoteGroup().childIds).toEqual(['lan:peer:terminal-1', 'lan:peer:new']);
  expect(useLayoutStore.getState().tabOrder).toEqual([remoteGroup().id]);
  expect(invoke).not.toHaveBeenCalled();
});

it('removes a closed remote group from saved ancestor layouts without moving the current view', () => {
  useLanStore.getState().setStatus(status([panel]));
  syncRemoteGroups();
  const groupId = remoteGroup().id;
  const local = useGroupStore.getState().createGroup(null, 'Local');
  useLayoutStore.getState().addPanel(local, 'group');
  useGroupStore.getState().enterGroup(local);
  useGroupStore.getState().commitEnterGroup();
  closeRemoteGroup('peer');
  expect(useGroupStore.getState().getCurrentGroupId()).toBe(local);
  useGroupStore.getState().exitGroup();
  expect(useLayoutStore.getState().tabOrder).toEqual([local]);
  expect(useLayoutStore.getState().panelTypes[groupId]).toBeUndefined();
  expect(useLayoutStore.getState().panelTypes['lan:peer:terminal-1']).toBeUndefined();
});

it('persists group-level closes and removes a stale group restored by the workspace', async () => {
  useLanStore.getState().setStatus(status([panel]));
  syncRemoteGroups();
  const staleGroups = new Map(useGroupStore.getState().groups);
  closeRemoteGroup('peer');
  const saved = storage.getItem('tessera-lan-public-state')!;
  expect(JSON.parse(saved).state.hiddenPeerIds).toEqual(['peer']);
  useLanStore.setState({ hiddenPeerIds: [] });
  storage.setItem('tessera-lan-public-state', saved);
  await useLanStore.persist.rehydrate();
  useGroupStore.getState().restoreGroups(staleGroups);
  useLayoutStore.setState({ tabOrder: [...staleGroups.keys()] });
  syncRemoteGroups();
  expect(remoteGroup()).toBeUndefined();
  expect(useLayoutStore.getState().tabOrder).toEqual([]);
  expect(useLanStore.getState().hiddenPeerIds).toEqual(['peer']);
  expect(invoke).not.toHaveBeenCalled();
});
