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
import type { InstanceConfig } from "../types/instance";
import { DEFAULT_OPENCODE_OPTIONS } from './opencodeConfig';

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
  vi.stubGlobal("localStorage", { getItem: () => null });
  useInstanceStore.setState({ instances: new Map() });
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
