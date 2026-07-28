// ─── Plugin Manifest (parsed from manifest.json) ────────────────────────────

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  entry: string;                    // e.g. "index.html"
  icon: string;                     // Lucide icon name OR filename
  defaultTitle: string;
  builtin?: boolean;                // true for built-in plugins served from /plugins/
  titleButtons?: PluginTitleButton[];
  sidebar?: PluginSidebarConfig;
  accentColor?: string;
  contextMenu?: PluginContextMenuItem[];
  fileTypes?: string[];
  author?: string;
  license?: string;
  homepage?: string;
}

export interface PluginTitleButton {
  id: string;
  icon: string;           // Lucide icon name
  label: string;
  tooltip?: string;
}

export interface PluginSidebarConfig {
  icon: string;
  label: string;
  entry: string;          // e.g. "sidebar.html"
}

export interface PluginContextMenuItem {
  id: string;
  label: string;
  targets: ('chat' | 'file' | 'plugin' | 'group')[];
}

// ─── Plugin Instance (running plugin) ────────────────────────────────────────

export interface PluginInstance {
  id: string;
  pluginName: string;
  iframeReady: boolean;
  title: string;
  icon: string;
  badge: number | null;
  accentColor: string | null;    // Plugin's default color
  userColor: string | null;      // User override color (highest priority)
}

// ─── Instance Discovery (exposed to plugins via SDK) ─────────────────────────

export interface InstanceInfo {
  id: string;
  name: string;
  type: 'chat' | 'plugin' | 'group' | 'computer' | 'llm';
  pluginName?: string;
  groupId: string | null;
  icon?: string;
  hasSession?: boolean;
  cwd?: string;
}

// ─── Chat Messages (exposed to plugins) ──────────────────────────────────────

export interface PluginChatMessage {
  instanceId: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

// ─── Plugin-to-Plugin Message ────────────────────────────────────────────────

export interface PluginMessage {
  from: string;
  fromPlugin: string;
  data: unknown;
}

// ─── File Entry (for plugin sandboxed fs) ────────────────────────────────────

export interface PluginFileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
}

// ─── Theme Info (exposed to plugins) ─────────────────────────────────────────

export interface PluginThemeInfo {
  name: string;
  isDark: boolean;
  colors: Record<string, string>;   // CSS custom property name -> value
}

// ─── PostMessage Protocol: Host -> Plugin ────────────────────────────────────

export interface HostToPluginMessage {
  type: 'sdk:init' | 'sdk:event' | 'sdk:response' | 'sdk:theme' | 'sdk:destroy';
  requestId?: string;
  event?: string;
  data?: unknown;
}

// ─── PostMessage Protocol: Plugin -> Host ────────────────────────────────────

export interface PluginToHostMessage {
  type: 'sdk:call' | 'sdk:emit' | 'sdk:subscribe' | 'sdk:unsubscribe';
  requestId: string;
  method: string;
  args: unknown[];
}
