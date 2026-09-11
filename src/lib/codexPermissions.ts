import type { CodexConfig, CodexPermissionMode } from "../types/codex";

type Permissions = Required<
  Pick<CodexConfig, "sandbox" | "approvalPolicy" | "approvalsReviewer">
>;

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
