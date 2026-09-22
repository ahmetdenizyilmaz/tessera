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
