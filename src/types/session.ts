import type { InstanceConfig } from './instance';

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

export interface LayoutConfig {
  type: 'single' | 'split' | 'half-stack' | 'three-col' | 'quarter-fill' | 'quarters' | 'main';
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
  };
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
  };
}
