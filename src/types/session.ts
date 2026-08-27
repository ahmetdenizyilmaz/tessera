import type { InstanceConfig, LlmProvider } from './instance';
import type { WorkspaceSnapshotV3 } from '../lib/workspaceSerializer';

/** Everything the new-session wizard's "last used" quick tile needs to
 *  recreate the previous session in one click. */
export interface LastSessionPreset {
  kind: 'claude' | 'llm';
  panelView: 'chat' | 'terminal';
  /** Claude branch: which gateway the CLI was routed through. */
  gateway?: 'anthropic' | 'openrouter' | 'ollama' | 'custom';
  routeModel?: string;
  customBaseUrl?: string;
  /** LLM branch: which API-chat provider. */
  llmProvider?: Exclude<LlmProvider, 'claude'>;
  model: string;
  cwd: string;
}

export interface SessionInfo {
  sessionId: string;
  display: string;
  timestamp: number;
  project: string;
  hasFile: boolean;
}

export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Per-axis focus steal fraction: x = column splits, y = row splits */
export interface StealFraction {
  x: number;
  y: number;
}

export interface LayoutConfig {
  type: 'single' | 'split' | 'half-stack' | 'three-col' | 'quarter-fill' | 'quarters' | 'main' | 'grid';
  direction?: string;
  panelOrder: string[];
}

export type SnapZone =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';

export interface AppSettings {
  defaultModel: string;
  defaultPermissionMode: string;
  defaultSkipPermissions: boolean;
  defaultAgentMode: boolean;
  /** What the New Instance dialog opens with, carried over from the last
   *  instance actually created. Kept separate from the `default*` fields so
   *  creating an instance never silently rewrites the configured defaults. */
  lastModel: string;
  lastPanelView: 'chat' | 'terminal';
  /** Folder of the last instance the user created. New panels start here
   *  rather than in the home directory — home is where every ad-hoc CLI
   *  session lands, and panels defaulting there kept adopting foreign
   *  conversations. */
  lastCwd: string;
  fontSize: number;
  fontFamily: string;
  autoSave: boolean;
  autoSaveDir: string;
  systemMonitorInterval: number;
  usagePollingInterval: number;
  planBudgetUsd: number;
  // LLM provider settings
  ollamaBaseUrl: string;
  lmstudioBaseUrl: string;
  openaiDefaultModel: string;
  geminiDefaultModel: string;
  theme: string;
  /** One-click recreate source for the wizard's quick tile. */
  lastSessionPreset: LastSessionPreset | null;
}

export interface AdyFile {
  version: 1;
  appVersion: string;
  createdAt: string;
  name?: string;
  window: { x: number; y: number; width: number; height: number; isMaximized: boolean };
  tabOrder: string[];
  activeTabId: string | null;
  instances: Array<{
    id: string;
    name: string;
    color: string;
    config: InstanceConfig;
    claudeSessionId?: string;
  }>;
  settings?: Partial<AppSettings>;
  layout?: {
    layoutConfig: LayoutConfig | null;
    panelRects: Record<string, PanelRect>;
    stealFraction: number;
    focusedId: string | null;
    panelTypes?: Record<string, 'terminal' | 'computer' | 'llm' | 'widget' | 'group' | 'plugin'>;
    widgetKinds?: Record<string, string>;
  };
}

/** .ady workspace files, v2: the workspace body is a full v3 snapshot */
export interface AdyFileV2 {
  version: 2;
  appVersion: string;
  createdAt: string;
  name?: string;
  window: { x: number; y: number; width: number; height: number; isMaximized: boolean };
  settings?: Partial<AppSettings>;
  workspace: WorkspaceSnapshotV3;
}

export interface SavedWorkspace {
  version: 2;
  instances: Array<{
    id: string;
    name: string;
    color: string;
    config: InstanceConfig;
    claudeSessionId?: string;
  }>;
  savedAt: number;
  layout?: {
    tabOrder: string[];
    activeTabId: string | null;
    focusedId: string | null;
    layoutConfig: LayoutConfig | null;
    panelRects: Record<string, PanelRect>;
    stealFraction: number;
    panelTypes?: Record<string, 'terminal' | 'computer' | 'llm' | 'widget' | 'group' | 'plugin'>;
    widgetKinds?: Record<string, string>;
  };
}
