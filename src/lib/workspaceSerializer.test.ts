import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  serializeWorkspace,
  deserializeWorkspace,
} from "./workspaceSerializer";
import { useInstanceStore } from "../store/instanceStore";
import { useLayoutStore } from "../store/layoutStore";
import { useGroupStore } from "../store/groupStore";
import { usePanelShortcutStore } from '../store/panelShortcutStore';
import { usePluginStore } from '../store/pluginStore';
import { usePanelLockStore } from '../store/panelLockStore';
import { useAppearanceStore, getPanelBackground } from '../store/appearanceStore';
import { DEFAULT_BACKGROUND } from './panelBackground';
import { useWorkspaceWindowStore } from '../store/workspaceWindowStore';
import { registerBuiltins } from './builtinPlugins';
import type { InstanceConfig } from "../types/instance";
import { DEFAULT_OPENCODE_OPTIONS } from './opencodeConfig';
import { DEFAULT_ANTIGRAVITY_OPTIONS } from './antigravityConfig';

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => true) }));
vi.mock("../store/llmChatStore", () => ({
  useLlmChatStore: {
    setState: vi.fn(),
    getState: () => ({ remapConversations: vi.fn() }),
  },
}));
const config: InstanceConfig = {
  cwd: "C:/project",
  model: "sonnet",
  systemPrompt: "",
  permissionMode: "default",
  dangerouslySkipPermissions: false,
  allowedTools: [],
  maxBudget: 0,
  agentMode: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  useInstanceStore.setState({ instances: new Map() });
  usePluginStore.setState({ instances: new Map() });
  useWorkspaceWindowStore.setState({ windows: [] });
  useLayoutStore.setState({
    tabOrder: [],
    panelTypes: {},
    panelRects: new Map(),
    layoutConfig: null,
    widgetKinds: {},
    activeTabId: null,
    focusedId: null,
  });
  useGroupStore.setState({ groups: new Map(), groupStack: [] });
  useGroupStore.getState().restoreGroups(new Map());
  usePanelShortcutStore.getState().restore({});
  usePanelLockStore.setState({ lockedIds: new Set() });
  useAppearanceStore.setState({global:{...DEFAULT_BACKGROUND},panels:{}});
});
it('backgrounds survive workspace restore with new agent IDs and stable app IDs',()=>{
  const agent=useInstanceStore.getState().addInstance({...config,panelView:'terminal'});
  useLayoutStore.getState().addPanel(agent,'terminal');
  const widget=useLayoutStore.getState().addWidgetPanel('timer');
  const background={...DEFAULT_BACKGROUND,mode:'image' as const,imageId:'test-image',fit:'contain' as const};
  useAppearanceStore.getState().setPanel(agent,background);
  useAppearanceStore.getState().setPanel(widget,{...DEFAULT_BACKGROUND,mode:'color',color:'#112233'});
  useAppearanceStore.getState().setPanel('closed',{...DEFAULT_BACKGROUND,mode:'color'});
  const saved=serializeWorkspace();expect(Object.keys(saved.panelBackgrounds!)).toEqual([agent,widget]);
  useAppearanceStore.setState({panels:{}});deserializeWorkspace(saved);
  const newAgent=[...useInstanceStore.getState().instances.keys()][0];
  expect(newAgent).not.toBe(agent);expect(getPanelBackground(newAgent)).toEqual(background);
  expect(getPanelBackground(widget).color).toBe('#112233');
});

it('restores sleeping panels without ageing recently used panels during time offline', () => {
  const asleep = useInstanceStore.getState().addInstance({ ...config, panelView: 'terminal' }, 'Sleeping');
  const recent = useInstanceStore.getState().addInstance(config, 'Recent');
  useLayoutStore.getState().addPanel(asleep, 'terminal'); useLayoutStore.getState().addPanel(recent, 'terminal');
  const previewId = crypto.randomUUID();
  useInstanceStore.getState().updateInstance(asleep, { claudeSessionId: 'saved-conversation',
    hibernation: { sleeping: true, idleMs: 3600_000, previewId } });
  useInstanceStore.getState().updateInstance(recent, { hibernation: { sleeping: false, idleMs: 120_000 } });
  const saved = serializeWorkspace(); saved.savedAt -= 7 * 86400_000;
  deserializeWorkspace(saved);
  const restored = [...useInstanceStore.getState().instances.values()];
  const sleeper = restored.find(i => i.name === 'Sleeping')!;
  expect(sleeper.id).not.toBe(asleep);
  expect(sleeper).toMatchObject({ status: 'stopped', claudeSessionId: 'saved-conversation',
    hibernation: { sleeping: true, idleMs: 3600_000, previewId } });
  expect(restored.find(i => i.name === 'Recent')?.hibernation).toMatchObject({ sleeping: false, idleMs: 120_000 });
  expect(invoke).toHaveBeenCalledWith('panel_hibernation_restore', { ids: [sleeper.id] });
});
it('restores panel locks with remapped agent IDs and keeps custom slot geometry through focus changes', () => {
  const agent = useInstanceStore.getState().addInstance({ ...config, panelView: 'terminal' });
  useLayoutStore.getState().addPanel(agent, 'terminal');
  const widget = useLayoutStore.getState().addWidgetPanel('timer');
  usePanelLockStore.getState().setLocked(agent, true);
  usePanelLockStore.getState().setLocked(widget, true);
  usePanelLockStore.getState().setLocked('closed-orphan', true);
  useLayoutStore.getState().setRawPanelRects(new Map([[agent, { x: 0, y: 0, w: 60, h: 100 }], [widget, { x: 60, y: 0, w: 40, h: 100 }]]));
  useLayoutStore.getState().finishResize('x', [agent], [widget]);
  const saved = serializeWorkspace();
  expect(saved.lockedPanelIds).toEqual([agent, widget]);
  deserializeWorkspace(saved);
  const restoredAgent = [...useInstanceStore.getState().instances.keys()][0];
  expect(usePanelLockStore.getState().lockedIds).toEqual(new Set([restoredAgent, widget]));
  expect(useLayoutStore.getState().layoutConfig?.slotRects?.map(r => r.w)).toEqual([60, 40]);
  useLayoutStore.getState().setFocused(restoredAgent);
  expect([...useLayoutStore.getState().panelRects.values()].map(r => r.w).sort()).toEqual([40, 60]);
});
it('retains a pinned Claude session ID before its first transcript is written', async () => {
  const id = useInstanceStore.getState().addInstance({ ...config, panelView: 'terminal' });
  const sessionId = crypto.randomUUID();
  useInstanceStore.getState().setClaudeSessionId(id, sessionId);
  useLayoutStore.getState().addPanel(id, 'terminal');
  const snapshot = serializeWorkspace();
  vi.mocked(invoke).mockResolvedValueOnce(false);
  deserializeWorkspace(snapshot);
  await Promise.resolve(); await Promise.resolve();
  expect([...useInstanceStore.getState().instances.values()][0].claudeSessionId).toBe(sessionId);
  expect(invoke).not.toHaveBeenCalledWith('session_exists', expect.anything());
});

it('restores HTML app identity and transfers optional grants only to the exact restored agent', () => {
  const pluginName = 'html-test.restore';
  usePluginStore.getState().registerHtmlApp({ name: pluginName, defaultTitle: 'Local notes', version: '1',
    description: '', entry: 'index.html', icon: 'NotebookPen', htmlPlugin: true, browserSite: pluginName,
    permissions: { network: [], panels: ['list', 'send'] } });
  try {
    const agent = useInstanceStore.getState().addInstance({ ...config, panelView: 'terminal' });
    useLayoutStore.getState().addPanel(agent, 'terminal');
    const app = usePluginStore.getState().createInstance(pluginName);
    useLayoutStore.getState().addPanel(app, 'plugin');
    const saved = serializeWorkspace();
    deserializeWorkspace(saved);
    const restoredAgent = [...useInstanceStore.getState().instances.keys()][0];
    expect(restoredAgent).not.toBe(agent);
    expect(usePluginStore.getState().instances.get(app)?.pluginName).toBe(pluginName);
    expect(invoke).toHaveBeenCalledWith('html_plugin_remap_targets', { mapping: { [agent]: restoredAgent } });
  } finally {
    const registry = new Map(usePluginStore.getState().registry); registry.delete(pluginName);
    usePluginStore.setState({ registry, instances: new Map() });
  }
});
it('restores independent detached tabs and bounds, and recovers an invalid window to Main', () => {
  registerBuiltins();
  const browser = usePluginStore.getState().createInstance('lichess');
  useLayoutStore.getState().addPanel(browser, 'plugin');
  const agent = useInstanceStore.getState().addInstance(config);
  useLayoutStore.getState().addPanel(agent);
  const root = useGroupStore.getState().createGroup(null, 'Window 1');
  useGroupStore.getState().movePanelToLevel(browser, root);
  useGroupStore.getState().movePanelToLevel(agent, root);
  const workspace = { id: '55e746ba-ab41-4544-8ab0-631886b024ac', groupId: root, bounds: { x: -1200, y: 50, width: 1100, height: 700 } };
  useWorkspaceWindowStore.getState().add(workspace);
  const saved = JSON.parse(JSON.stringify(serializeWorkspace()));
  expect(saved.layout.tabOrder).toEqual([]);
  deserializeWorkspace(saved);
  expect(useWorkspaceWindowStore.getState().windows).toEqual([workspace]);
  const children = useGroupStore.getState().groups.get(root)!.childIds;
  expect(children).toContain(browser);
  expect(children).toHaveLength(2);
  expect(useInstanceStore.getState().instances.has(children.find(id => id !== browser)!)).toBe(true);
  expect(useLayoutStore.getState().tabOrder).toEqual([]);
  deserializeWorkspace({ ...saved, windows: [{ ...workspace, id: 'broken' }] });
  expect(useWorkspaceWindowStore.getState().windows).toEqual([]);
  expect(useLayoutStore.getState().tabOrder).toContain(root);
});
it('restores a Lichess panel, saved page, and group after a complete restart', () => {
  registerBuiltins();
  const id = usePluginStore.getState().createInstance('lichess');
  usePluginStore.getState().setBrowserUrl(id, 'https://lichess.org/abcdefgh/white');
  useLayoutStore.getState().addPanel(id, 'plugin');
  const group = useGroupStore.getState().createGroup(null, 'Games');
  useLayoutStore.getState().addPanel(group, 'group');
  useGroupStore.getState().movePanelToLevel(id, group);
  const saved = JSON.parse(JSON.stringify(serializeWorkspace()));
  usePluginStore.setState({ instances: new Map() });
  deserializeWorkspace(saved);
  expect(usePluginStore.getState().instances.get(id)).toMatchObject({ title: 'Lichess', browserUrl: 'https://lichess.org/abcdefgh/white' });
  expect(useGroupStore.getState().groups.get(group)?.childIds).toContain(id);
  expect(useLayoutStore.getState().panelTypes[id]).toBe('plugin');
  const next = serializeWorkspace();
  deserializeWorkspace({ ...next, plugins: [], groups: {}, layout: { ...next.layout, tabOrder: [], panelTypes: {} } });
  expect(usePluginStore.getState().instances.has(id)).toBe(false);
});
it('restores a custom website definition and its grouped panel from an exported workspace', () => {
  const name = usePluginStore.getState().addWebApp({ name: 'My player', url: 'https://player.example.test', icon: 'Music' });
  const manifest = usePluginStore.getState().registry.get(name)!;
  const id = usePluginStore.getState().createInstance(name);
  usePluginStore.getState().setBrowserUrl(id, 'https://player.example.test/library');
  useLayoutStore.getState().addPanel(id, 'plugin');
  const group = useGroupStore.getState().createGroup(null, 'Music');
  useLayoutStore.getState().addPanel(group, 'group');
  useGroupStore.getState().movePanelToLevel(id, group);
  const saved = JSON.parse(JSON.stringify(serializeWorkspace()));
  expect(saved.plugins[0].webApp).toEqual(manifest);
  usePluginStore.setState({ registry: new Map(), instances: new Map() });
  deserializeWorkspace(saved);
  expect(usePluginStore.getState().registry.get(name)).toEqual(manifest);
  expect(usePluginStore.getState().instances.get(id)).toMatchObject({ pluginName: name, title: 'My player', icon: 'Music', browserUrl: 'https://player.example.test/library' });
  expect(useGroupStore.getState().groups.get(group)?.childIds).toContain(id);
  expect(useLayoutStore.getState().panelTypes[id]).toBe('plugin');
  expect(serializeWorkspace().plugins[0].webApp?.browserSite).toBe(manifest.browserSite);
});
it("restores an unsent Codex panel without an unresumable thread ID", () => {
  const id = useInstanceStore
    .getState()
    .addInstance({ ...config, agentProvider: "codex" }, "Empty Codex");
  useInstanceStore
    .getState()
    .updateInstance(id, {
      codexThreadId: "not-materialized",
      codexHasTurns: false,
    });
  useLayoutStore.getState().addPanel(id);
  const saved = serializeWorkspace();
  expect(saved.instances[0].codexThreadId).toBeUndefined();
  deserializeWorkspace(saved);
  expect(serializeWorkspace().instances[0]).toMatchObject({
    name: "Empty Codex",
    config: { agentProvider: "codex" },
  });
  expect(serializeWorkspace().instances[0].codexThreadId).toBeUndefined();
});
it("saves and restores a persisted empty Codex terminal without inventing a turn", () => {
  const id = useInstanceStore.getState().addInstance({ ...config, agentProvider: "codex", panelView: "terminal" });
  useInstanceStore.getState().updateInstance(id, {
    codexThreadId: "persisted-empty", codexHasTurns: false, codexResumable: true,
  });
  useLayoutStore.getState().addPanel(id);
  const saved = JSON.parse(JSON.stringify(serializeWorkspace()));
  expect(saved.instances[0]).toMatchObject({ codexThreadId: "persisted-empty", codexHasTurns: false });
  deserializeWorkspace(saved);
  expect([...useInstanceStore.getState().instances.values()][0]).toMatchObject({
    codexThreadId: "persisted-empty", codexHasTurns: false, codexResumable: true,
    config: { panelView: "terminal" },
  });
  expect(serializeWorkspace().instances[0].codexThreadId).toBe("persisted-empty");
});
it('round-trips OpenCode view, endpoint, permissions, storage and conversation without Claude IDs', () => {
  const options = { ...DEFAULT_OPENCODE_OPTIONS, provider: 'ollama' as const, model: 'local-coder', baseUrl: 'http://localhost:11434/v1' };
  const id = useInstanceStore.getState().addInstance({ ...config, agentProvider: 'opencode', panelView: 'terminal', model: options.model, opencode: options });
  useInstanceStore.getState().updateInstance(id, { opencodeDataId: 'data-identity', opencodeSessionId: 'ses_opencode' });
  useLayoutStore.getState().addPanel(id);
  const saved = JSON.parse(JSON.stringify(serializeWorkspace()));
  deserializeWorkspace(saved);
  const restored = serializeWorkspace().instances[0];
  expect(restored.id).not.toBe(id);
  expect(restored).toMatchObject({ opencodeDataId: 'data-identity', opencodeSessionId: 'ses_opencode', config: { agentProvider: 'opencode', panelView: 'terminal', opencode: options } });
  expect(restored.claudeSessionId).toBeUndefined();
  expect(restored.codexThreadId).toBeUndefined();
  expect(JSON.stringify(restored)).not.toContain('apiKey');
});
it('round-trips Antigravity view, model, permissions, storage and exact conversation without other provider IDs', () => {
  const options = { ...DEFAULT_ANTIGRAVITY_OPTIONS, model: 'gemini-3.8-flash-low', permission: 'accept-edits' as const, sandbox: true };
  const id = useInstanceStore.getState().addInstance({ ...config, agentProvider: 'antigravity', panelView: 'terminal', model: options.model, antigravity: options }, 'Gemini build');
  useInstanceStore.getState().updateInstance(id, { antigravityDataId: 'agy-data', antigravityConversationId: '74b2286b-bb93-41f1-9263-47fd8aa9c584' });
  useLayoutStore.getState().addPanel(id);
  const saved = JSON.parse(JSON.stringify(serializeWorkspace()));
  deserializeWorkspace(saved);
  // A mid-session load ends the old panel's agy process before restoring.
  expect(invoke).toHaveBeenCalledWith('antigravity_close', { id });
  const restored = serializeWorkspace().instances[0];
  expect(restored.id).not.toBe(id);
  expect(restored).toMatchObject({ name: 'Gemini build', antigravityDataId: 'agy-data', antigravityConversationId: '74b2286b-bb93-41f1-9263-47fd8aa9c584',
    config: { agentProvider: 'antigravity', panelView: 'terminal', cwd: 'C:/project', model: 'gemini-3.8-flash-low', antigravity: options } });
  expect([restored.claudeSessionId, restored.codexThreadId, restored.opencodeSessionId]).toEqual([undefined, undefined, undefined]);
});
it('retains a saved Antigravity conversation when its transcript storage ID is missing', () => {
  const options = { ...DEFAULT_ANTIGRAVITY_OPTIONS };
  for (const name of ['Original', 'Duplicate']) {
    const id = useInstanceStore.getState().addInstance({ ...config, agentProvider: 'antigravity', antigravity: options }, name);
    useInstanceStore.getState().updateInstance(id, { antigravityConversationId: 'saved-conversation' });
    useLayoutStore.getState().addPanel(id);
  }
  deserializeWorkspace(JSON.parse(JSON.stringify(serializeWorkspace())));
  const [original, duplicate] = serializeWorkspace().instances;
  expect(original).toMatchObject({ antigravityConversationId: 'saved-conversation', antigravityDataId: expect.any(String) });
  expect(duplicate.antigravityConversationId).toBeUndefined();
  expect(duplicate.antigravityDataId).toBeUndefined();
  // A second restart keeps the newly allocated storage identity too.
  deserializeWorkspace(JSON.parse(JSON.stringify(serializeWorkspace())));
  expect(serializeWorkspace().instances[0]).toMatchObject({ antigravityConversationId: original.antigravityConversationId, antigravityDataId: original.antigravityDataId });
});
it('never restores two panels onto one Antigravity conversation or transcript', () => {
  const options = { ...DEFAULT_ANTIGRAVITY_OPTIONS };
  const make = (name: string, dataId: string, conversation?: string) => {
    const id = useInstanceStore.getState().addInstance({ ...config, agentProvider: 'antigravity', panelView: 'chat', model: '', antigravity: options }, name);
    useInstanceStore.getState().updateInstance(id, { antigravityDataId: dataId, antigravityConversationId: conversation });
    useLayoutStore.getState().addPanel(id);
  };
  make('First', 'data-1', 'conv-shared');
  make('Same conversation', 'data-2', 'conv-shared');
  make('Same storage', 'data-1', 'conv-other');
  make('Unsent', 'data-3');
  make('Independent', 'data-4', 'conv-independent');
  deserializeWorkspace(JSON.parse(JSON.stringify(serializeWorkspace())));
  const restored = Object.fromEntries(serializeWorkspace().instances.map(i => [i.name, [i.antigravityDataId, i.antigravityConversationId]]));
  expect(restored).toEqual({ First: ['data-1', 'conv-shared'], 'Same conversation': [undefined, undefined], 'Same storage': [undefined, undefined],
    Unsent: ['data-3', undefined], Independent: ['data-4', 'conv-independent'] });
});
it("round-trips a mixed group with independent Claude and Codex identities", () => {
  const store = useInstanceStore.getState();
  const claude = store.addInstance(config, "Claude");
  const codex = store.addInstance(
    {
      ...config,
      agentProvider: "codex",
      codex: { sandbox: "workspace-write", effort: "high", approvalsReviewer: "auto_review" },
    },
    "Codex",
  );
  store.setClaudeSessionId(claude, "claude-thread");
  store.updateInstance(codex, { codexThreadId: "codex-thread" });
  const group = useGroupStore.getState().createGroup(null);
  useLayoutStore.getState().addPanel(group, "group");
  useGroupStore.getState().addToGroup(group, claude);
  useGroupStore.getState().addToGroup(group, codex);
  const saved = serializeWorkspace();
  deserializeWorkspace(saved);
  const restored = serializeWorkspace();
  expect(restored.instances).toHaveLength(2);
  expect(restored.instances.find((i) => i.name === "Codex")).toMatchObject({
    codexThreadId: "codex-thread",
    config: {
      agentProvider: "codex",
      codex: { sandbox: "workspace-write", effort: "high", approvalsReviewer: "auto_review" },
    },
  });
  expect(restored.instances.find((i) => i.name === "Claude")).toMatchObject({
    claudeSessionId: "claude-thread",
  });
  expect(restored.groups[group].childIds).toHaveLength(2);
  expect(restored.groups[group].childIds).not.toContain(codex);
  expect(invoke).toHaveBeenCalledWith("codex_close", { id: codex });
  expect(invoke).toHaveBeenCalledWith("pty_kill", { id: claude });
});
it("restores legacy workspaces as Claude without inventing a Codex identity", () => {
  deserializeWorkspace({
    version: 2,
    instances: [
      {
        id: "old",
        name: "Legacy Claude",
        config,
        claudeSessionId: "old-session",
      },
    ],
  });
  const restored = serializeWorkspace().instances[0];
  expect(restored.config.agentProvider).toBeUndefined();
  expect(restored.codexThreadId).toBeUndefined();
  expect(restored.claudeSessionId).toBe("old-session");
});
it("does not resume the same Codex thread twice from a duplicated snapshot", () => {
  deserializeWorkspace({
    version: 3,
    instances: ["a", "b"].map((id) => ({
      id,
      name: id,
      config: { ...config, agentProvider: "codex" },
      codexThreadId: "same-thread",
    })),
    groups: {},
    plugins: [],
  });
  expect(
    serializeWorkspace().instances.filter(
      (i) => i.codexThreadId === "same-thread",
    ),
  ).toHaveLength(1);
});

it("round-trips a LAN subgroup without creating local agent instances", () => {
  const groupId = useGroupStore.getState().createGroup(null, "Workshop PC");
  const remoteId = "lan:peer-1:panel-1";
  useGroupStore.setState((state) => {
    const groups = new Map(state.groups);
    groups.set(groupId, {
      ...groups.get(groupId)!,
      remotePeerId: "peer-1",
      childIds: [remoteId],
      activeChildId: remoteId,
      focusedChildId: remoteId,
    });
    return { groups };
  });
  useLayoutStore.getState().addPanel(groupId, "group");
  useLayoutStore.setState((state) => ({ panelTypes: { ...state.panelTypes, [remoteId]: "remote" } }));

  const saved = serializeWorkspace();
  deserializeWorkspace(saved);
  const restored = serializeWorkspace();
  expect(restored.instances).toHaveLength(0);
  expect(restored.groups[groupId]).toMatchObject({
    name: "Workshop PC",
    remotePeerId: "peer-1",
    childIds: [remoteId],
  });
  expect(restored.layout.panelTypes[remoteId]).toBe("remote");
});

it('round-trips shortcut assignments using restored panel IDs, not old instance IDs', () => {
  const first = useInstanceStore.getState().addInstance(config, 'Assigned root');
  useLayoutStore.getState().addPanel(first);
  const group = useGroupStore.getState().createGroup(null, 'Assigned group');
  useLayoutStore.getState().addPanel(group, 'group');
  const child = useInstanceStore.getState().addInstance(config, 'Assigned child');
  useGroupStore.getState().addToGroup(group, child);
  useLayoutStore.setState(state => ({ panelTypes: { ...state.panelTypes, [child]: 'terminal' } }));
  usePanelShortcutStore.getState().restore({ 0: first, 1: child, 2: group, 3: 'closed' });
  const saved = serializeWorkspace();
  expect(saved.panelShortcuts).toEqual({ 0: first, 1: child, 2: group });
  deserializeWorkspace(saved);
  const restored = [...useInstanceStore.getState().instances.values()];
  expect(usePanelShortcutStore.getState().bindings).toEqual({
    0: restored.find(instance => instance.name === 'Assigned root')!.id,
    1: restored.find(instance => instance.name === 'Assigned child')!.id,
    2: group,
  });
  expect(usePanelShortcutStore.getState().bindings['0']).not.toBe(first);
});

it('loading an older workspace clears shortcuts from the previous workspace', () => {
  usePanelShortcutStore.getState().assign('1', 'old-panel');
  deserializeWorkspace({ version: 3, instances: [], groups: {}, plugins: [] });
  expect(usePanelShortcutStore.getState().bindings).toEqual({});
});

function resizeMain(width: number) {
  const state = useLayoutStore.getState();
  const [main, ...side] = state.layoutConfig!.panelOrder;
  state.setPanelRect(main, { ...state.panelRects.get(main)!, w: width });
  state.finishResize('x', [main], side.slice(0, 4));
  state.setFocused(main);
}

it.each([false, true])('saves the main divider across workspace reload (legacy rectangles: %s)', legacy => {
  for (let i = 0; i < 5; i++) {
    const id = useInstanceStore.getState().addInstance(config, `Panel ${i}`);
    useLayoutStore.getState().addPanel(id);
  }
  resizeMain(50);
  const snapshot = JSON.parse(JSON.stringify(serializeWorkspace()));
  if (legacy) delete snapshot.layout.layoutConfig.mainWidthPercent;
  deserializeWorkspace(snapshot);
  const restored = useLayoutStore.getState();
  for (const id of restored.tabOrder) {
    restored.setFocused(id);
    expect(useLayoutStore.getState().panelRects.get(id)?.w).toBe(50);
  }
  expect(serializeWorkspace().layout.layoutConfig?.mainWidthPercent).toBe(50);
});

it.each(['terminal', 'remote'] as const)('keeps independent root and %s-group divider widths through navigation and reload', panelType => {
  const group = useGroupStore.getState().createGroup(null, 'Stack');
  useLayoutStore.getState().addPanel(group, 'group');
  for (let i = 0; i < 4; i++) {
    const id = useInstanceStore.getState().addInstance(config, `Root ${i}`);
    useLayoutStore.getState().addPanel(id);
  }
  resizeMain(55);
  for (let i = 0; i < 5; i++) {
    const id = panelType === 'remote' ? `lan:test:${i}`
      : useInstanceStore.getState().addInstance(config, `Child ${i}`);
    useGroupStore.getState().addToGroup(group, id);
    useLayoutStore.setState(state => ({ panelTypes: { ...state.panelTypes, [id]: panelType } }));
  }
  useGroupStore.getState().enterGroup(group);
  useGroupStore.getState().commitEnterGroup();
  resizeMain(65);
  useGroupStore.getState().exitGroup();
  useLayoutStore.getState().cycleFocus(1);
  expect(useLayoutStore.getState().layoutConfig?.mainWidthPercent).toBe(55);
  useGroupStore.getState().enterGroup(group);
  useGroupStore.getState().commitEnterGroup();
  useLayoutStore.getState().cycleFocus(1);
  expect(useLayoutStore.getState().layoutConfig?.mainWidthPercent).toBe(65);
  // Saving while deeper inside a subgroup must also capture the ancestor's
  // live divider, not its stale layout from before navigation.
  const nested = useGroupStore.getState().createGroup(group, 'Nested');
  useGroupStore.getState().addToGroup(group, nested);
  useLayoutStore.getState().addPanel(nested, 'group');
  resizeMain(62);
  useGroupStore.getState().enterGroup(nested);
  useGroupStore.getState().commitEnterGroup();
  const snapshot = JSON.parse(JSON.stringify(serializeWorkspace()));
  expect(snapshot.layout.layoutConfig.mainWidthPercent).toBe(55);
  expect(snapshot.groups[group].layoutConfig.mainWidthPercent).toBe(62);
  deserializeWorkspace(snapshot);
  useLayoutStore.getState().cycleFocus(1);
  expect(useLayoutStore.getState().panelRects.get(useLayoutStore.getState().focusedId!)?.w).toBe(55);
  useGroupStore.getState().enterGroup(group);
  useGroupStore.getState().commitEnterGroup();
  useLayoutStore.getState().cycleFocus(1);
  expect(useLayoutStore.getState().panelRects.get(useLayoutStore.getState().focusedId!)?.w).toBe(62);
  useGroupStore.getState().exitGroup();
});
