import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ensureCodex, initCodexBridge } from "./codexBridge";
import { useInstanceStore } from "../store/instanceStore";
import { useCodexStore } from "../store/codexStore";
import { permissionsFromThreadSettings } from "./codexPermissions";
import type { CodexEvent, CodexSnapshot } from "../types/codex";

const listener = vi.hoisted(() => ({ receive: (_: { payload: CodexEvent }) => {} }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, receive) => { listener.receive = receive; return () => {}; }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let id: string;
const settings = (sequence = 1, generation = "active", threadId = "thread"): CodexEvent => ({
  id, sequence, generation,
  message: {
    method: "thread/settings/updated",
    params: {
      threadId,
      threadSettings: {
        cwd: "C:/project", approvalPolicy: "never", approvalsReviewer: "user",
        sandboxPolicy: { type: "dangerFullAccess" },
      },
    },
  },
});
const snapshot = (events: CodexEvent[] = []): CodexSnapshot => ({
  generation: "active", threadId: "thread",
  thread: { id: "thread", cwd: "C:/project", updatedAt: 0, turns: [] },
  events, requests: [], busy: false, alive: true,
});

beforeEach(async () => {
  vi.clearAllMocks();
  useInstanceStore.setState({ instances: new Map() });
  useCodexStore.setState({ sessions: {}, events: {}, hydrated: {} });
  id = useInstanceStore.getState().addInstance({
    agentProvider: "codex", panelView: "terminal", cwd: "C:/project", model: "model",
    systemPrompt: "", permissionMode: "default", dangerouslySkipPermissions: false,
    allowedTools: [], maxBudget: 0, agentMode: false,
    codex: { sandbox: "workspace-write", approvalPolicy: "on-request", effort: "high" },
  });
  useInstanceStore.getState().updateInstance(id, { status: "running", codexThreadId: "thread" });
  useCodexStore.getState().hydrate(id, snapshot());
  await initCodexBridge();
});

it("saves a native /permissions change without restarting or answering its pending request", () => {
  const request = { id: 5, method: "item/commandExecution/requestApproval", params: { threadId: "thread" } };
  useCodexStore.setState(s => ({ sessions: { ...s.sessions,
    [id]: { ...s.sessions[id], busy: true, materialized: true, requests: [request] },
  } }));
  listener.receive({ payload: settings() });
  const instance = useInstanceStore.getState().instances.get(id)!;
  expect(instance.config.codex).toMatchObject({
    sandbox: "danger-full-access", approvalPolicy: "never", approvalsReviewer: "user", effort: "high",
  });
  expect(instance.codexThreadId).toBe("thread");
  expect(useCodexStore.getState().sessions[id]).toMatchObject({ busy: true, requests: [request] });
  expect(invoke).not.toHaveBeenCalled();
});

it("ignores native settings from a retired connection or another conversation", () => {
  listener.receive({ payload: settings(1, "retired") });
  listener.receive({ payload: settings(2, "active", "other-thread") });
  expect(useInstanceStore.getState().instances.get(id)!.config.codex?.approvalPolicy).toBe("on-request");
});

it("does not overwrite a panel selection while its old terminal is shutting down", () => {
  useInstanceStore.getState().setStatus(id, "starting");
  listener.receive({ payload: settings() });
  expect(useInstanceStore.getState().instances.get(id)!.config.codex?.approvalPolicy).toBe("on-request");
});

it("hydrates a native permission update before saving a remounted panel", async () => {
  useCodexStore.getState().remove(id);
  vi.mocked(invoke).mockResolvedValueOnce(snapshot([settings()]));
  await ensureCodex(id);
  expect(useInstanceStore.getState().instances.get(id)!.config.codex).toMatchObject({
    sandbox: "danger-full-access", approvalPolicy: "never",
  });
});

it("keeps current native settings when replay has rolled past the change", async () => {
  listener.receive({ payload: settings() });
  useCodexStore.setState({ events: { [id]: [] } });
  vi.mocked(invoke).mockResolvedValueOnce(snapshot());
  await ensureCodex(id);
  expect(useCodexStore.getState().sessions[id].permissions?.approvalPolicy).toBe("never");
  expect(useInstanceStore.getState().instances.get(id)!.config.codex?.approvalPolicy).toBe("never");
});

it("does not collapse unsupported custom permissions into a broader preset", () => {
  const base = { approvalPolicy: "on-request", approvalsReviewer: "user", cwd: "C:/project" };
  expect(permissionsFromThreadSettings({ ...base, sandboxPolicy: { type: "externalSandbox" } })).toBeUndefined();
  expect(permissionsFromThreadSettings({ ...base, approvalPolicy: { granular: {} }, sandboxPolicy: { type: "readOnly" } })).toBeUndefined();
  expect(permissionsFromThreadSettings({ ...base, sandboxPolicy: { type: "workspaceWrite", writableRoots: ["C:/other"] } })).toBeUndefined();
  expect(permissionsFromThreadSettings({ ...base, sandboxPolicy: { type: "workspaceWrite", networkAccess: true } })).toBeUndefined();
  expect(permissionsFromThreadSettings({ ...base, approvalsReviewer: "auto_review", sandboxPolicy: { type: "workspaceWrite", writableRoots: ["C:\\project"] } })).toMatchObject({ approvalsReviewer: "auto_review", sandbox: "workspace-write" });
});

it("restores the effective server policy when the update is older than replay", async () => {
  useCodexStore.getState().remove(id);
  // A ready event may reach the frontend before the configure reply. It must
  // not erase a settings event retained only in the backend snapshot.
  listener.receive({ payload: { id, generation: "active", sequence: 5000,
    message: { method: "tessera/ready", params: { threadId: "thread" } },
  } });
  vi.mocked(invoke).mockResolvedValueOnce({ ...snapshot(), settingsEvent: settings() });
  await ensureCodex(id);
  expect(useInstanceStore.getState().instances.get(id)!.config.codex).toMatchObject({
    sandbox: "danger-full-access", approvalPolicy: "never", approvalsReviewer: "user",
  });
  expect(useInstanceStore.getState().instances.get(id)!.codexThreadId).toBe("thread");
});

it("keeps a newer native restriction when an older full-access snapshot arrives", async () => {
  useCodexStore.getState().remove(id);
  const newer = settings(6000);
  newer.message.params.threadSettings = {
    cwd: "C:/project", approvalPolicy: "on-request", approvalsReviewer: "user",
    sandboxPolicy: { type: "readOnly" },
  };
  listener.receive({ payload: newer });
  vi.mocked(invoke).mockResolvedValueOnce({ ...snapshot(), settingsEvent: settings() });
  await ensureCodex(id);
  expect(useInstanceStore.getState().instances.get(id)!.config.codex).toMatchObject({
    sandbox: "read-only", approvalPolicy: "on-request",
  });
});
