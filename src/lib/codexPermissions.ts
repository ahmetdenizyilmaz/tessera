import type { CodexConfig, CodexPermissionMode } from "../types/codex";

type Permissions = Required<
  Pick<CodexConfig, "sandbox" | "approvalPolicy" | "approvalsReviewer">
>;

/** Only persist policies Tessera can faithfully pass back on resume. */
export function permissionsFromThreadSettings(value: unknown): Permissions | undefined {
  if (!value || typeof value !== "object") return;
  const settings = value as Record<string, unknown>;
  const policy = settings.sandboxPolicy as Record<string, unknown> | undefined;
  const sandbox = policy?.type === "dangerFullAccess" ? "danger-full-access"
    : policy?.type === "workspaceWrite" ? "workspace-write"
    : policy?.type === "readOnly" ? "read-only" : undefined;
  const approvalPolicy = settings.approvalPolicy;
  const reviewer = settings.approvalsReviewer === "guardian_subagent"
    ? "auto_review" : settings.approvalsReviewer;
  if (!sandbox || (approvalPolicy !== "never" && approvalPolicy !== "on-request") ||
      (reviewer !== "user" && reviewer !== "auto_review")) return;
  // Custom roots/network grants need a richer saved config than these presets.
  // Do not silently turn one of those policies into a standard preset.
  if (sandbox !== "danger-full-access") {
    if (policy?.networkAccess === true || policy?.excludeTmpdirEnvVar === true ||
        policy?.excludeSlashTmp === true) return;
    const normalize = (p: string) => {
      const path = p.replace(/\\/g, "/").replace(/\/+$/, "");
      return /^[a-z]:\//i.test(path) ? path.toLowerCase() : path;
    };
    if (Array.isArray(policy?.writableRoots) && policy.writableRoots.some(
      (root) => typeof root !== "string" || typeof settings.cwd !== "string" ||
        normalize(root) !== normalize(settings.cwd),
    )) return;
  }
  return { sandbox, approvalPolicy, approvalsReviewer: reviewer };
}

export const CODEX_PERMISSION_MODES: {
  id: CodexPermissionMode;
  label: string;
  description: string;
  permissions: Permissions;
}[] = [
  {
    id: "auto-review",
    label: "Auto-review · automatic approval reviews",
    description:
      "Codex reviews requests for extra access automatically. A denied request may still need your input.",
    permissions: {
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
    },
  },
  {
    id: "workspace-write",
    label: "Project edits · ask for additional access",
    description: "Codex edits the project and asks you for extra access.",
    permissions: {
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
    },
  },
  {
    id: "read-only",
    label: "Read only · ask before changes",
    description: "Codex reads files and asks you before making changes.",
    permissions: {
      sandbox: "read-only",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
    },
  },
  {
    id: "danger-full-access",
    label: "Full access · no approval prompts",
    description:
      "Codex can edit files outside the project and run network commands without asking.",
    permissions: {
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      approvalsReviewer: "user",
    },
  },
];

export function codexPermissions(mode: CodexPermissionMode): Permissions {
  // Unknown imported preferences retain the original project-editing default.
  const preset =
    CODEX_PERMISSION_MODES.find((entry) => entry.id === mode) ??
    CODEX_PERMISSION_MODES.find((entry) => entry.id === "workspace-write")!;
  return { ...preset.permissions };
}

export function codexPermissionMode(
  config?: Partial<CodexConfig>,
): CodexPermissionMode | "custom" {
  const sandbox = config?.sandbox ?? "workspace-write";
  const approvalPolicy = config?.approvalPolicy ?? "on-request";
  const reviewer = config?.approvalsReviewer ?? "user";
  return (
    CODEX_PERMISSION_MODES.find(
      ({ permissions: p }) =>
        p.sandbox === sandbox &&
        p.approvalPolicy === approvalPolicy &&
        p.approvalsReviewer === reviewer,
    )?.id ?? "custom"
  );
}
