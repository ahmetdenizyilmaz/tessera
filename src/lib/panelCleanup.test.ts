import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { closePanel } from './panelCleanup';
import { captureGroupSnapshot, useGroupStore } from '../store/groupStore';
import { useLayoutStore } from '../store/layoutStore';
import { useInstanceStore } from '../store/instanceStore';
import { syncRemoteGroups, useLanStore } from '../store/lanStore';
import type { InstanceConfig } from '../types/instance';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../components/terminal/XTermView', () => ({ clearTerminalState: vi.fn() }));
vi.mock('../hooks/usePty', () => ({ cleanupPty: vi.fn() }));
vi.mock('../hooks/useTerminal', () => ({ destroyTerminal: vi.fn() }));
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  } });
});

const config: InstanceConfig = { cwd: 'C:/test', model: 'test', systemPrompt: '', permissionMode: 'default',
  dangerouslySkipPermissions: false, allowedTools: [], maxBudget: 0, agentMode: false };
beforeEach(() => {
  vi.clearAllMocks();
  useInstanceStore.setState({ instances: new Map() });
  useLayoutStore.setState({ tabOrder: [], panelTypes: {}, widgetKinds: {}, panelRects: new Map(), layoutConfig: null,
    focusedId: null, activeTabId: null, maximizedId: null });
  useGroupStore.getState().restoreGroups(new Map());
  useGroupStore.setState({ groups: new Map() });
  useLanStore.setState({ status: null, hiddenPanelIds: [], hiddenPeerIds: [] });
});
const group = (parent: string | null = null) => {
  const id = useGroupStore.getState().createGroup(parent);
  useLayoutStore.getState().addPanel(id, 'group');
  return id;
};
const enter = (id: string) => {
  useGroupStore.getState().enterGroup(id);
  useGroupStore.getState().commitEnterGroup();
};
const terminal = (provider: 'claude' | 'codex' | 'opencode' = 'claude') => {
  const id = useInstanceStore.getState().addInstance({ ...config, agentProvider: provider }, provider);
  useLayoutStore.getState().addPanel(id, 'terminal');
  return id;
};
it('closing a local OpenCode panel stops its own server and PTY, without deleting history', async () => {
  const id = terminal('opencode');
  await closePanel(id);
  expect(invoke).toHaveBeenCalledWith('opencode_close', { id });
  expect(invoke).toHaveBeenCalledWith('pty_kill', { id });
  expect(useInstanceStore.getState().instances.has(id)).toBe(false);
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command.includes('delete'))).toBe(false);
});

it('closes a local group recursively, including live nested children, without spilling them into its parent', async () => {
  const unaffected = terminal();
  const outer = group();
  enter(outer);
  const claude = terminal();
  const nested = group(outer);
  enter(nested);
  const codex = terminal('codex');
  // Live children have not been written back to either group's stored childIds.
  expect(useGroupStore.getState().groups.get(nested)?.childIds).toEqual([]);
  await closePanel(outer);
  expect(useLayoutStore.getState().tabOrder).toEqual([unaffected]);
  expect(useGroupStore.getState().groups.size).toBe(0);
  expect(useGroupStore.getState().groupStack).toEqual([]);
  expect([...useInstanceStore.getState().instances.keys()]).toEqual([unaffected]);
  expect(invoke).toHaveBeenCalledWith('pty_kill', { id: claude });
  expect(invoke).toHaveBeenCalledWith('codex_close', { id: codex });
  expect(invoke).toHaveBeenCalledWith('pty_kill', { id: codex });
  expect(vi.mocked(invoke).mock.calls.some(([, args]) => (args as { id?: string })?.id === unaffected)).toBe(false);
});

it('removes a closed sibling group from saved root layouts while keeping the current group open', async () => {
  const target = group();
  enter(target);
  const child = terminal();
  useGroupStore.getState().exitGroup();
  const current = group();
  enter(current);
  const survivor = terminal();
  await closePanel(target);
  expect(useGroupStore.getState().getCurrentGroupId()).toBe(current);
  expect(useLayoutStore.getState().tabOrder).toEqual([survivor]);
  expect(captureGroupSnapshot().rootLayout?.tabOrder).toEqual([current]);
  useGroupStore.getState().exitGroup();
  expect(useLayoutStore.getState().tabOrder).toEqual([current]);
  expect(useLayoutStore.getState().panelTypes[target]).toBeUndefined();
  expect(useLayoutStore.getState().panelTypes[child]).toBeUndefined();
});

it('bulk-closing a local group hides a contained remote group without any host teardown or unpairing', async () => {
  const outer = group();
  enter(outer);
  const remote = group(outer);
  useGroupStore.setState(state => ({ groups: new Map([...state.groups].map(([id, value]) =>
    [id, id === remote ? { ...value, remotePeerId: 'peer', childIds: ['lan:peer:remote-child'] } : value])) }));
  useLayoutStore.setState(state => ({ panelTypes: { ...state.panelTypes, 'lan:peer:remote-child': 'remote' } }));
  useLanStore.setState({ status: { sharing: true, name: 'Local', deviceId: 'local', fingerprint: '', port: 43721,
    addresses: [], pendingRequests: [], peers: [{ deviceId: 'peer', name: 'Host', address: '192.168.1.2', connected: true,
      panels: [{ id: 'remote-child', name: 'Remote', kind: 'terminal', provider: 'claude', cwd: '', status: 'running',
        busy: false, awaitingUser: false, model: null, reachable: true }] }] } });
  await closePanel(outer);
  syncRemoteGroups();
  expect(useLayoutStore.getState().tabOrder).toEqual([]);
  expect(useGroupStore.getState().groups.size).toBe(0);
  expect(useLanStore.getState().hiddenPeerIds).toEqual(['peer']);
  expect(useLanStore.getState().status?.peers).toHaveLength(1);
  expect(invoke).not.toHaveBeenCalled();
});

it('coalesces repeated group close clicks while native cleanup is pending', async () => {
  const id = group();
  enter(id);
  const child = terminal();
  useGroupStore.getState().exitGroup();
  await Promise.all([closePanel(id), closePanel(id)]);
  expect(vi.mocked(invoke).mock.calls.filter(([name, args]) => name === 'pty_kill' && (args as { id: string }).id === child)).toHaveLength(1);
  expect(useLayoutStore.getState().tabOrder).toEqual([]);
});
