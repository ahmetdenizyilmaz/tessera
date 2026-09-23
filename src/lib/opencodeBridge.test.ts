import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { ensureOpenCode, initOpenCodeBridge, refreshOpenCode, stopOpenCodeWatch } from './opencodeBridge';
import { useOpenCodeStore } from '../store/opencodeStore';
import { useInstanceStore } from '../store/instanceStore';
import { DEFAULT_OPENCODE_OPTIONS } from './opencodeConfig';
import type { OpenCodeSnapshot } from '../types/opencode';
import { useGroupStore } from '../store/groupStore';
import { useLayoutStore } from '../store/layoutStore';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./forkActions', () => ({ peekForkContext: vi.fn(() => null), markForkConsumed: vi.fn() }));
let id: string;
const snapshot = (sid = 'ses_saved'): OpenCodeSnapshot => ({ generation: 'server', sessionId: sid, connected: true, status: { type: 'idle' }, messages: [], permissions: [], questions: [] });
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  useInstanceStore.setState({ instances: new Map() }); useOpenCodeStore.setState({ sessions: {} });
  useLayoutStore.setState({ tabOrder: [], panelTypes: {}, panelRects: new Map(), layoutConfig: null, activeTabId: null, focusedId: null });
  useGroupStore.getState().restoreGroups(new Map());
  useGroupStore.setState({ groups: new Map() });
  id = useInstanceStore.getState().addInstance({ agentProvider: 'opencode', opencode: { ...DEFAULT_OPENCODE_OPTIONS, model: 'vendor/model' }, cwd: 'C:/project', model: 'vendor/model', panelView: 'chat', systemPrompt: '', permissionMode: 'default', dangerouslySkipPermissions: false, allowedTools: [], maxBudget: 0, agentMode: false });
  vi.mocked(invoke).mockResolvedValue(snapshot());
});
afterEach(() => { stopOpenCodeWatch(id); vi.useRealTimers(); });
it('configures once per panel, pins an independent storage ID, and never invokes Claude', async () => {
  await Promise.all([ensureOpenCode(id), ensureOpenCode(id)]);
  expect(vi.mocked(invoke).mock.calls.map(c => c[0])).toEqual(['opencode_configure']);
  expect(useInstanceStore.getState().instances.get(id)).toMatchObject({ opencodeSessionId: 'ses_saved', opencodeDataId: expect.any(String) });
  expect(useInstanceStore.getState().instances.get(id)?.claudeSessionId).toBeUndefined();
  await ensureOpenCode(id);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it('resumes the exact identity from a saved panel, independently of global defaults', async () => {
  useInstanceStore.getState().updateInstance(id, { opencodeDataId: 'stored-data-id', opencodeSessionId: 'ses_restored' });
  await ensureOpenCode(id);
  expect(invoke).toHaveBeenCalledWith('opencode_configure', { id, sessionId: 'ses_restored', config: expect.objectContaining({ dataId: 'stored-data-id', model: 'vendor/model' }) });
});
it('keeps the current transcript when the server reports an unchanged revision', async () => {
  vi.mocked(invoke).mockResolvedValueOnce({ ...snapshot(), revision: 'server:10' });
  await ensureOpenCode(id);
  const before = useOpenCodeStore.getState().sessions[id];
  vi.mocked(invoke).mockResolvedValueOnce(null);
  await refreshOpenCode(id);
  expect(invoke).toHaveBeenLastCalledWith('opencode_snapshot', { id, knownRevision: 'server:10' });
  expect(useOpenCodeStore.getState().sessions[id]).toBe(before);
});
it('does not resurrect a panel closed while startup is pending', async () => {
  let finish!: (value: OpenCodeSnapshot) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(r => { finish = r as typeof finish; }));
  const start = ensureOpenCode(id);
  stopOpenCodeWatch(id); useInstanceStore.getState().removeInstance(id);
  finish(snapshot());
  await expect(start).rejects.toThrow('cancelled');
  expect(invoke).toHaveBeenCalledWith('opencode_close', { id });
  expect(useInstanceStore.getState().instances.has(id)).toBe(false);
  expect(useOpenCodeStore.getState().sessions[id]).toBeUndefined();
});
it('ignores a late snapshot after disconnect and saves native session/model changes', async () => {
  await ensureOpenCode(id);
  vi.mocked(invoke).mockResolvedValueOnce({ ...snapshot('ses_native_new'), model: 'vendor/other', agent: 'plan' });
  await refreshOpenCode(id);
  expect(useInstanceStore.getState().instances.get(id)).toMatchObject({ opencodeSessionId: 'ses_native_new', config: { model: 'vendor/other', opencode: { agent: 'plan' } } });
  let finish!: (value: OpenCodeSnapshot) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(r => { finish = r as typeof finish; }));
  const poll = refreshOpenCode(id);
  stopOpenCodeWatch(id); finish(snapshot('ses_old')); await poll;
  expect(useOpenCodeStore.getState().sessions[id]).toBeUndefined();
});
it('does not mark an exited native terminal as running just because its server is alive', async () => {
  const inst = useInstanceStore.getState().instances.get(id)!;
  useInstanceStore.getState().updateInstance(id, { config: { ...inst.config, panelView: 'terminal' } });
  await ensureOpenCode(id);
  useInstanceStore.getState().setStatus(id, 'stopped');
  await refreshOpenCode(id);
  expect(useInstanceStore.getState().instances.get(id)?.status).toBe('stopped');
});
it('starts a restored OpenCode conversation inside a collapsed group for LAN and MCP reads', async () => {
  const group = useGroupStore.getState().createGroup(null);
  useLayoutStore.getState().addPanel(group, 'group');
  useGroupStore.getState().addToGroup(group, id);
  const stop = initOpenCodeBridge();
  await vi.advanceTimersByTimeAsync(100);
  expect(invoke).toHaveBeenCalledWith('opencode_configure', expect.objectContaining({ id }));
  expect(useInstanceStore.getState().instances.get(id)?.opencodeSessionId).toBe('ses_saved');
  stop();
});
