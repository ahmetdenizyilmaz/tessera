import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { closePanel } from './panelCleanup';
import { captureClosedPanel, findRememberedPanel, installRecentPanelTracking, openRecentPanel, restoreClosedPanel } from './panelHistory';
import { removePlugin } from './pluginActions';
import { loadRemovedPlugins, REMOVED_PLUGINS_KEY } from './pluginAvailability';
import { beginPanelResize, readLevelGeometry } from './layoutHistory';
import { captureGroupSnapshot, ensurePanelAtLevel, getPanelLocations, removePanelsFromWorkspace, useGroupStore } from '../store/groupStore';
import { computeRects, useLayoutStore } from '../store/layoutStore';
import { useInstanceStore } from '../store/instanceStore';
import { usePluginStore } from '../store/pluginStore';
import { useLlmChatStore } from '../store/llmChatStore';
import { useWorkspaceHistoryStore as history } from '../store/workspaceHistoryStore';
import { RECENT_PANELS_KEY, useRecentPanelStore as recents } from '../store/recentPanelStore';
import { usePanelShortcutStore } from '../store/panelShortcutStore';
import { usePanelLockStore } from '../store/panelLockStore';
import { useWorkspaceWindowStore } from '../store/workspaceWindowStore';
import { useLanStore } from '../store/lanStore';
import { createDetachedLayout, connectDetachedLayout } from './detachedLayout';
import { registerBuiltins } from './builtinPlugins';
import { deserializeWorkspace, serializeWorkspace } from './workspaceSerializer';
import type { InstanceConfig } from '../types/instance';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/window', () => ({ Window: class { async setFocus() {} } }));
vi.mock('../components/terminal/XTermView', () => ({ clearTerminalState: vi.fn() }));
vi.mock('../hooks/usePty', () => ({ cleanupPty: vi.fn() }));
vi.mock('../hooks/useTerminal', () => ({ destroyTerminal: vi.fn() }));
vi.hoisted(() => {
  const items = new Map<string, string>();
  const storage = { getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value), removeItem: (key: string) => items.delete(key) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
});

const config: InstanceConfig = { cwd: 'C:/work', model: 'test', panelView: 'terminal', systemPrompt: '',
  permissionMode: 'default', dangerouslySkipPermissions: false, allowedTools: [], maxBudget: 0, agentMode: false };
const agent = (provider: InstanceConfig['agentProvider'] = 'claude', parent: string | null = null) => {
  const id = useInstanceStore.getState().addInstance({ ...config, agentProvider: provider }, `${provider} project`);
  useInstanceStore.getState().updateInstance(id, provider === 'codex' ? { codexThreadId: `thread-${id}`, codexHasTurns: true }
    : provider === 'opencode' ? { opencodeSessionId: `session-${id}`, opencodeDataId: `data-${id}` }
    : provider === 'antigravity' ? { antigravityConversationId: `conversation-${id}`, antigravityDataId: `data-${id}` }
    : { claudeSessionId: `session-${id}` });
  ensurePanelAtLevel(id, parent, 'terminal');
  return id;
};
const group = (parent: string | null = null) => {
  const id = useGroupStore.getState().createGroup(parent, 'Project group');
  ensurePanelAtLevel(id, parent, 'group'); return id;
};
const wizard = (parent: string | null = null) => {
  const id = 'wizard';
  useLayoutStore.setState(s => ({ widgetKinds: { ...s.widgetKinds, [id]: 'new-session' } }));
  ensurePanelAtLevel(id, parent, 'widget'); return id;
};
const resize = (store = useLayoutStore, width = .7) => {
  const commit = beginPanelResize(store);
  const state = store.getState();
  const fraction = { x: width, y: .5 };
  store.setState({ stealFraction: fraction, panelRects: computeRects(state.layoutConfig!, state.focusedId, fraction, []) });
  commit();
};
beforeEach(() => {
  vi.clearAllMocks();
  useLayoutStore.setState(useLayoutStore.getInitialState());
  useGroupStore.setState({ groups: new Map(), groupStack: [] });
  useGroupStore.getState().restoreGroups(new Map());
  useInstanceStore.setState({ instances: new Map() });
  usePluginStore.setState({ instances: new Map(), removedPlugins: new Set() }); registerBuiltins();
  localStorage.removeItem(REMOVED_PLUGINS_KEY);
  useLlmChatStore.setState({ conversations: {} });
  useWorkspaceWindowStore.setState({ windows: [] });
  usePanelShortcutStore.setState({ bindings: {} });
  usePanelLockStore.setState({ lockedIds: new Set() });
  useLanStore.setState({ status: null, hiddenPanelIds: [], hiddenPeerIds: [] });
  history.setState({ past: [], future: [], busy: false });
  recents.setState({ entries: [] });
});

it('removes all copies of a web add-on and prevents old snapshots or undo from reopening it until restored', async () => {
  const other = agent(), parent = group(), nested = group(parent);
  const name = usePluginStore.getState().addWebApp({ name: 'Player', url: 'https://player.test', icon: 'Music' });
  const definition = usePluginStore.getState().registry.get(name)!;
  const ids = [null, parent, nested].map(destination => {
    const id = usePluginStore.getState().createInstance(name);
    ensurePanelAtLevel(id, destination, 'plugin'); return id;
  });
  const saved = captureClosedPanel(ids[0])!, snapshot = serializeWorkspace();
  await removePlugin(name);
  expect(loadRemovedPlugins().has(name)).toBe(true);
  for (const id of ids) {
    expect(getPanelLocations().has(id)).toBe(false);
    expect(usePluginStore.getState().instances.has(id)).toBe(false);
  }
  expect(useInstanceStore.getState().instances.has(other)).toBe(true);
  expect(usePluginStore.getState().registry.get(name)).toEqual(definition);
  expect(usePluginStore.getState().createInstance(name)).toBe('');
  expect(restoreClosedPanel(saved)).toBe(false);
  deserializeWorkspace(snapshot);
  expect([...usePluginStore.getState().instances.values()].some(instance => instance.pluginName === name)).toBe(false);
  expect(getPanelLocations().has(ids[0])).toBe(false);
  usePluginStore.getState().setPluginRemoved(name, false);
  expect(restoreClosedPanel(saved)).toBe(true);
  expect(usePluginStore.getState().registry.get(name)?.browserSite).toBe(definition.browserSite);
});

it('keeps add-on panels open if saving removal fails', async () => {
  const id = usePluginStore.getState().createInstance('lichess');
  ensurePanelAtLevel(id, null, 'plugin');
  const storage = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
  try { await expect(removePlugin('lichess')).rejects.toThrow('Storage full'); }
  finally { storage.mockRestore(); }
  expect(usePluginStore.getState().removedPlugins.has('lichess')).toBe(false);
  expect(usePluginStore.getState().instances.has(id)).toBe(true);
  expect(getPanelLocations().has(id)).toBe(true);
});

it.each(['claude', 'codex', 'opencode', 'antigravity'] as const)('undo/redo resumes the same %s conversation and preserves other agents', async provider => {
  const other = agent();
  const id = agent(provider);
  const original = useInstanceStore.getState().instances.get(id)!;
  usePanelShortcutStore.getState().assign('3', id);
  await closePanel(id);
  expect(history.getState().past).toHaveLength(1);
  expect(getPanelLocations().has(id)).toBe(false);
  await history.getState().undo();
  expect(useInstanceStore.getState().instances.get(id)).toMatchObject({ ...original, status: 'starting' });
  expect(usePanelShortcutStore.getState().bindings['3']).toBe(id);
  expect(useLayoutStore.getState().tabOrder).toEqual([other, id]);
  await history.getState().redo();
  expect(useInstanceStore.getState().instances.has(id)).toBe(false);
  await history.getState().undo();
  expect(getPanelLocations().has(id)).toBe(true);
  expect(vi.mocked(invoke).mock.calls.some(([, args]) => (args as { id?: string })?.id === other)).toBe(false);
});

it('keeps API chat messages and captures new messages before redo closes it again', async () => {
  const id = agent();
  useLayoutStore.setState(s => ({ panelTypes: { ...s.panelTypes, [id]: 'llm' } }));
  useLlmChatStore.getState().addUserMessage(id, 'Original question');
  useLlmChatStore.getState().startStreaming(id);
  useLlmChatStore.getState().appendChunk(id, 'Partial answer');
  await closePanel(id); await history.getState().undo();
  const chat = useLlmChatStore.getState().getConversation(id);
  expect(chat.messages.map(m => m.content)).toEqual(['Original question', 'Partial answer']);
  expect(chat.isStreaming).toBe(false);
  expect(chat.messages.some(m => m.isStreaming)).toBe(false);
  useLlmChatStore.getState().addUserMessage(id, 'Follow-up');
  await history.getState().redo(); await history.getState().undo();
  expect(useLlmChatStore.getState().getConversation(id).messages.at(-1)?.content).toBe('Follow-up');
});

it('keeps the position lock through closing, undo, and redo without locking other panels', async () => {
  const other = agent(), id = agent('codex');
  usePanelLockStore.getState().setLocked(id, true);
  await closePanel(id);
  expect(usePanelLockStore.getState().lockedIds.has(id)).toBe(false);
  await history.getState().undo();
  expect(usePanelLockStore.getState().lockedIds).toEqual(new Set([id]));
  expect(getPanelLocations().has(other)).toBe(true);
  await history.getState().redo();
  expect(usePanelLockStore.getState().lockedIds.size).toBe(0);
});

it('closes and restores a nested group as one operation, without duplicating a child reopened separately', async () => {
  const outer = group(); const inner = group(outer); const id = agent('codex', inner); const other = agent();
  const child = captureClosedPanel(id)!;
  await closePanel(outer);
  expect(history.getState().past).toHaveLength(1);
  expect(getPanelLocations().size).toBe(1);
  openRecentPanel(child, wizard());
  await history.getState().undo();
  expect([...useInstanceStore.getState().instances.keys()].sort()).toEqual([id, other].sort());
  expect(getPanelLocations().get(id)).toBe(null);
  expect(useGroupStore.getState().groups.get(inner)?.childIds).toEqual([]);
  expect(useGroupStore.getState().groups.get(outer)?.childIds).toEqual([inner]);
});

it('reopens closed Lichess with its title and URL, focuses an existing match without creating a duplicate', async () => {
  const id = usePluginStore.getState().createInstance('lichess');
  usePluginStore.getState().setInstanceTitle(id, 'My chess');
  usePluginStore.getState().setBrowserUrl(id, 'https://lichess.org/analysis');
  ensurePanelAtLevel(id, null, 'plugin');
  await closePanel(id);
  const saved = recents.getState().entries[0].saved;
  expect(openRecentPanel(saved, wizard())).toBe(true);
  expect(usePluginStore.getState().instances.get(id)).toMatchObject({ title: 'My chess', browserUrl: 'https://lichess.org/analysis' });
  expect(openRecentPanel(saved, wizard())).toBe(true);
  expect(usePluginStore.getState().instances.size).toBe(1);
  expect(useLayoutStore.getState().tabOrder).toEqual([id]);
});

it('reopening respects the wizard location inside a detached group', async () => {
  const id = agent('antigravity'); await closePanel(id);
  const saved = recents.getState().entries[0].saved;
  const target = group(); const w = wizard(target);
  expect(openRecentPanel(saved, w)).toBe(true);
  expect(getPanelLocations().get(id)).toBe(target);
  expect(getPanelLocations().has(w)).toBe(false);
});

it('restores the last closed detached panel and its window, preserving Main', async () => {
  const main = agent(); const wrapper = useGroupStore.getState().createGroup(null); const id = agent('codex', wrapper);
  const window = { id: crypto.randomUUID(), groupId: wrapper, bounds: { x: 30, y: 40, width: 900, height: 700 } };
  useWorkspaceWindowStore.getState().add(window);
  await closePanel(id);
  // Mirror DetachedWindows removing an empty native workspace.
  removePanelsFromWorkspace([wrapper]); useWorkspaceWindowStore.getState().remove(window.id);
  await history.getState().undo();
  expect(useWorkspaceWindowStore.getState().windows).toEqual([window]);
  expect(getPanelLocations().get(id)).toBe(wrapper);
  expect(getPanelLocations().get(main)).toBe(null);
  expect(useLayoutStore.getState().tabOrder).toEqual([main]);
});

it('a whole detached window close restores all of its panels as one undo', async () => {
  const wrapper = useGroupStore.getState().createGroup(null); const a = agent('claude', wrapper); const b = agent('codex', wrapper);
  const window = { id: crypto.randomUUID(), groupId: wrapper };
  useWorkspaceWindowStore.getState().add(window);
  await closePanel(wrapper); useWorkspaceWindowStore.getState().remove(window.id);
  await history.getState().undo();
  expect(history.getState().past).toHaveLength(0);
  expect(useGroupStore.getState().groups.get(wrapper)?.childIds).toEqual([a, b]);
  expect(useWorkspaceWindowStore.getState().windows).toEqual([window]);
  expect(useLayoutStore.getState().tabOrder).toEqual([]);
});

it('does not put a new unrelated panel into an old layout when undoing close', async () => {
  const a = agent(); const b = agent(); await closePanel(a); const added = agent('codex');
  await history.getState().undo();
  expect([...getPanelLocations().keys()].sort()).toEqual([a, b, added].sort());
  expect(useLayoutStore.getState().panelRects.size).toBe(3);
});

it('does not record cancelled New Session wizards or repeated close clicks', async () => {
  await closePanel(wizard()); expect(history.getState().past).toEqual([]);
  const id = agent(); await Promise.all([closePanel(id), closePanel(id)]);
  expect(history.getState().past).toHaveLength(1);
  await closePanel(id); expect(history.getState().past).toHaveLength(1);
});

it('waits for an already-closing child before recording its group as closed', async () => {
  const g = group(); const id = agent('claude', g);
  let release!: () => void;
  const stopped = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(invoke).mockImplementation(async command => { if (command === 'pty_kill') await stopped; return undefined; });
  const childClose = closePanel(id);
  await Promise.resolve();
  const groupClose = closePanel(g);
  await Promise.resolve(); await Promise.resolve();
  expect(history.getState().past).toHaveLength(0);
  release(); await Promise.all([childClose, groupClose]);
  expect(getPanelLocations().size).toBe(0);
  await history.getState().undo();
  expect(getPanelLocations().get(id)).toBe(g);
  vi.mocked(invoke).mockImplementation(async () => undefined);
});

it('one resize gesture undoes/redoes its sizes without reverting a name or focus change', async () => {
  const a = agent(); const b = agent('codex');
  const before = useLayoutStore.getState().stealFraction;
  resize(); expect(history.getState().past).toHaveLength(1);
  useInstanceStore.getState().setName(a, 'Renamed'); useLayoutStore.getState().setFocused(a);
  await history.getState().undo(); expect(useLayoutStore.getState().stealFraction).toEqual(before);
  expect(useLayoutStore.getState().focusedId).toBe(a);
  expect(useInstanceStore.getState().instances.get(a)?.name).toBe('Renamed');
  await history.getState().redo(); expect(useLayoutStore.getState().stealFraction.x).toBe(.7);
  expect(useLayoutStore.getState().tabOrder).toEqual([a, b]);
});

it('records no-op/cancelled resizing zero times; skips obsolete geometry after adding a panel', async () => {
  agent(); agent(); beginPanelResize(useLayoutStore)();
  expect(history.getState().past).toHaveLength(0);
  resize(); const added = agent(); const after = useLayoutStore.getState().panelRects;
  await history.getState().undo();
  expect(useLayoutStore.getState().panelRects).toBe(after);
  expect(useLayoutStore.getState().tabOrder).toContain(added);
  expect(history.getState().past).toHaveLength(0);
});

it('undoes detached resizing independently from Main', async () => {
  const main = agent(); const wrapper = group(); agent('claude', wrapper); agent('codex', wrapper);
  const layout = createDetachedLayout(wrapper); const disconnect = connectDetachedLayout(layout, wrapper);
  try {
    const mainRects = useLayoutStore.getState().panelRects;
    const before = layout.getState().panelRects;
    resize(layout, .65); await history.getState().undo();
    expect(layout.getState().panelRects).toEqual(before);
    expect(useLayoutStore.getState().panelRects).toBe(mainRects);
    expect(getPanelLocations().get(main)).toBe(null);
    await history.getState().redo(); expect(layout.getState().stealFraction.x).toBe(.65);
  } finally { disconnect(); }
});
it('undoes and redoes exact resized slots after focus rotation without changing panel locks', async () => {
  const ids = [agent(), agent(), agent(), agent(), agent()];
  useLayoutStore.getState().setFocused(ids[0]);
  usePanelLockStore.getState().setLocked(ids[2], true);
  const commit = beginPanelResize(useLayoutStore);
  const state = useLayoutStore.getState();
  const config = { ...state.layoutConfig!, mainWidthPercent: 52 };
  state.setRawPanelRects(computeRects(config, ids[0], state.stealFraction));
  state.finishResize('x', [ids[0]], ids.slice(1)); commit();
  useLayoutStore.getState().setFocused(ids[1]);
  await history.getState().undo();
  expect(useLayoutStore.getState().panelRects.get(ids[1])?.w).toBe(80);
  await history.getState().redo();
  expect(useLayoutStore.getState().panelRects.get(ids[1])?.w).toBe(52);
  expect(usePanelLockStore.getState().lockedIds).toEqual(new Set([ids[2]]));
});

it('undoes an ancestor resize while inside a group, without changing navigation', async () => {
  const g = group(); agent(); agent('codex', g); resize();
  useGroupStore.getState().enterGroup(g); useGroupStore.getState().commitEnterGroup();
  await history.getState().undo();
  expect(useGroupStore.getState().getCurrentGroupId()).toBe(g);
  expect(captureGroupSnapshot().rootLayout?.stealFraction.x).toBe(.5);
  await history.getState().redo(); expect(readLevelGeometry(null)?.stealFraction.x).toBe(.7);
});

it('remaps live recent panels across workspace reload and clears obsolete undo history', async () => {
  const id = agent('codex'); const second = agent();
  recents.getState().remember(captureClosedPanel(id)!);
  resize(); const snapshot = serializeWorkspace(); deserializeWorkspace(snapshot);
  const saved = recents.getState().entries[0].saved;
  expect(saved.panel.id).not.toBe(id);
  expect(findRememberedPanel(saved.panel)).toBe(saved.panel.id);
  expect(history.getState().past).toHaveLength(0);
  expect(useInstanceStore.getState().instances.size).toBe(2);
  expect(useInstanceStore.getState().instances.has(second)).toBe(false);
  expect(JSON.parse(localStorage.getItem(RECENT_PANELS_KEY)!).entries[0].saved.panel.id).toBe(saved.panel.id);
});

it('bounds the persistent recent list and refreshes provider identity without duplicating a panel', () => {
  const id = agent(); const saved = captureClosedPanel(id)!;
  for (let i = 0; i < 55; i++) recents.getState().remember({ ...saved,
    panel: { ...saved.panel, id: `panel-${i}`, instance: { ...saved.panel.instance!, id: `panel-${i}`, claudeSessionId: `conversation-${i}` } } });
  expect(recents.getState().entries).toHaveLength(50);
  recents.getState().remember(saved);
  const updated = { ...saved, panel: { ...saved.panel, instance: { ...saved.panel.instance!, claudeSessionId: 'changed' } } };
  recents.getState().remember(updated);
  expect(recents.getState().entries.filter(e => e.saved.panel.id === id)).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem(RECENT_PANELS_KEY)!).entries).toHaveLength(50);
});

it('seeds existing panels into recents and updates renamed panels without recording undo', async () => {
  vi.useFakeTimers();
  const id = agent(); const stop = installRecentPanelTracking();
  try {
    await vi.advanceTimersByTimeAsync(260);
    expect(recents.getState().entries[0].saved.panel.id).toBe(id);
    useInstanceStore.getState().setName(id, 'New title');
    await vi.advanceTimersByTimeAsync(260);
    expect(recents.getState().entries[0].saved.panel.name).toBe('New title');
    expect(history.getState().past).toEqual([]);
  } finally { stop(); vi.useRealTimers(); }
});
