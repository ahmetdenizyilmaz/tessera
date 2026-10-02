import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { ensureAntigravity, initAntigravityBridge, reconfigureAntigravity, refreshAntigravity, stopAntigravityWatch } from './antigravityBridge';
import { useAntigravityStore } from '../store/antigravityStore';
import { useInstanceStore } from '../store/instanceStore';
import { DEFAULT_ANTIGRAVITY_OPTIONS } from './antigravityConfig';
import type { AntigravitySnapshot } from '../types/antigravity';
import { useGroupStore } from '../store/groupStore';
import { useLayoutStore } from '../store/layoutStore';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.hoisted(() => { vi.stubGlobal('window', {}); });

const ids: string[] = [];
const snapshot = (conversationId: string | null = 'conv-saved', extra: Partial<AntigravitySnapshot> = {}): AntigravitySnapshot =>
  ({ generation: 'backend', revision: 'backend:1', configured: true, conversationId, processAlive: false, busy: false, items: [], ...extra });
const add = (cwd = 'C:/project', panelView: 'chat' | 'terminal' = 'chat') => {
  const id = useInstanceStore.getState().addInstance({ agentProvider: 'antigravity', antigravity: { ...DEFAULT_ANTIGRAVITY_OPTIONS, model: 'gemini-3.8-flash-low' }, cwd, model: 'gemini-3.8-flash-low', panelView,
    systemPrompt: '', permissionMode: 'default', dangerouslySkipPermissions: false, allowedTools: [], maxBudget: 0, agentMode: false });
  ids.push(id);
  return id;
};
const instance = (id: string) => useInstanceStore.getState().instances.get(id)!;
const commands = () => vi.mocked(invoke).mock.calls.map(c => c[0]);

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  useInstanceStore.setState({ instances: new Map() }); useAntigravityStore.setState({ sessions: {} });
  useLayoutStore.setState({ tabOrder: [], panelTypes: {}, panelRects: new Map(), layoutConfig: null, activeTabId: null, focusedId: null });
  useGroupStore.getState().restoreGroups(new Map());
  useGroupStore.setState({ groups: new Map() });
  vi.mocked(invoke).mockResolvedValue(snapshot());
});
afterEach(() => { ids.splice(0).forEach(stopAntigravityWatch); vi.useRealTimers(); });

it('configures once per panel, gives it its own storage ID, and starts agy only when asked', async () => {
  const id = add();
  await Promise.all([ensureAntigravity(id, true), ensureAntigravity(id, true)]);
  expect(commands()).toEqual(['antigravity_configure']);
  expect(invoke).toHaveBeenCalledWith('antigravity_configure', { id, conversationId: null, start: true,
    config: expect.objectContaining({ cwd: 'C:/project', model: 'gemini-3.8-flash-low', permission: 'review', sandbox: false, dataId: expect.any(String) }) });
  expect(instance(id)).toMatchObject({ antigravityConversationId: 'conv-saved', antigravityDataId: expect.any(String), status: 'running' });
  expect(instance(id).claudeSessionId).toBeUndefined();
  expect(instance(id).codexThreadId).toBeUndefined();
  await ensureAntigravity(id);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('restores the exact saved conversation without starting a process or a turn', async () => {
  const id = add();
  useInstanceStore.getState().updateInstance(id, { antigravityDataId: 'stored-data-id', antigravityConversationId: 'conv-restored' });
  vi.mocked(invoke).mockResolvedValueOnce(snapshot('conv-restored', { items: [{ id: 'u-1', type: 'user', text: 'Earlier question', at: 1 }] }));
  await ensureAntigravity(id);
  expect(invoke).toHaveBeenCalledWith('antigravity_configure', { id, conversationId: 'conv-restored', start: false, config: expect.objectContaining({ dataId: 'stored-data-id' }) });
  expect(commands()).not.toContain('antigravity_send');
  expect(useAntigravityStore.getState().sessions[id].items[0].text).toBe('Earlier question');
});

it('keeps simultaneous panels isolated: own folder, storage, conversation and transcript', async () => {
  const a = add('C:/project-a'), b = add('C:/project-b');
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const { id } = args as { id: string };
    return command === 'antigravity_configure' || command === 'antigravity_snapshot'
      ? snapshot(id === a ? 'conv-a' : 'conv-b', { revision: `backend:${id}`, busy: id === a, items: [{ id: `u-${id}`, type: 'user', text: id === a ? 'Task A' : 'Task B', at: 1 }] })
      : undefined;
  });
  await Promise.all([ensureAntigravity(a, true), ensureAntigravity(b, true)]);
  const configs = vi.mocked(invoke).mock.calls.filter(c => c[0] === 'antigravity_configure').map(c => (c[1] as { id: string; config: { cwd: string; dataId: string } }));
  expect(configs.map(c => c.config.cwd).sort()).toEqual(['C:/project-a', 'C:/project-b']);
  expect(new Set(configs.map(c => c.config.dataId)).size).toBe(2);
  expect(instance(a).antigravityConversationId).toBe('conv-a');
  expect(instance(b).antigravityConversationId).toBe('conv-b');
  const sessions = useAntigravityStore.getState().sessions;
  expect([sessions[a].items[0].text, sessions[a].busy, sessions[b].items[0].text, sessions[b].busy]).toEqual(['Task A', true, 'Task B', false]);
  // Closing one panel leaves the other's session and watcher untouched.
  stopAntigravityWatch(a);
  expect(useAntigravityStore.getState().sessions[a]).toBeUndefined();
  expect(useAntigravityStore.getState().sessions[b].conversationId).toBe('conv-b');
});

it('polls with the known revision and keeps the transcript when nothing changed', async () => {
  const id = add();
  vi.mocked(invoke).mockResolvedValueOnce(snapshot('conv-saved', { revision: 'backend:10' }));
  await ensureAntigravity(id);
  const before = useAntigravityStore.getState().sessions[id];
  vi.mocked(invoke).mockResolvedValueOnce(null);
  await refreshAntigravity(id);
  expect(invoke).toHaveBeenLastCalledWith('antigravity_snapshot', { id, knownRevision: 'backend:10' });
  expect(useAntigravityStore.getState().sessions[id]).toBe(before);
  // A working panel is polled quickly; an idle one slowly.
  vi.mocked(invoke).mockResolvedValue(snapshot('conv-saved', { revision: 'backend:11', busy: true }));
  await vi.advanceTimersByTimeAsync(1200);
  expect(useAntigravityStore.getState().sessions[id].busy).toBe(true);
  const polls = () => vi.mocked(invoke).mock.calls.filter(c => c[0] === 'antigravity_snapshot').length;
  const count = polls();
  await vi.advanceTimersByTimeAsync(600);
  expect(polls() - count).toBeGreaterThanOrEqual(2);
});

it('does not resurrect a panel closed while agy is still starting', async () => {
  const id = add();
  let finish!: (value: AntigravitySnapshot) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(r => { finish = r as typeof finish; }));
  const start = ensureAntigravity(id, true);
  stopAntigravityWatch(id); useInstanceStore.getState().removeInstance(id);
  finish(snapshot());
  await expect(start).rejects.toThrow('cancelled');
  expect(invoke).toHaveBeenCalledWith('antigravity_close', { id });
  expect(useAntigravityStore.getState().sessions[id]).toBeUndefined();
});

it('shows a failed start with its reason and recovers on retry', async () => {
  const id = add();
  vi.mocked(invoke).mockRejectedValueOnce('Antigravity CLI (agy) was not found. Install it from https://antigravity.google/docs/cli/install/');
  await expect(ensureAntigravity(id, true)).rejects.toBeTruthy();
  expect(useAntigravityStore.getState().sessions[id]).toMatchObject({ configured: false, busy: false, error: expect.stringContaining('was not found') });
  await ensureAntigravity(id, true);
  expect(useAntigravityStore.getState().sessions[id]).toMatchObject({ configured: true, conversationId: 'conv-saved' });
  expect(useAntigravityStore.getState().sessions[id].error).toBeUndefined();
});

it('reports a lost backend session instead of polling forever, and ignores late snapshots after close', async () => {
  const id = add();
  await ensureAntigravity(id);
  vi.mocked(invoke).mockRejectedValueOnce('Open or resume this Antigravity panel first.');
  await vi.advanceTimersByTimeAsync(1200);
  expect(useAntigravityStore.getState().sessions[id]).toMatchObject({ configured: false, error: expect.stringContaining('Open or resume') });
  const calls = vi.mocked(invoke).mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(vi.mocked(invoke).mock.calls.length).toBe(calls);
  let finish!: (value: AntigravitySnapshot) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(r => { finish = r as typeof finish; }));
  const poll = refreshAntigravity(id, true);
  stopAntigravityWatch(id); finish(snapshot('conv-old')); await poll;
  expect(useAntigravityStore.getState().sessions[id]).toBeUndefined();
});

it('applies a model or permission change to the panel and restores it if the backend refuses', async () => {
  const id = add();
  await ensureAntigravity(id);
  vi.mocked(invoke).mockResolvedValueOnce(snapshot('conv-saved', { revision: 'backend:2', model: 'claude-sonnet-4-6' }));
  await reconfigureAntigravity(id, { model: 'claude-sonnet-4-6', permission: 'accept-edits' });
  expect(invoke).toHaveBeenLastCalledWith('antigravity_configure', { id, conversationId: 'conv-saved', start: false,
    config: expect.objectContaining({ model: 'claude-sonnet-4-6', permission: 'accept-edits' }) });
  expect(instance(id).config).toMatchObject({ model: 'claude-sonnet-4-6', antigravity: { model: 'claude-sonnet-4-6', permission: 'accept-edits' } });
  vi.mocked(invoke).mockRejectedValueOnce('Wait for the current turn to finish (or stop it) before changing this panel\'s settings.');
  await expect(reconfigureAntigravity(id, { permission: 'skip' })).rejects.toBeTruthy();
  expect(instance(id).config.antigravity?.permission).toBe('accept-edits');
  expect(useAntigravityStore.getState().sessions[id].error).toContain('Wait for the current turn');
});

it('leaves a terminal panel\'s status to its PTY', async () => {
  const id = add('C:/project', 'terminal');
  await ensureAntigravity(id);
  expect(instance(id).status).toBe('starting');
  useInstanceStore.getState().setStatus(id, 'stopped');
  await refreshAntigravity(id, true);
  expect(instance(id).status).toBe('stopped');
});

it('registers a restored panel inside a collapsed group for LAN and panel messages, without starting agy', async () => {
  const id = add();
  const group = useGroupStore.getState().createGroup(null);
  useLayoutStore.getState().addPanel(group, 'group');
  useGroupStore.getState().addToGroup(group, id);
  const stop = initAntigravityBridge();
  await vi.advanceTimersByTimeAsync(100);
  expect(invoke).toHaveBeenCalledWith('antigravity_configure', expect.objectContaining({ id, start: false }));
  expect(instance(id).antigravityConversationId).toBe('conv-saved');
  stop();
});
