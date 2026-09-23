import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCodexStore } from "../store/codexStore";
import { useInstanceStore } from "../store/instanceStore";
import type { CodexConfig, CodexEvent, CodexSnapshot } from "../types/codex";
import type { InstanceConfig } from "../types/instance";

let listener: Promise<unknown> | undefined;
const configuring = new Map<string, Promise<void>>();

function syncPermissions(id: string) {
  const store = useInstanceStore.getState();
  const instance = store.instances.get(id);
  const session = useCodexStore.getState().sessions[id];
  const permissions = session?.permissions;
  // Ignore a retiring terminal while an explicit panel change reconnects it.
  if (!permissions || !session.connected || instance?.status === "starting" ||
      instance?.config.agentProvider !== "codex") return;
  const current = codexConfig(instance.config);
  if (current.sandbox === permissions.sandbox &&
      current.approvalPolicy === permissions.approvalPolicy &&
      current.approvalsReviewer === permissions.approvalsReviewer) return;
  store.updateInstance(id, {
    config: {
      ...instance.config,
      codex: { ...instance.config.codex, ...permissions },
    },
  });
}

export function initCodexBridge() {
  return (listener ??= listen<CodexEvent>("codex-event", ({ payload }) => {
    const instance = useInstanceStore.getState().instances.get(payload.id);
    if (instance?.config.agentProvider !== "codex") return;
    useCodexStore.getState().receive(payload);
    const session = useCodexStore.getState().sessions[payload.id];
    if (payload.message.method === "thread/settings/updated" &&
        session?.generation === payload.generation && session.sequence === payload.sequence &&
        payload.message.params.threadId === session.threadId)
      syncPermissions(payload.id);
    if (session?.threadId)
      useInstanceStore
        .getState()
        .updateInstance(payload.id, {
          codexThreadId: session.threadId,
          codexHasTurns: session.materialized,
          codexResumable: session.resumable,
        });
    if (!session?.connected)
      useInstanceStore.getState().setStatus(payload.id, "stopped");
  }));
}
export function codexConfig(config: InstanceConfig): CodexConfig {
  return {
    cwd: config.cwd,
    model: config.model,
    instructions: config.systemPrompt,
    terminal: config.panelView === "terminal",
    effort: config.codex?.effort ?? "",
    sandbox: config.codex?.sandbox ?? "workspace-write",
    approvalPolicy: config.codex?.approvalPolicy ?? "on-request",
    approvalsReviewer: config.codex?.approvalsReviewer ?? "user",
    executablePath: config.codex?.executablePath ?? "",
  };
}
export async function ensureCodex(id: string): Promise<void> {
  if (configuring.has(id)) return configuring.get(id);
  const task = (async () => {
    await initCodexBridge();
    const inst = useInstanceStore.getState().instances.get(id);
    if (!inst || inst.config.agentProvider !== "codex")
      throw new Error("Codex panel not found");
    const result = await invoke<CodexSnapshot>("codex_configure", {
      id,
      config: codexConfig(inst.config),
      threadId: inst.codexThreadId ?? null,
    });
    if (!useInstanceStore.getState().instances.has(id)) {
      await invoke("codex_close", { id });
      return;
    }
    useCodexStore.getState().hydrate(id, result);
    useInstanceStore
      .getState()
      .updateInstance(id, {
        codexThreadId: result.threadId,
        codexHasTurns: useCodexStore.getState().sessions[id]?.materialized,
        codexResumable: useCodexStore.getState().sessions[id]?.resumable,
        status: "running",
      });
    // Native changes may be in replay when a previously hidden panel mounts.
    syncPermissions(id);
  })();
  configuring.set(id, task);
  try {
    await task;
  } finally {
    configuring.delete(id);
  }
}
