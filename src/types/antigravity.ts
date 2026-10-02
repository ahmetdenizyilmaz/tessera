/** Flags the installed `agy` CLI accepts. 'review' is its default (request-review). */
export type AntigravityPermission = 'review' | 'accept-edits' | 'plan' | 'skip';
export type AntigravityEffort = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Per-panel settings. Sign-in stays in agy's own OS credential store. */
export interface AntigravityOptions {
  /** Model slug from `agy models`; empty uses the model saved in agy's settings. */
  model: string;
  effort: AntigravityEffort;
  permission: AntigravityPermission;
  sandbox: boolean;
  executablePath: string;
}
export interface AntigravityConfig extends AntigravityOptions { cwd: string; dataId: string }

/** Token counts exactly as agy reports them; `thinking` is part of `output`. */
export interface AntigravityUsage { input: number; output: number; thinking: number; cacheRead: number; total: number }

export interface AntigravityItem {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'notice' | 'result';
  text?: string;
  state?: 'active' | 'done' | 'error' | 'interrupted';
  name?: string;
  parameters?: unknown;
  output?: string;
  error?: string;
  /** notice: error | warning | info | denied. result: completed | failed | interrupted. */
  level?: string;
  usage?: AntigravityUsage;
  durationSeconds?: number;
  at: number;
}

export type AntigravityRecovery = 'login' | 'new_conversation' | 'executable' | 'retry';

export interface AntigravitySnapshot {
  generation: string;
  revision?: string;
  /** The panel is registered with the backend. A process starts on demand. */
  configured: boolean;
  conversationId: string | null;
  processAlive: boolean;
  busy: boolean;
  items: AntigravityItem[];
  error?: string | null;
  recovery?: AntigravityRecovery | null;
  model?: string;
  /** From agy's init event: request-review | always-proceed. */
  permissionMode?: string | null;
  tools?: number | null;
  /** Conversation-wide counter from the last result; null until one is reported. */
  usage?: AntigravityUsage | null;
}

export interface AntigravityDiscovery {
  path: string;
  version: string;
  models: Array<{ id: string; label: string }>;
  modelsError: string | null;
  auth: { state: 'signed-in' | 'api-key' | 'signed-out' | 'unknown'; detail: string };
}
