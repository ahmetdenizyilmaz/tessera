export type AgentProvider = "claude" | "codex" | "opencode";
export type CodexPermissionMode =
  | "auto-review"
  | "workspace-write"
  | "read-only"
  | "danger-full-access";
export interface CodexConfig {
  cwd: string;
  model: string;
  effort: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "on-request" | "never";
  /** Older workspaces routed approvals to the user. */
  approvalsReviewer?: "user" | "auto_review";
  instructions: string;
  executablePath: string;
  terminal: boolean;
}
export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  inputModalities?: string[];
}
export interface CodexDiscovery {
  account: {
    account: { type: string; email?: string; planType?: string } | null;
    requiresOpenaiAuth: boolean;
  };
  models: CodexModel[];
  executable: string;
}
export interface CodexItem {
  id: string;
  type: string;
  text?: string;
  status?: string;
  summary?: string[];
  content?: { type: string; text?: string; url?: string }[];
  command?: string;
  aggregatedOutput?: string;
  changes?: { path: string; diff: string; kind?: unknown }[];
  [key: string]: unknown;
}
export interface CodexThread {
  id: string;
  name?: string;
  preview?: string;
  cwd: string;
  updatedAt: number;
  status?: { type: string };
  turns?: { id: string; status: string; items: CodexItem[] }[];
}
export interface CodexRequest {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}
export interface CodexEvent {
  id: string;
  generation: string;
  sequence: number;
  message: {
    method: string;
    id?: string | number;
    params: Record<string, unknown>;
  };
}
export interface CodexSnapshot {
  generation: string;
  thread: CodexThread;
  threadId: string;
  events: CodexEvent[];
  /** Latest effective policy, retained even after it leaves transcript replay. */
  settingsEvent?: CodexEvent | null;
  requests: CodexRequest[];
  busy: boolean;
  alive: boolean;
  materialized?: boolean;
}
export interface CodexState {
  generation: string;
  sequence: number;
  threadId?: string;
  items: CodexItem[];
  requests: CodexRequest[];
  busy: boolean;
  error?: string;
  connected: boolean;
  usage?: Record<string, unknown>;
  materialized?: boolean;
  /** Effective permissions reported by the native terminal's app-server. */
  permissions?: Required<Pick<CodexConfig, "sandbox" | "approvalPolicy" | "approvalsReviewer">>;
}
