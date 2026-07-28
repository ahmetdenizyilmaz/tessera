# Claude GUI v2 — Groups & Plugin SubApps System

> Master plan for N-level group navigation, plugin subapp architecture, and inter-window communication.
> Created: 2026-03-12 | Status: PLANNING

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Group System (N-Level Nesting)](#2-group-system)
3. [Plugin SubApp System](#3-plugin-subapp-system)
4. [Plugin SDK API](#4-plugin-sdk-api)
5. [Event Bus (IPC)](#5-event-bus-ipc)
6. [UI Changes](#6-ui-changes)
7. [Data Model & Store Changes](#7-data-model--store-changes)
8. [File Structure](#8-file-structure)
9. [Implementation Phases](#9-implementation-phases)
10. [Systems You Might Forget](#10-systems-you-might-forget)
11. [SubApp Ideas](#11-subapp-ideas)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude GUI (Tauri v2)                    │
│                                                             │
│  ┌─────────┐  ┌──────────────────────────────────────────┐  │
│  │ Sidebar │  │              Workspace                    │  │
│  │ (shared │  │  ┌─────────────────────────────────────┐  │  │
│  │  global)│  │  │ Tab Bar (with breadcrumb when nested)│  │  │
│  │         │  │  ├─────────────────────────────────────┤  │  │
│  │ Projects│  │  │                                     │  │  │
│  │ Agents  │  │  │  Mosaic Tiled Panels                │  │  │
│  │ MCP     │  │  │  ┌──────────┐ ┌──────────────────┐  │  │  │
│  │ Analytic│  │  │  │ Chat     │ │ Plugin (iframe)  │  │  │  │
│  │ Timeline│  │  │  │          │ │                  │  │  │  │
│  │ +plugin │  │  │  │          │ │  SDK injected    │  │  │  │
│  │  menus  │  │  │  └──────────┘ └──────────────────┘  │  │  │
│  │         │  │  │  ┌──────────┐ ┌──────────────────┐  │  │  │
│  │         │  │  │  │ 📁 Group │ │ Text Editor      │  │  │  │
│  │         │  │  │  │ (preview)│ │ (plugin iframe)  │  │  │  │
│  │         │  │  │  └──────────┘ └──────────────────┘  │  │  │
│  │         │  │  │                                     │  │  │
│  │         │  │  └─────────────────────────────────────┘  │  │
│  └─────────┘  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Status Bar                                           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Key Decisions Summary

| Decision | Choice |
|----------|--------|
| Plugin rendering | iframe (HTML/JS/CSS) |
| Group navigation | Breadcrumb + back button in tab bar row |
| IPC protocol | Event bus (pub/sub) with instance discovery |
| Group display | Tab with folder icon, double-click to enter |
| Group preview | Mini tile preview when focused (not entered) |
| Permissions | Full access by default (add restrictions for marketplace later) |
| Create menu | Categorized dropdown (Built-in + Plugins) |
| Multi-panel per plugin | No — one panel per instance, internal tabs for multi-view |
| Cross-group drag | Yes — drag onto group tab to move in, breadcrumb to move out |
| SDK distribution | Injected by host into iframe, `window.ClaudeGUI` global |
| Sidebar scope | Shared globally (same for all group levels) |

---

## 2. Group System

### 2.1 Core Concept

A **Group** is a panel type (`panelType: 'group'`) that contains its own set of child panels. When you "enter" a group, its children replace the current workspace view (same tiling, snapping, resizing rules). Groups can contain other groups — **N-level deep nesting**.

### 2.2 Data Model

```typescript
// Each group has its own mini layout state
interface GroupState {
  id: string;                          // e.g. "group-1710000000"
  name: string;                        // e.g. "My Project"
  icon?: string;                       // optional custom icon
  color?: string;                      // optional accent color
  parentId: string | null;             // null = root level (Main)
  childIds: string[];                  // ordered list of child panel IDs (the "tabOrder" for this group)
  layoutConfig: LayoutConfig | null;   // tiling layout for children
  panelRects: Map<string, PanelRect>;  // sizes of children
  focusedChildId: string | null;       // which child is focused
  activeChildId: string | null;        // which child tab is active
  stealFraction: number;               // focus scaling factor
}

// Navigation state
interface NavigationState {
  // Stack of group IDs from root to current. Empty = at root (Main).
  // e.g. [] = Main, ["group-1"] = inside group-1, ["group-1", "group-2"] = inside group-2 which is inside group-1
  groupStack: string[];

  // Computed breadcrumb path (derived from groupStack)
  // e.g. [{id: null, name: "Main"}, {id: "group-1", name: "My Project"}, {id: "group-2", name: "Sub"}]
  breadcrumbPath: Array<{ id: string | null; name: string }>;
}
```

### 2.3 Navigation Behavior

| Action | Result |
|--------|--------|
| Click group tab | Focus the group panel (show mini preview) |
| Double-click group tab | Enter the group (push onto `groupStack`, workspace shows group's children) |
| Click back button `[←]` | Pop one level from `groupStack`, return to parent |
| Click breadcrumb segment | Pop `groupStack` to that level (jump multiple levels) |
| Drag tab onto group tab | Move panel into that group |
| Drag tab onto breadcrumb "Main" | Move panel out to root level |
| Drag tab onto breadcrumb segment | Move panel to that ancestor group |
| Drag tab to upper tab bar area | Navigate up one level (while dragging, for cross-group moves) |

### 2.4 Group Preview (When Focused, Not Entered)

When a group panel is focused but not entered, it shows a **mini tile preview**:

```
┌─ My Group ────────────────────────────────┐
│  ┌────────────┐ ┌────────────┐            │
│  │ 🤖 Chat 2  │ │ 📝 Editor  │            │
│  │ > hello    │ │ func() {   │            │
│  │ < world    │ │   return   │            │
│  └────────────┘ └────────────┘            │
│  ┌────────────┐                           │
│  │ 📁 SubGrp  │   Double-click to enter   │
│  │ 3 items    │                           │
│  └────────────┘                           │
└───────────────────────────────────────────┘
```

Each mini tile shows:
- Icon + name
- For chats: last 2-3 lines of conversation
- For plugins: plugin icon + name
- For sub-groups: folder icon + item count
- All non-interactive (just a preview)

### 2.5 State Preservation

When navigating in and out of groups:
- **All state is preserved.** Group's layout, panel positions, focused panel, scroll positions, chat history — everything stays exactly as you left it.
- Group state is stored in a `Map<string, GroupState>` in the Zustand store.
- The root level (Main) uses the existing `tabOrder`, `layoutConfig`, `panelRects` etc. — effectively the root IS a group, just with `id = null`.

### 2.6 Creating Groups

**From + button:** Select "📁 Group" from the categorized dropdown.

**From existing panels:** Select multiple tabs (future: shift+click) and "Group selected" from context menu.

**Naming:** New groups get default name "Group N". Rename via double-click on tab label or context menu.

---

## 3. Plugin SubApp System

### 3.1 Core Concept

A **SubApp** (plugin) is a self-contained web application that runs inside an `<iframe>` in its own panel. The host app injects an SDK (`window.ClaudeGUI`) that provides APIs for communication, file access, and UI integration.

### 3.2 Plugin Folder Structure

```
<project-root>/subapps/
  text-editor/
    manifest.json          # Plugin metadata & configuration
    index.html             # Entry point (loaded in iframe)
    app.js                 # Plugin logic
    style.css              # Plugin styles
    icon.svg               # Plugin icon (used in tab, + menu)
    data/                  # Sandboxed read/write folder
      settings.json        # Plugin's persistent settings
      ...                  # Any plugin data files

  image-store/
    manifest.json
    index.html
    app.js
    style.css
    icon.svg
    data/

  planner/
    manifest.json
    index.html
    ...
```

### 3.3 Manifest Schema

```jsonc
{
  // Required fields
  "name": "Text Editor",                    // Display name (used as default tab title)
  "version": "1.0.0",                       // Semantic version
  "description": "A code editor with syntax highlighting",
  "entry": "index.html",                    // Entry point file

  // Icon (one of these)
  "icon": "pencil",                         // Lucide icon name
  // OR
  "icon": "icon.svg",                       // Custom SVG file in plugin folder

  // Optional: Tab appearance
  "defaultTitle": "Text Editor",            // Default tab title (can be changed at runtime)
  "titleButtons": [                         // Custom buttons in the panel toolbar
    {
      "id": "save",
      "icon": "save",                       // Lucide icon name
      "label": "Save",
      "tooltip": "Save file (Ctrl+S)"
    },
    {
      "id": "settings",
      "icon": "settings",
      "label": "Settings"
    }
  ],

  // Optional: Sidebar integration
  "sidebar": {
    "icon": "pencil",                       // Icon in sidebar icon strip
    "label": "Editor Files",                // Sidebar panel title
    "entry": "sidebar.html"                 // Separate HTML for sidebar content
  },

  // Optional: Color override
  "accentColor": "#4A9EFF",                 // Default accent color for this plugin's panel
  // Note: User can override this from the "Change Color" menu.
  // If user removes color override, plugin's accentColor is restored.

  // Optional: Context menu additions
  "contextMenu": [
    {
      "id": "open-in-editor",
      "label": "Open in Text Editor",
      "targets": ["chat", "file"]           // Where this menu item appears
    }
  ],

  // Optional: Supported file types (for "Open with..." integration)
  "fileTypes": [".txt", ".md", ".js", ".ts", ".json", ".css", ".html"],

  // Metadata
  "author": "Your Name",
  "license": "MIT",
  "homepage": "https://github.com/...",

  // Future: Marketplace fields
  "marketplace": {
    "category": "editors",
    "tags": ["code", "editor", "syntax"],
    "screenshots": ["screenshot1.png"],
    "price": "free"
  }
}
```

### 3.4 Plugin Lifecycle

```
[Discovery] → [Registration] → [Instantiation] → [Running] → [Destruction]

Discovery:
  - On app start, scan subapps/ folder for manifest.json files
  - Validate manifests, register available plugins
  - Populate + button menu with plugin entries

Registration:
  - Plugin metadata stored in PluginRegistry (Zustand store)
  - Sidebar menus registered (if plugin has sidebar config)

Instantiation (user clicks + > plugin):
  - Create new panel with panelType: 'plugin'
  - Create <iframe> with src pointing to plugin's index.html
  - Inject SDK script into iframe before plugin loads
  - SDK establishes postMessage bridge with host
  - Plugin receives 'init' event with instance ID, theme, etc.

Running:
  - Plugin communicates via SDK (event bus, file access, etc.)
  - Host relays events between plugins and chat instances
  - Plugin can update its title, toolbar buttons, sidebar menu

Destruction (user closes panel):
  - Host sends 'destroy' event to plugin
  - Plugin gets 500ms to save state
  - iframe is removed from DOM
  - Plugin's event subscriptions are cleaned up
```

### 3.5 Plugin iframe Loading

```html
<!-- Host creates this for each plugin instance -->
<iframe
  id="plugin-{instanceId}"
  src="claude-gui://subapp/{pluginName}/index.html"
  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
  style="width: 100%; height: 100%; border: none;"
/>
```

The `claude-gui://subapp/` protocol is handled by Tauri's custom protocol to serve files from the `subapps/` directory. This ensures:
- Plugins can't access parent window's DOM directly
- File paths are resolved relative to plugin folder
- Cross-origin restrictions apply

### 3.6 Plugin Color Override System

```
Priority (highest to lowest):
1. User-set color (from "Change Color" context menu) → stored in panel metadata
2. Plugin's manifest accentColor → from manifest.json
3. Default theme color → from current theme

When user sets color: stored as panel override, plugin's color ignored
When user removes color override: falls back to plugin's accentColor
When plugin is removed and re-added: user override is gone, plugin color restored
```

---

## 4. Plugin SDK API

The SDK is injected by the host into each plugin's iframe. Available as `window.ClaudeGUI`.

### 4.1 Core API

```typescript
interface ClaudeGUISDK {
  // ─── Identity ───────────────────────────
  instanceId: string;              // This plugin instance's unique ID
  pluginName: string;              // Plugin name from manifest
  groupId: string | null;          // Group this instance belongs to (null = root)

  // ─── Event Bus ──────────────────────────
  on(event: string, handler: (data: any) => void): () => void;   // Returns unsubscribe fn
  off(event: string, handler: (data: any) => void): void;
  emit(event: string, data: any): void;

  // ─── Instance Discovery ─────────────────
  instances: {
    list(): Promise<InstanceInfo[]>;           // All instances (chats, plugins, groups)
    get(id: string): Promise<InstanceInfo>;    // Get specific instance info
    onChanged(handler: (instances: InstanceInfo[]) => void): () => void;  // Watch for changes
  };

  // ─── Chat Integration ───────────────────
  chat: {
    send(targetId: string, message: string): Promise<void>;              // Send message to a chat
    onMessage(handler: (msg: ChatMessage) => void): () => void;          // Listen to all chat messages
    onResponse(handler: (msg: ChatResponse) => void): () => void;        // Listen to assistant responses
    getHistory(targetId: string, limit?: number): Promise<ChatMessage[]>; // Get chat history
  };

  // ─── Plugin-to-Plugin Messaging ─────────
  messaging: {
    send(targetId: string, data: any): Promise<void>;                    // Send to specific instance
    broadcast(channel: string, data: any): void;                         // Broadcast to all
    onMessage(handler: (msg: PluginMessage) => void): () => void;        // Receive direct messages
    onBroadcast(channel: string, handler: (data: any) => void): () => void; // Listen to channel
  };

  // ─── File Access (Sandboxed) ────────────
  fs: {
    // All paths relative to plugin's data/ folder
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    readBinary(path: string): Promise<ArrayBuffer>;
    writeBinary(path: string, data: ArrayBuffer): Promise<void>;
    listDir(path?: string): Promise<FileEntry[]>;
    mkdir(path: string): Promise<void>;
    delete(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
  };

  // ─── UI Integration ─────────────────────
  ui: {
    setTitle(title: string): void;                                       // Change tab title
    setIcon(icon: string): void;                                         // Change tab icon (lucide name)
    setAccentColor(color: string | null): void;                          // Override accent color
    onToolbarButton(handler: (buttonId: string) => void): () => void;    // Listen for toolbar button clicks
    showNotification(message: string, type?: 'info' | 'warn' | 'error'): void;
    setBadge(count: number | null): void;                                // Show badge on tab (e.g. unread count)
  };

  // ─── Sidebar Integration ────────────────
  sidebar: {
    // Only available if manifest declares sidebar
    setContent(html: string): void;                                      // Update sidebar panel content
    onAction(handler: (actionId: string) => void): () => void;           // Sidebar button clicks
  };

  // ─── Theme ──────────────────────────────
  theme: {
    current: ThemeInfo;                                                  // Current theme colors, fonts
    onChange(handler: (theme: ThemeInfo) => void): () => void;           // Theme change listener
  };

  // ─── Lifecycle ──────────────────────────
  onDestroy(handler: () => void | Promise<void>): void;                  // Called before iframe removal

  // ─── Clipboard ──────────────────────────
  clipboard: {
    read(): Promise<string>;
    write(text: string): Promise<void>;
  };
}

// Supporting types
interface InstanceInfo {
  id: string;
  name: string;
  type: 'chat' | 'plugin' | 'group' | 'computer' | 'llm';
  pluginName?: string;     // Only for type === 'plugin'
  groupId: string | null;  // Which group this is in (null = root)
  icon?: string;
}

interface ChatMessage {
  instanceId: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

interface ChatResponse {
  instanceId: string;
  text: string;
  model: string;
  timestamp: number;
}

interface PluginMessage {
  from: string;            // Sender instance ID
  fromPlugin: string;      // Sender plugin name
  data: any;               // Message payload
}

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
}

interface ThemeInfo {
  name: string;
  isDark: boolean;
  colors: {
    bgPrimary: string;
    bgSurface: string;
    bgElevated: string;
    textPrimary: string;
    textMuted: string;
    accent: string;
    border: string;
    // ... all CSS custom properties
  };
}
```

### 4.2 SDK Implementation (Host Side)

The host manages all SDK communication via `postMessage`:

```typescript
// Message protocol between host and plugin iframe
interface HostToPlugin {
  type: 'sdk:init' | 'sdk:event' | 'sdk:response' | 'sdk:theme' | 'sdk:destroy';
  requestId?: string;        // For request/response patterns
  event?: string;            // For event delivery
  data?: any;
}

interface PluginToHost {
  type: 'sdk:call' | 'sdk:emit' | 'sdk:subscribe' | 'sdk:unsubscribe';
  requestId: string;         // For correlating responses
  method: string;            // API method being called
  args: any[];               // Method arguments
}
```

---

## 5. Event Bus (IPC)

### 5.1 Event Categories

```
chat:message         - A user sent a message to a chat
chat:response        - Assistant responded in a chat
chat:stream          - Streaming token from assistant

instance:created     - New panel/instance created
instance:destroyed   - Panel/instance closed
instance:focused     - Panel received focus
instance:list        - Instance list changed

plugin:message       - Direct plugin-to-plugin message
plugin:broadcast     - Broadcast message on a channel

group:entered        - User entered a group
group:exited         - User exited a group
group:changed        - Group contents changed

theme:changed        - Theme was switched

file:changed         - A file in plugin's data/ was modified (for watchers)
```

### 5.2 Event Flow

```
Plugin A                   Host (Event Bus)              Plugin B / Chat
   │                            │                            │
   │── emit('chat:send',{..}) ─>│                            │
   │                            │── routes to target chat ──>│
   │                            │                            │── processes message
   │                            │<── chat:response ──────────│
   │<── chat:response ─────────│                            │
   │                            │                            │
   │── emit('plugin:msg',{..})─>│                            │
   │                            │── routes to target ───────>│
   │                            │                            │── onMessage handler
```

### 5.3 Instance Discovery

Plugins can discover available instances to send messages to:

```javascript
// Get all available targets
const instances = await api.instances.list()
// Returns: [
//   { id: "inst-1", name: "Claude 1", type: "chat", groupId: null },
//   { id: "inst-2", name: "My Editor", type: "plugin", pluginName: "text-editor", groupId: "group-1" },
//   { id: "group-1", name: "My Group", type: "group", groupId: null },
// ]

// Watch for changes (new/closed instances)
const unsub = api.instances.onChanged((list) => {
  updateTargetDropdown(list)
})
```

---

## 6. UI Changes

### 6.1 Tab Bar (When Inside a Group)

```
Normal (at root):
  [🤖 Claude 1] [📁 My Group] [📝 Editor]  [+]

Inside a group:
  [← ] 📁 Main > My Group >  [🤖 Chat 2] [📝 Editor 2]  [+]
  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  Back button + breadcrumb (left side of tab bar)

Inside nested group:
  [← ] 📁 Main > My Group > Sub >  [🤖 Chat 3]  [+]
```

**Back button styling:** Visually prominent — slightly larger, accent-colored border or background, with left arrow icon. Not just a plain icon.

**Breadcrumb:** Each segment is clickable to jump to that level. Segments are separated by ` > `. Folder icon (📁) before "Main".

**During drag:** The breadcrumb area and tab bar act as drop targets:
- Drag tab onto a group tab → move panel into that group
- Drag tab onto breadcrumb segment → move panel to that ancestor level
- Drag tab to the tab bar / upper area → acts as "go up one level" during cross-group drag

### 6.2 + Button Menu (Categorized Dropdown)

```
┌─ New Panel ──────────────────┐
│ BUILT-IN                     │
│  🤖 Claude Chat              │
│  📁 Group                    │
│  💻 Computer Use             │
│  🧠 LLM Panel                │
│                              │
│ PLUGINS                      │
│  📝 Text Editor              │
│  🖼️ Image Store              │
│  📋 Planner                  │
│  🔌 MCP GUI                  │
│  ... (all installed plugins) │
└──────────────────────────────┘
```

### 6.3 Group Preview Panel

When a group tab is focused but not entered (single click):

```
┌─ My Group ──────────────────────────────────┐
│                                             │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│   │🤖 Chat 2 │  │📝 Editor │  │📋 Planner│ │
│   │ > hello  │  │ func() { │  │ □ task 1 │ │
│   │ < world  │  │   ret..  │  │ ☑ task 2 │ │
│   └──────────┘  └──────────┘  └──────────┘ │
│                                             │
│            Double-click to enter            │
│                                             │
└─────────────────────────────────────────────┘
```

### 6.4 Plugin Panel

```
┌─ Text Editor ───────── [Save] [Settings] [─] [×] ─┐
│  ┌─────────────────────────────────────────────┐   │
│  │                                             │   │
│  │  <iframe src="plugin/text-editor/index.html"> │   │
│  │  (SDK injected, full plugin GUI)            │   │
│  │                                             │   │
│  └─────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────┘
       ↑ Custom toolbar buttons from manifest
```

### 6.5 Panel Color Override Menu

Right-click tab → "Change Color" → color picker. This overrides the plugin's default `accentColor`. "Reset Color" option removes the user override and restores plugin's default.

---

## 7. Data Model & Store Changes

### 7.1 New Store: `groupStore.ts`

```typescript
interface GroupStore {
  groups: Map<string, GroupState>;          // All group states
  groupStack: string[];                    // Current navigation path

  // Navigation
  enterGroup: (groupId: string) => void;
  exitGroup: () => void;                   // Go up one level
  jumpToLevel: (groupId: string | null) => void;  // Jump to breadcrumb segment

  // Group CRUD
  createGroup: (parentId: string | null, name?: string) => string;
  renameGroup: (groupId: string, name: string) => void;
  deleteGroup: (groupId: string) => void;

  // Panel management within groups
  addToGroup: (groupId: string, panelId: string) => void;
  removeFromGroup: (groupId: string, panelId: string) => void;
  moveToGroup: (panelId: string, fromGroupId: string | null, toGroupId: string | null) => void;

  // Current view helpers
  getCurrentGroupId: () => string | null;  // null = root
  getCurrentChildren: () => string[];      // Panel IDs at current level
  getBreadcrumb: () => Array<{ id: string | null; name: string }>;
}
```

### 7.2 New Store: `pluginStore.ts`

```typescript
interface PluginManifest {
  name: string;
  version: string;
  description: string;
  entry: string;
  icon: string;
  defaultTitle: string;
  titleButtons?: TitleButton[];
  sidebar?: SidebarConfig;
  accentColor?: string;
  contextMenu?: ContextMenuItem[];
  fileTypes?: string[];
  author?: string;
}

interface PluginInstance {
  id: string;                    // Panel/instance ID
  pluginName: string;            // Which plugin
  iframeRef: HTMLIFrameElement | null;
  ready: boolean;                // SDK handshake completed
  title: string;                 // Current title (may differ from default)
  icon: string;                  // Current icon
  badge: number | null;          // Badge count on tab
  accentColor: string | null;    // Plugin's color (overridden by user color if set)
  userColor: string | null;      // User-set color override (highest priority)
}

interface PluginStore {
  // Registry (available plugins, discovered from subapps/)
  registry: Map<string, PluginManifest>;

  // Running instances
  instances: Map<string, PluginInstance>;

  // Discovery
  scanPlugins: () => Promise<void>;

  // Instance management
  createInstance: (pluginName: string) => string;   // Returns instance ID
  destroyInstance: (instanceId: string) => void;

  // Instance state updates (called via SDK bridge)
  setInstanceTitle: (instanceId: string, title: string) => void;
  setInstanceIcon: (instanceId: string, icon: string) => void;
  setInstanceBadge: (instanceId: string, badge: number | null) => void;
  setInstanceColor: (instanceId: string, color: string | null) => void;
  setUserColor: (instanceId: string, color: string | null) => void;
}
```

### 7.3 New Store: `eventBusStore.ts`

```typescript
interface EventBusStore {
  // Subscription management
  subscribe: (event: string, instanceId: string, handler: (data: any) => void) => () => void;

  // Event dispatching
  dispatch: (event: string, data: any, sourceId?: string) => void;

  // Targeted messaging
  sendTo: (targetId: string, data: any, sourceId: string) => void;

  // Broadcast
  broadcast: (channel: string, data: any, sourceId: string) => void;
}
```

### 7.4 Modified: `layoutStore.ts`

```typescript
// PanelType updated
type PanelType = 'terminal' | 'computer' | 'llm' | 'widget' | 'group' | 'plugin';

// New fields in LayoutState
interface LayoutState {
  // ... existing fields ...

  // Panel metadata (colors, custom titles, etc.)
  panelMeta: Record<string, PanelMeta>;
}

interface PanelMeta {
  userColor?: string;      // User-set color override
  customTitle?: string;    // User-set title override
}
```

---

## 8. File Structure

### 8.1 New Frontend Files

```
src/
  components/
    groups/
      GroupPreview.tsx           # Mini tile preview when group is focused
      GroupBreadcrumb.tsx        # Breadcrumb + back button component
    plugins/
      PluginPanel.tsx            # iframe host for a plugin instance
      PluginSDKBridge.ts         # Host-side postMessage handler
      PluginRegistry.tsx         # Scans subapps/ and manages registry
      NewPanelMenu.tsx           # Categorized dropdown for + button

  store/
    groupStore.ts               # Group navigation & state
    pluginStore.ts              # Plugin registry & instances
    eventBusStore.ts            # Inter-window event bus

  lib/
    pluginSDK.ts                # SDK source code (injected into iframes)
    pluginProtocol.ts           # postMessage protocol types

  types/
    plugin.ts                   # Plugin-related type definitions
    group.ts                    # Group-related type definitions
```

### 8.2 New Rust Backend

```
src-tauri/src/
  commands/
    plugin.rs                   # Tauri commands for plugin file I/O
                                # - scan_plugins: list subapps/ manifests
                                # - plugin_read_file: sandboxed read
                                # - plugin_write_file: sandboxed write
                                # - plugin_list_dir: sandboxed directory listing
```

### 8.3 Plugin Folder

```
subapps/                        # Created in project root
  .gitkeep                      # Keep folder in version control
  text-editor/                  # Example built-in plugin
    manifest.json
    index.html
    ...
```

### 8.4 SDK Distribution

```
src/lib/pluginSDK.ts           # SDK source (TypeScript)
  → compiled to pluginSDK.js   # Injected into each iframe via <script>
```

---

## 9. Implementation Phases

### Phase 1: Group System Foundation (No Plugins Yet)
**Files:** `groupStore.ts`, `GroupPreview.tsx`, `GroupBreadcrumb.tsx`, modified `layoutStore.ts`, `MosaicLayout.tsx`, `TabBar.tsx`

1. Add `panelType: 'group'` support to layout store
2. Create `groupStore.ts` with navigation state and group CRUD
3. Implement `GroupBreadcrumb.tsx` — back button + breadcrumb in tab bar
4. Modify `TabBar.tsx` to show breadcrumb when `groupStack.length > 0`
5. Modify `MosaicLayout.tsx` to render current group's children instead of root when inside a group
6. Implement `GroupPreview.tsx` — mini tile preview for focused groups
7. Add group tab with folder icon, double-click to enter
8. Implement navigate-back (back button, breadcrumb click)
9. Add "📁 Group" option to + button menu
10. Persist group state across app restarts

### Phase 2: Cross-Group Drag & Drop
**Files:** `MosaicLayout.tsx`, `TabBar.tsx`, `groupStore.ts`

1. Drag tab onto group tab → move panel into group
2. Drag tab onto breadcrumb segment → move panel to ancestor
3. Drag tab to upper tab bar area → navigate up while dragging
4. Right-click context menu "Move to..." with group list
5. Visual feedback during cross-group drag (highlight drop targets)

### Phase 3: Plugin Infrastructure
**Files:** `pluginStore.ts`, `PluginPanel.tsx`, `PluginSDKBridge.ts`, `pluginSDK.ts`, `plugin.rs`

1. Create Rust commands for scanning plugins and sandboxed file I/O
2. Create `pluginStore.ts` with registry and instance management
3. Build `pluginSDK.ts` — the injectable SDK
4. Build `PluginSDKBridge.ts` — host-side postMessage handler
5. Create `PluginPanel.tsx` — iframe container with toolbar buttons
6. Register custom Tauri protocol `claude-gui://subapp/` for serving plugin files
7. Plugin lifecycle: init → running → destroy with save grace period

### Phase 4: Event Bus & Communication
**Files:** `eventBusStore.ts`, updates to `chatStore.ts`, `pluginSDKBridge.ts`

1. Create `eventBusStore.ts` with pub/sub, direct messaging, broadcast
2. Wire chat messages into event bus (chat:message, chat:response events)
3. Wire instance lifecycle into event bus (instance:created, instance:destroyed)
4. Implement `api.chat.send()` — send message to a chat instance
5. Implement `api.chat.getHistory()` — read chat history
6. Implement `api.instances.list()` — instance discovery
7. Implement `api.messaging.*` — plugin-to-plugin communication

### Phase 5: UI Integration & Polish
**Files:** `NewPanelMenu.tsx`, `Sidebar.tsx`, updates to many components

1. Create `NewPanelMenu.tsx` — categorized dropdown (built-in + plugins)
2. Wire + button to new menu
3. Plugin sidebar integration (optional sidebar.html loaded in sidebar panel)
4. Theme forwarding to plugin iframes
5. Plugin toolbar buttons (from manifest `titleButtons`)
6. Plugin badge on tab
7. Panel color override system (user color > plugin color > theme color)
8. Plugin context menu items
9. Notification/toast system for plugins

### Phase 6: Built-in Example Plugins
**Files:** `subapps/text-editor/`, `subapps/notes/`

1. Build Text Editor plugin (Monaco or CodeMirror based)
2. Build Notes plugin (simple rich text / markdown)
3. Document SDK API for plugin developers
4. Create plugin developer guide / template

---

## 10. Systems You Might Forget

These are important systems that weren't explicitly discussed but are needed:

### 10.1 Plugin Error Handling
- If a plugin iframe crashes or throws an unhandled error, show an error boundary in the panel
- "Reload Plugin" button to restart the iframe without closing the panel
- Host should catch `postMessage` errors and log them

### 10.2 Plugin Hot-Reload (Dev Mode)
- When `npm run tauri dev` is running, watch `subapps/` for file changes
- Auto-reload the plugin's iframe when its files change
- Speeds up plugin development significantly

### 10.3 Theme Forwarding
- When theme changes, host sends `theme:changed` event to all plugin iframes
- SDK provides CSS variables that plugins can use to match host theme
- `api.theme.current.colors.bgPrimary` etc.

### 10.4 Plugin State Persistence
- Plugins should save their state to their `data/` folder
- On app restart, plugins are re-instantiated and can read saved state
- `api.onDestroy()` gives plugins 500ms to save before iframe is removed

### 10.5 Keyboard Shortcut Management
- Host captures all keyboard shortcuts first
- Plugins can register shortcuts via `api.ui.registerShortcut('ctrl+s', handler)`
- Host only forwards shortcut to focused plugin's iframe
- Conflict resolution: host shortcuts take priority

### 10.6 Drag & Drop Between Panels
- Allow dragging content (text, images, files) between panels
- Plugin SDK: `api.ui.onDrop(handler)` — receive dropped content
- Plugin SDK: `api.ui.startDrag(data)` — initiate a drag from the plugin
- This enables dragging an image from Image Store into a chat window

### 10.7 Plugin Window State Persistence
- Remember which plugins were open, their positions, sizes, and which group they were in
- Restore on app restart
- This is handled by the existing layout persistence + group store persistence

### 10.8 Rate Limiting / Protection
- Limit how many events a plugin can emit per second (prevent runaway loops)
- Limit file I/O operations per second
- Maximum data/ folder size per plugin (configurable)

### 10.9 Group Serialization
- Groups need to be serialized to localStorage (or file) for persistence
- Nested groups create a tree structure — serialize as flat map with parent references
- On restore, rebuild the tree from flat map

### 10.10 Plugin Context Isolation
- Each plugin iframe has its own JavaScript context
- Plugins cannot access each other's DOM or variables directly
- All communication goes through the postMessage bridge
- Plugins cannot access the host app's DOM or stores

### 10.11 Plugin Dependencies (Future)
- Plugins might depend on shared libraries (e.g., Monaco editor)
- Future: shared lib caching so multiple plugins don't load the same library
- For now: each plugin bundles its own dependencies

### 10.12 Undo/Redo for Group Operations
- Moving panels between groups should be undoable
- Consider a simple operation history for group operations
- Ctrl+Z to undo the last group move

---

## 11. SubApp Ideas

### Core Utility Plugins

| Plugin | Description | Key Features |
|--------|-------------|--------------|
| **Text Editor** | Code/text editor with syntax highlighting | Monaco/CodeMirror based, file open/save, multi-tab internal, syntax for 50+ languages |
| **Notes** | Simple sticky notes / markdown | Rich text, markdown preview, auto-save, searchable |
| **Image Gallery** | Collect, organize, preview images | Grid view, drag-drop to add, categories/tags, paste from clipboard |
| **File Browser** | Browse project files with preview | Tree view, file preview, open-with integration, search |
| **Terminal** | Additional terminal emulator | xterm.js based, multiple shells, command history |
| **Planner / Todo** | Task management | Create tasks from chat, due dates, kanban board, priorities |

### Developer Tools

| Plugin | Description | Key Features |
|--------|-------------|--------------|
| **JSON Viewer** | Pretty-print and edit JSON | Tree view, syntax highlighting, validate, format/minify |
| **Diff Viewer** | Compare text/files side by side | Inline/side-by-side diff, syntax aware, paste to compare |
| **Regex Tester** | Test regex patterns | Live matching, capture groups, replace preview, cheat sheet |
| **API Tester** | HTTP request builder (like Postman) | GET/POST/PUT/DELETE, headers, body, response viewer, save requests |
| **Database Browser** | Connect to SQLite/Postgres | Table browser, SQL editor, query results, schema viewer |
| **Git Graph** | Visual git history | Branch graph, commit details, diff view, basic git operations |
| **Log Viewer** | Tail and filter log files | Real-time tail, regex filter, color coding by level, multiple files |
| **Environment Manager** | Manage .env files | View/edit env vars, switch between environments, secret masking |

### AI & Communication

| Plugin | Description | Key Features |
|--------|-------------|--------------|
| **Prompt Library** | Save and manage reusable prompts | Categories, variables/templates, send to chat, import/export |
| **Chat History** | Search past Claude conversations | Full-text search, filter by date/model, re-open conversations |
| **Model Comparison** | Compare outputs from different models | Side-by-side, same prompt to multiple models, diff view |
| **MCP GUI** | Visual MCP server management | Server list, tool browser, test tool calls, server logs |

### Creative & Visual

| Plugin | Description | Key Features |
|--------|-------------|--------------|
| **Whiteboard** | Freeform drawing/brainstorming canvas | Drawing tools, shapes, text, sticky notes, export as image |
| **Diagram Editor** | Flowcharts, UML, architecture diagrams | Mermaid-based or custom, export SVG/PNG, templates |
| **Color Picker** | Color palette manager | Pick from screen, palettes, convert formats, save favorites |
| **Markdown Preview** | Live markdown rendering | Side-by-side edit/preview, GitHub flavored, export HTML/PDF |

### Productivity

| Plugin | Description | Key Features |
|--------|-------------|--------------|
| **Timer / Pomodoro** | Time tracking | Pomodoro timer, session log, daily stats, break reminders |
| **Snippet Manager** | Save and organize code snippets | Tags, search, syntax highlighting, quick-paste to chat |
| **Bookmarks** | Save and organize links/references | Categories, tags, preview, share with chat |
| **Calculator** | Scientific calculator + unit converter | Math expressions, unit conversion, history, variable storage |
| **Clipboard History** | Track clipboard contents | History list, search, pin favorites, paste to any panel |

### Data & Analysis

| Plugin | Description | Key Features |
|--------|-------------|--------------|
| **CSV Viewer** | View and edit CSV/TSV files | Table view, sort, filter, basic charts, formula support |
| **Chart Builder** | Create charts from data | Line, bar, pie, scatter, import CSV, export as image |
| **Data Transform** | Transform data between formats | JSON↔CSV↔YAML↔XML, jq-like queries, pipeline builder |

---

## Appendix: Open Questions for Future

1. **Marketplace infrastructure**: How to host, review, and distribute plugins?
2. **Plugin updates**: Auto-update mechanism? Version compatibility checking?
3. **Plugin signing**: For marketplace trust, should plugins be signed?
4. **Multi-window**: Should groups be openable in separate OS windows?
5. **Plugin-to-Tauri bridge**: Should plugins be able to invoke Tauri commands? (Security implications)
6. **Collaborative plugins**: Real-time sync between multiple users? (Very future)
7. **Plugin templates/scaffolding**: CLI tool to generate new plugin boilerplate?
8. **Plugin search/filter**: When many plugins are installed, search in + menu?
