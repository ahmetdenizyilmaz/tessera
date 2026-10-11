import type { ClaudeInstance } from './instance';
import type { PluginInstance } from './plugin';
import type { GroupState } from '../store/groupStore';
import type { PanelType } from '../store/layoutStore';
import type { LlmChatMessage } from '../store/llmChatStore';
import type { DetachedWorkspace } from '../store/workspaceWindowStore';
import type { LevelGeometry } from '../lib/layoutHistory';
import type { PanelRect } from './session';

export type SavedPanelGroup = Omit<GroupState, 'panelRects'> & { panelRects: Record<string, PanelRect> };
export interface RememberedPanel {
  id: string;
  name: string;
  type: PanelType;
  instance?: ClaudeInstance;
  plugin?: PluginInstance;
  widgetKind?: string;
  group?: SavedPanelGroup;
  children?: RememberedPanel[];
  llmMessages?: LlmChatMessage[];
  remoteDeviceId?: string;
}

export interface ClosedPanel {
  panel: RememberedPanel;
  parentId: string | null;
  geometry: LevelGeometry | null;
  shortcuts: Record<string, string>;
  window?: DetachedWorkspace;
  windowGroup?: SavedPanelGroup;
}

export interface RecentPanel {
  key: string;
  lastUsed: number;
  saved: ClosedPanel;
}

/** Match a resumed conversation even though workspace loading remints panel IDs. */
export function recentPanelKey(panel: RememberedPanel): string {
  const instance = panel.instance;
  if (instance) {
    const provider = instance.config.agentProvider ?? 'claude';
    const session = provider === 'codex' ? instance.codexThreadId
      : provider === 'opencode' ? instance.opencodeSessionId ?? instance.opencodeDataId
      : provider === 'antigravity' ? instance.antigravityConversationId ?? instance.antigravityDataId
      : instance.claudeSessionId;
    if (session) return `${provider}:${session}`;
  }
  return `panel:${panel.id}`;
}
