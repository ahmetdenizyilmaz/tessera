import { invoke } from "@tauri-apps/api/core";
import { useInstanceStore } from "../store/instanceStore";
import {
  useLayoutStore,
  canAddPanel,
  notifyPanelLimit,
} from "../store/layoutStore";
import { useGroupStore } from "../store/groupStore";
import { useSettingsStore } from "../store/settingsStore";
import { useCodexStore } from "../store/codexStore";
import { ensureCodex } from "./codexBridge";
import { cleanupPty } from "../hooks/usePty";
import { clearTerminalState } from "../components/terminal/XTermView";
import type { CodexConfig } from "../types/codex";
import { applyForkToInstance } from "./forkActions";

export function findCodexPanel(threadId: string): string | undefined {
  const live = new Set(useLayoutStore.getState().tabOrder);
  for (const g of useGroupStore.getState().groups.values())
    for (const id of g.childIds) live.add(id);
  return [...useInstanceStore.getState().instances.values()].find(
    (i) =>
      live.has(i.id) &&
      i.config.agentProvider === "codex" &&
      i.codexThreadId === threadId,
  )?.id;
}
export function focusCodexPanel(id: string): void {
  if (!useLayoutStore.getState().tabOrder.includes(id)) {
    const store = useGroupStore.getState();
    store.jumpToLevel(null);
    store.clearTransition();
    const chain: string[] = [];
    let group = [...store.groups.values()].find((g) => g.childIds.includes(id));
    while (group && !chain.includes(group.id)) {
      chain.unshift(group.id);
      group = group.parentId ? store.groups.get(group.parentId) : undefined;
    }
    for (const groupId of chain) {
      useGroupStore.getState().enterGroup(groupId);
      useGroupStore.getState().commitEnterGroup();
    }
  }
  useLayoutStore.getState().setActiveTab(id);
  useLayoutStore.getState().setFocused(id);
}
export async function openCodexSession(
  config: CodexConfig,
  threadId?: string,
  wizardId?: string,
): Promise<string> {
  if (threadId) {
    const existing = findCodexPanel(threadId);
    if (existing) {
      if (wizardId) useLayoutStore.getState().removePanel(wizardId);
      focusCodexPanel(existing);
      return existing;
    }
  }
  if (!wizardId && !canAddPanel()) {
    notifyPanelLimit();
    throw new Error("Panel limit reached");
  }
  const store = useInstanceStore.getState();
  const id = store.addInstance(
    {
      agentProvider: "codex",
      cwd: config.cwd,
      model: config.model,
      panelView: config.terminal ? "terminal" : "chat",
      codex: {
        effort: config.effort,
        sandbox: config.sandbox,
        approvalPolicy: config.approvalPolicy,
        approvalsReviewer: config.approvalsReviewer ?? "user",
        executablePath: config.executablePath,
      },
      systemPrompt: config.instructions,
      dangerouslySkipPermissions: false,
      permissionMode: "default",
      allowedTools: [],
      maxBudget: 0,
      agentMode: false,
    },
    "Codex · " + (config.cwd.split(/[\\/]/).filter(Boolean).pop() ?? "Session"),
  );
  if (threadId) store.updateInstance(id, { codexThreadId: threadId });
  await applyForkToInstance(id);
  try {
    await ensureCodex(id);
    if (wizardId && !useLayoutStore.getState().panelTypes[wizardId]) {
      throw new Error("Panel creation was cancelled.");
    }
    if (!wizardId && !canAddPanel()) throw new Error("Panel limit reached");
  } catch (e) {
    store.removeInstance(id);
    useCodexStore.getState().remove(id);
    await invoke("codex_close", { id }).catch(() => {});
    throw e;
  }
  if (wizardId) useLayoutStore.getState().removePanel(wizardId);
  useLayoutStore.getState().addPanel(id);
  const group = useGroupStore.getState().getCurrentGroupId();
  if (group) useGroupStore.getState().addToGroup(group, id);
  useSettingsStore.getState().updateSettings({
    lastSessionPreset: {
      kind: "codex",
      model: config.model,
      cwd: config.cwd,
      panelView: config.terminal ? "terminal" : "chat",
      codex: config,
    },
  });
  return id;
}
export async function restartCodex(
  id: string,
  fresh = false,
  threadId?: string,
  cwd?: string,
): Promise<void> {
  useInstanceStore.getState().setStatus(id, "starting");
  await invoke("pty_kill", { id }).catch(() => {});
  cleanupPty(id, false);
  clearTerminalState(id);
  await invoke("codex_close", { id });
  useCodexStore.getState().remove(id);
  const inst = useInstanceStore.getState().instances.get(id);
  if (!inst) return;
  useInstanceStore.getState().updateInstance(id, {
    status: "starting",
    codexThreadId: fresh
      ? undefined
      : (threadId ??
        (inst.codexHasTurns === false ? undefined : inst.codexThreadId)),
    codexHasTurns: !!threadId || (!fresh && inst.codexHasTurns),
    config: cwd ? { ...inst.config, cwd } : inst.config,
  });
  await ensureCodex(id);
}
