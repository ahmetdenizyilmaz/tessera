# Claude GUI — Complete Application Specification

> **Purpose**: This document fully describes the Claude GUI desktop application so that a developer can rebuild it from scratch without any additional information. Every algorithm, data structure, UI behavior, file, and integration point is documented.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack & Dependencies](#2-tech-stack--dependencies)
3. [Project Structure](#3-project-structure)
4. [Application Architecture](#4-application-architecture)
5. [The Layout Engine (Core Algorithm)](#5-the-layout-engine-core-algorithm)
6. [PTY Management System](#6-pty-management-system)
7. [Chat Parser State Machine](#7-chat-parser-state-machine)
8. [Session Management](#8-session-management)
9. [Zustand Stores (All State)](#9-zustand-stores-all-state)
10. [React Components](#10-react-components)
11. [Rust Backend Commands](#11-rust-backend-commands)
12. [CSS & Theming](#12-css--theming)
13. [Authentication & Relay](#13-authentication--relay)
14. [Computer Use Feature](#14-computer-use-feature)
15. [Critical Gotchas & Patterns](#15-critical-gotchas--patterns)
16. [Build & Configuration](#16-build--configuration)

---

## 1. Overview

Claude GUI is a native desktop application for running multiple Claude Code CLI instances in a tiled, split-screen layout with a dual chat+terminal interface. Each instance gets its own PTY (pseudo-terminal) running the `claude` CLI, and users can interact via either a rich chat UI or a raw terminal view.

**Key features:**
- Multiple Claude Code instances in customizable tiled layouts (1–8+ panels)
- Dual view per instance: Chat UI (parsed, styled) or Raw Terminal (xterm.js)
- Drag-to-snap panel arrangement with 7 layout types
- Focus-based panel sizing (focused panel steals space from neighbors)
- Resizable gutters between panels
- Session persistence (resume previous Claude conversations)
- Workspace save/load (.ady files)
- Auto-save/restore on app restart
- System resource monitoring (CPU, RAM, GPU)
- Usage tracking and weekly limit display
- Image paste support in chat
- Permission prompt rendering with Allow/Deny buttons
- TUI choice prompt detection and interactive card rendering
- Thinking/planning indicator with duration and token counts
- Tool call grouping and ANSI color rendering
- Markdown rendering with syntax highlighting
- Tab bar with drag-to-reorder (dnd-kit)
- Context menus, color pickers, rename dialogs

---

## 2. Tech Stack & Dependencies

### Frontend
| Package | Version | Purpose |
|---------|---------|---------|
| react | ^19.1.0 | UI framework |
| react-dom | ^19.1.0 | DOM renderer |
| zustand | ^5.0.0 | State management (stores) |
| @xterm/xterm | ^5.5.0 | Terminal emulator |
| @xterm/addon-fit | ^0.10.0 | Auto-fit terminal to container |
| @xterm/addon-search | ^0.15.0 | Terminal search |
| @xterm/addon-serialize | ^0.13.0 | Terminal state serialization |
| @xterm/addon-web-links | ^0.11.0 | Clickable links in terminal |
| @dnd-kit/core | ^6.3.1 | Drag-and-drop framework |
| @dnd-kit/sortable | ^10.0.0 | Sortable lists (tab reorder) |
| react-markdown | ^10.1.0 | Markdown rendering |
| remark-gfm | ^4.0.1 | GitHub-flavored markdown |
| rehype-highlight | ^7.0.2 | Code syntax highlighting |
| highlight.js | ^11.11.1 | Syntax highlighting engine |
| ansi-to-html | ^0.7.2 | ANSI color code rendering |
| react-mosaic-component | ^6.1.0 | (imported but layout is custom) |
| react-rnd | ^10.5.2 | Drag-and-resize components |
| @tauri-apps/api | ^2.5.0 | Tauri JS API |
| @tauri-apps/plugin-dialog | ^2.2.2 | File picker dialogs |
| @tauri-apps/plugin-fs | ^2.2.0 | Filesystem access |
| @tauri-apps/plugin-shell | ^2.2.0 | Shell commands |
| @tauri-apps/plugin-process | ^2.2.0 | Process management |

### Backend (Rust)
| Crate | Version | Purpose |
|-------|---------|---------|
| tauri | 2 | App framework (features: protocol-asset, tray-icon) |
| portable-pty | 0.8 | Native PTY management |
| sysinfo | 0.33 | CPU/RAM/GPU monitoring |
| tokio | 1 (full) | Async runtime |
| serde / serde_json | 1 | Serialization |
| uuid | 1 (v4) | Unique IDs |
| dirs | 6 | Platform directories |
| tungstenite / tokio-tungstenite | 0.24 | WebSocket relay |
| keyring | 3 | Secure credential storage |
| reqwest | 0.12 | HTTP client |
| xcap | 0.0.9 | Screenshots (computer use) |
| enigo | 0.2 | Mouse/keyboard control |
| base64 | 0.22 | Image encoding |

### Build
| Tool | Version | Notes |
|------|---------|-------|
| vite | ^6.3.0 | Dev server on port 1420 |
| typescript | ~5.7.0 | Strict mode |
| @vitejs/plugin-react | ^4.4.1 | React Fast Refresh |
| @tauri-apps/cli | ^2.5.0 | Tauri CLI |

**CRITICAL**: Cargo.toml must use `crate-type = ["lib"]` only (NOT `cdylib` or `staticlib`) due to Windows PE DLL export limit of 65535 symbols.

---

## 3. Project Structure

```
claude_gui/
├── package.json
├── tsconfig.json
├── vite.config.ts                    # Port 1420, HMR on 1421
├── index.html                        # Root: <div id="root">
├── src/
│   ├── main.tsx                      # Entry point, mounts <AuthGate/>
│   ├── App.tsx                       # Main app shell (MenuBar + Layout + StatusBar + Dialogs)
│   ├── auth/
│   │   ├── AuthGate.tsx              # Auth check → LoginScreen or App
│   │   └── LoginScreen.tsx           # Login/register form
│   ├── types/
│   │   ├── index.ts                  # Re-exports
│   │   ├── instance.ts               # InstanceConfig, ClaudeInstance
│   │   ├── session.ts                # SessionInfo, AdyFile, AppSettings
│   │   ├── chat.ts                   # ChatMessage, ParserState, ThinkingInfo, etc.
│   │   └── ipc.ts                    # PtySpawnArgs, SystemUpdatePayload, etc.
│   ├── store/
│   │   ├── instanceStore.ts          # Instances (Map<id, ClaudeInstance>)
│   │   ├── layoutStore.ts            # Layout engine + panel rects
│   │   ├── settingsStore.ts          # App settings (persisted)
│   │   ├── systemStore.ts            # CPU/RAM/GPU info
│   │   ├── usageStore.ts             # Token usage + costs
│   │   ├── authStore.ts              # Auth state + tokens
│   │   └── computerStore.ts          # Computer Use sessions
│   ├── hooks/
│   │   ├── usePty.ts                 # PTY spawn/write/resize/kill
│   │   ├── useTerminal.ts            # xterm.js Terminal lifecycle
│   │   ├── useAutoSave.ts            # Auto-save/restore workspace
│   │   ├── useSystemMonitor.ts       # System resource listener
│   │   ├── useUsagePolling.ts        # Usage polling
│   │   ├── useRelaySync.ts           # Relay instance sync
│   │   └── useRelayEvents.ts         # Relay push events
│   ├── lib/
│   │   ├── ansiStrip.ts              # ANSI escape handling
│   │   └── parseWeeklyPercent.ts     # Usage % parser
│   ├── components/
│   │   ├── ErrorBoundary.tsx
│   │   ├── menubar/
│   │   │   ├── MenuBar.tsx           # File + Help menus
│   │   │   └── AboutDialog.tsx
│   │   ├── tabs/
│   │   │   ├── TabBar.tsx            # Sortable tab strip (dnd-kit)
│   │   │   ├── TabItem.tsx           # Individual tab (color dot, name, close)
│   │   │   └── TabContextMenu.tsx    # Right-click menu on tabs
│   │   ├── layout/
│   │   │   ├── MosaicLayout.tsx      # Main layout engine (panels + gutters + snapping)
│   │   │   ├── MosaicToolbar.tsx     # (Legacy toolbar)
│   │   │   └── SnapZoneOverlay.tsx   # Visual snap zone preview on drag
│   │   ├── terminal/
│   │   │   ├── TerminalPanel.tsx     # Panel wrapper (toolbar + chat/terminal toggle)
│   │   │   └── XTermView.tsx         # Raw xterm.js terminal view
│   │   ├── chat/
│   │   │   ├── ChatView.tsx          # Chat parser + message list
│   │   │   ├── ChatInput.tsx         # Input textarea + image paste
│   │   │   ├── MessageBubble.tsx     # Message rendering (user/assistant/permission/system)
│   │   │   ├── MarkdownRenderer.tsx  # react-markdown wrapper
│   │   │   ├── ThinkingIndicator.tsx # Live thinking/tool indicator
│   │   │   └── ImageChip.tsx         # Image attachment preview chip
│   │   ├── computer/
│   │   │   └── ComputerPanel.tsx     # Computer Use panel
│   │   ├── statusbar/
│   │   │   ├── StatusBar.tsx         # Bottom bar container
│   │   │   ├── SystemResources.tsx   # CPU/RAM gauges
│   │   │   └── UsageSummary.tsx      # Token usage display
│   │   └── dialogs/
│   │       ├── NewInstanceDialog.tsx # New instance config form
│   │       ├── ResumeSessionDialog.tsx # Session picker
│   │       ├── SaveLoadDialog.tsx    # Workspace save/load (.ady files)
│   │       ├── SettingsDialog.tsx    # App settings form
│   │       ├── UsageModal.tsx        # Detailed usage view
│   │       └── ColorPickerPopover.tsx # Color picker
│   └── styles/
│       ├── global.css                # Theme variables, base styles
│       ├── terminal.css              # Terminal panel styles
│       ├── chat.css                  # Chat UI + message styles
│       └── mosaic.css                # Layout engine styles
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json               # Window: 1400x900, CSP, bundle config
│   ├── capabilities/
│   │   └── default.json              # Permission grants
│   └── src/
│       ├── main.rs                   # fn main() { run() }
│       ├── lib.rs                    # Tauri builder + all command registrations
│       ├── pty/
│       │   ├── mod.rs                # Re-export
│       │   └── manager.rs            # PtyManager + spawn/write/resize/kill/query
│       ├── sessions/
│       │   ├── mod.rs                # Re-export
│       │   ├── scanner.rs            # Scan ~/.claude/history.jsonl
│       │   ├── history_loader.rs     # Load session .jsonl chat history
│       │   ├── usage_checker.rs      # Hidden PTY for /usage command
│       │   ├── usage_parser.rs       # Parse usage from session files
│       │   ├── image_saver.rs        # Save pasted images to disk
│       │   └── file_manager.rs       # .ady workspace file I/O
│       ├── system/
│       │   ├── mod.rs
│       │   └── monitor.rs            # CPU/RAM/GPU polling + event emit
│       ├── auth/
│       │   ├── mod.rs
│       │   ├── login.rs              # Auth login/register/logout
│       │   ├── keyring_store.rs      # Secure token storage
│       │   └── device.rs             # Device registration
│       ├── relay/
│       │   ├── mod.rs
│       │   ├── client.rs             # WebSocket relay client
│       │   └── protocol.rs           # Relay message protocol
│       ├── computer/
│       │   └── mod.rs                # Screenshot + mouse/keyboard control
│       ├── ws.rs                     # WebSocket shared types
│       └── util/
│           ├── mod.rs
│           └── claude_paths.rs       # Cross-platform path helpers
```

---

## 4. Application Architecture

### Startup Flow
1. `main.tsx` renders `<AuthGate/>`
2. `AuthGate` checks authentication via `auth_check` Tauri command
3. If authenticated → `<OnlineApp/>` (with relay hooks), else → offline `<App/>`
4. `App.tsx` initializes hooks: `useSystemMonitor()`, `useUsagePolling()`, `useAutoSave()`
5. `useAutoSave` reads `claude-gui-autosave` from localStorage
6. If saved workspace exists → restore instances + layout (with ID remapping)
7. If no saved data → empty state (user creates instances manually)
8. Renders: `<MenuBar>` → `<TabBar>` → `<MosaicLayout>` → `<StatusBar>` + dialog overlays

### Data Flow
```
User Input (Chat/Terminal)
    ↓
invoke('pty_write', {id, data})
    ↓
Rust PtyManager → PTY stdin
    ↓
Claude CLI processes input
    ↓
PTY stdout → Reader thread → output_buffer
    ↓
emit('pty-data-{id}', chunk)
    ↓
Frontend listener → ChatView parser OR XTermView terminal
    ↓
State updates → React re-render
```

### View Architecture
Each instance has TWO views always mounted (for state preservation):
- **ChatView**: Parses PTY output into structured messages
- **XTermView**: Raw xterm.js terminal

Both are stacked via CSS (`position: absolute; inset: 0`). The hidden view uses `opacity: 0; pointer-events: none; z-index: 0`. This ensures the xterm.js terminal keeps its PTY connection and dimensions even when hidden.

---

## 5. The Layout Engine (Core Algorithm)

This is the most important algorithm in the app. It computes panel positions and sizes for any number of panels (1–8+) with focus-based resizing.

### 5.1 Data Types

```typescript
interface PanelRect {
  x: number;   // left position (0–100%)
  y: number;   // top position (0–100%)
  w: number;   // width (0–100%)
  h: number;   // height (0–100%)
}

interface LayoutConfig {
  type: 'single' | 'split' | 'half-stack' | 'three-col' |
        'quarter-fill' | 'quarters' | 'main';
  direction?: string;        // left, right, top, bottom, top-left, etc.
  panelOrder: string[];      // ordered list of panel IDs
}

type SnapZone = 'left' | 'right' | 'top' | 'bottom' |
                'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
```

### 5.2 Focus Axis Algorithm

The core sizing function. Given N items on an axis, the focused item "steals" space from others.

```
function focusAxis(n, focusIdx, stealFraction = 0.5):
  if n <= 0: return []
  if n == 1: return [100]

  base = 100 / n                        // equal size for each
  if focusIdx < 0 or >= n: return [base, base, ...] // no focus

  taken = 0
  for each i from 0 to n-1:
    if i == focusIdx: skip
    give = base * stealFraction          // each non-focused gives up this much
    result[i] = base - give
    taken += give

  result[focusIdx] = base + taken        // focused gets all stolen space
  return result
```

**Example**: 3 panels, focus on index 1, stealFraction 0.5:
- base = 33.33%
- Panel 0: 33.33 - (33.33 * 0.5) = 16.67%
- Panel 1: 33.33 + (16.67 + 16.67) = 66.67% ← FOCUSED
- Panel 2: 33.33 - (33.33 * 0.5) = 16.67%

### 5.3 Layout Types

#### `single` (1 panel)
```
┌──────────────────┐
│                  │
│     Panel 1      │
│                  │
└──────────────────┘
```
- panelOrder: [p1]
- Rect: {x:0, y:0, w:100, h:100}

#### `split` (2 panels)
```
direction='left':          direction='top':
┌────────┬─────────┐      ┌──────────────────┐
│        │         │      │     Panel 1      │
│ Panel1 │ Panel2  │      ├──────────────────┤
│        │         │      │     Panel 2      │
└────────┴─────────┘      └──────────────────┘
```
- Widths/heights from `focusAxis(2, focusIdx, stealFraction)`
- `direction='left'`: p1 left, p2 right
- `direction='right'`: p2 left, p1 right
- `direction='top'`: p1 top, p2 bottom
- `direction='bottom'`: p2 top, p1 bottom

#### `half-stack` (3 panels)
```
direction='left':
┌────────┬─────────┐
│        │ Panel2  │
│ Panel1 ├─────────┤
│        │ Panel3  │
└────────┴─────────┘
```
- Main panel takes one half (full height or width)
- Two stacked panels share the other half
- Main vs stack split: `focusAxis(2, mainGroupFocus, sf)`
- Stack internal split: `focusAxis(2, stackFocus, sf)`
- Supports left/right/top/bottom directions

#### `three-col` (3 panels)
```
┌──────┬──────┬──────┐
│      │      │      │
│  P1  │  P2  │  P3  │
│      │      │      │
└──────┴──────┴──────┘
```
- Three vertical columns
- Widths from `focusAxis(3, focusIdx, sf)`

#### `quarter-fill` (3 panels in L-shape)
```
direction='top-left':      direction='bottom-right':
┌────────┬─────────┐      ┌──────────────────┐
│ Panel1 │ Panel2  │      │     Panel 2      │
├────────┴─────────┤      ├─────────┬────────┤
│     Panel 3      │      │ Panel3  │ Panel1 │
└──────────────────┘      └─────────┴────────┘
```
- One panel fills a full row, two panels split the other row
- Direction determines which corner the two split-panels occupy

#### `quarters` (4 panels)
```
┌────────┬─────────┐
│  TL    │   TR    │
├────────┼─────────┤
│  BL    │   BR    │
└────────┴─────────┘
```
- 2×2 grid
- Column widths: `focusAxis(2, colFocus, sf)`
- Row heights: `focusAxis(2, rowFocus, sf)`
- panelOrder: [TL, TR, BL, BR]

#### `main` (5+ panels)
```
┌──────────────┬────┐
│              │ S1 │
│    MAIN      ├────┤
│              │ S2 │
│              ├────┤
│              │ S3 │
├────┬────┬────┼────┤
│ B1 │ B2 │ B3 │ S4 │
└────┴────┴────┴────┘
```
- First panel in order = main (80% width, variable height)
- Next 4 panels = right sidebar (20% width, stacked)
- Remaining panels = bottom bar (20% height, equal widths)
- Constants: `SIDE = 20%`, `BOT = 20%`, `MAX_R = 4` sidebar slots

### 5.4 Default Config Selection

```
function getDefaultConfig(tabOrder, focusedId):
  N = tabOrder.length
  if N <= 1: return single
  if N == 2: return split (direction: 'left')
  if N == 3: return half-stack (direction: 'left')
  if N == 4: return quarters
  if N >= 5: return main (focusedId as main panel)
```

### 5.5 Snap-to-Zone on Drag-Drop

When a tab is dragged to a snap zone:

```
function buildSnapConfig(tabOrder, snappedId, zone, currentConfig):
  others = tabOrder excluding snappedId

  N=2: split with direction=zone (center→left)

  N=3:
    left/right/top/bottom → half-stack (snapped as main)
    center → three-col (snapped in middle)
    corner → quarter-fill (snapped at corner)

  N=4:
    Convert to quarters, swap snappedId to target quadrant position
    (preserves existing order if already quarters)

  N>=5:
    main layout with snappedId as the main panel
```

### 5.6 Gutter Resize

Gutters are the draggable borders between panels.

**Gutter Detection:**
```
function computeGutters(rects):
  gutters = []
  for each pair of panels (A, B):
    // Vertical gutter: A's right edge == B's left edge (±1%)
    if |A.x + A.w - B.x| < 1:
      overlap_y = intersection of [A.y, A.y+A.h] and [B.y, B.y+B.h]
      if overlap exists:
        gutters.push({axis:'x', position: A.x+A.w,
                      start: overlap.start, end: overlap.end,
                      panelsBefore: [A], panelsAfter: [B]})

    // Horizontal gutter: A's bottom edge == B's top edge (±1%)
    if |A.y + A.h - B.y| < 1:
      overlap_x = intersection of [A.x, A.x+A.w] and [B.x, B.x+B.w]
      if overlap exists:
        gutters.push({axis:'y', position: A.y+A.h,
                      start: overlap.start, end: overlap.end,
                      panelsBefore: [A], panelsAfter: [B]})

  // Merge gutters at same position on same axis
  return merged gutters
```

**Gutter Drag:**
1. Mouse down on gutter → start resize mode
2. Mouse move → compute delta as % of container
3. For each panel before gutter: grow/shrink width or height
4. For each panel after gutter: inverse grow/shrink
5. Minimum panel size: 10%
6. Call `setRawPanelRects()` with new Map

**After Drag Release:**
```
function deriveStealFraction(config, focusedId, currentRects, gutterAxis, ...):
  if no focusedId or focused not adjacent to gutter: keep current fraction

  focusedSize = focused panel's size on gutter axis
  numGroups = 3 for three-col on x-axis, else 2
  equalBase = 100 / numGroups
  bigSide = max(focusedSize, 100 - focusedSize)

  if bigSide ≈ equalBase (within 1%): keep current fraction

  otherBases = 100 - equalBase
  newFraction = (bigSide - equalBase) / otherBases
  return clamp(newFraction, 0.05, 0.9)
```

### 5.7 Snap Zone Detection (MosaicLayout)

```
function detectSnapZone(mouseX, mouseY, containerWidth, containerHeight, panelCount):
  mx = mouseX / containerWidth
  my = mouseY / containerHeight

  if panelCount == 2:
    if mx < 0.5: return mx < my && mx < (1-my) ? 'left' : (my < 0.5 ? 'top' : 'bottom')
    else: return (1-mx) < my && (1-mx) < (1-my) ? 'right' : (my < 0.5 ? 'top' : 'bottom')

  if panelCount == 3:
    // 3x3 grid zones:
    col = mx < 0.33 ? 0 : mx < 0.67 ? 1 : 2
    row = my < 0.33 ? 0 : my < 0.67 ? 1 : 2
    zones[0][0] = 'top-left',    zones[0][1] = 'top',    zones[0][2] = 'top-right'
    zones[1][0] = 'left',        zones[1][1] = 'center', zones[1][2] = 'right'
    zones[2][0] = 'bottom-left', zones[2][1] = 'bottom', zones[2][2] = 'bottom-right'
    return zones[row][col]

  if panelCount == 4:
    // 2x2 quadrants
    return corner based on (mx < 0.5, my < 0.5)

  if panelCount >= 5:
    // Closest edge wins
    distances = {left: mx, right: 1-mx, top: my, bottom: 1-my}
    return edge with minimum distance
```

### 5.8 Persistence

Layout is saved to `localStorage` key `claude-gui-layout`:
```json
{
  "layoutConfig": { "type": "split", "direction": "left", "panelOrder": ["id1", "id2"] },
  "panelRects": { "id1": { "x": 0, "y": 0, "w": 50, "h": 100 }, ... },
  "stealFraction": 0.5,
  "focusedId": "id1"
}
```

Saved on every layout change (addPanel, removePanel, setFocused, moveTab, finishResize, applySnap).

---

## 6. PTY Management System

### 6.1 Rust PtyManager

```rust
struct PtyInstance {
    master: Box<dyn MasterPty + Send>,      // portable-pty master
    writer: Box<dyn Write + Send>,          // stdin writer
    output_buffer: Arc<Mutex<Vec<u8>>>,     // circular buffer (1MB max)
    kill_flag: Arc<Mutex<bool>>,
    suppress_events: Arc<AtomicBool>,       // for /usage query mode
}

struct PtyManager {
    instances: Arc<Mutex<HashMap<String, PtyInstance>>>,
    relay_client: SharedRelayClient,
}
```

### 6.2 Spawn Flow

1. Build Claude CLI args from instance config (model, permissions, resume ID, etc.)
2. Open PTY pair via `portable-pty::native_pty_system().openpty()`
3. Spawn `claude.exe` as child process with args
4. Clear `CLAUDECODE` env var (prevents Claude detecting nested context)
5. Spawn reader thread:
   - Read 4KB chunks from PTY master
   - Handle incomplete UTF-8 (buffer remainder bytes)
   - Store in output_buffer (drain if > 1MB)
   - Emit `pty-data-{id}` Tauri event (unless suppressed)
   - Forward to relay client (async, best-effort)
   - On EOF/error: emit `pty-exit-{id}`

### 6.3 CLI Args Builder

```rust
fn build_claude_args(model, skip_permissions, permission_mode,
                     allowed_tools, max_budget, system_prompt, session_id) → Vec<String>:
  args = []
  if model: args.push("--model", model)
  if skip_permissions: args.push("--dangerously-skip-permissions")
  if permission_mode and permission_mode != "default":
    args.push("--permission-mode", permission_mode)
  for tool in allowed_tools: args.push("--allowedTools", tool)
  if max_budget: args.push("--max-turns-budget", budget_string)
  if system_prompt: args.push("--system-prompt", system_prompt)
  if session_id: args.push("--resume", session_id)
  return args
```

### 6.4 Query Command (for /usage)

Special mode that suppresses normal event emission:
1. Set `suppress_events = true`
2. Record buffer length before command
3. Write command + `\r` to PTY
4. Poll buffer every 200ms until stable (no new bytes for 500ms) or timeout (10s)
5. Set `suppress_events = false`
6. Replay captured bytes via `pty-data-{id}` event (so xterm stays in sync)
7. Return captured output as string

### 6.5 Frontend usePty Hook

```typescript
function usePty(instanceId):
  // Module-level Set<string> prevents double-spawn
  spawn(cols, rows):
    if spawnedPtys.has(instanceId): return
    spawnedPtys.add(instanceId)
    instance = getInstanceFromStore(instanceId)
    invoke('pty_spawn', {
      id: instanceId,
      cwd: instance.config.cwd,
      cols, rows,
      model: instance.config.model,
      dangerouslySkipPermissions: instance.config.dangerouslySkipPermissions,
      claudeSessionId: instance.claudeSessionId || null,
      // ... other config fields
    })

  write(data): invoke('pty_write', {id, data})
  resize(cols, rows): invoke('pty_resize', {id, cols, rows})
  kill(): spawnedPtys.delete(id); invoke('pty_kill', {id})
  onData(callback): listen('pty-data-{id}', callback)
```

### 6.6 XTermView Spawn Sequence

```
Component mount
  → double requestAnimationFrame (ensure DOM layout + paint)
    → fitAddon.fit()
    → if cols > 0 && rows > 0: spawn(cols, rows)
    → else: retry up to 5 times (200ms apart)
```

**CRITICAL**: `usePty()` must ONLY be called in XTermView. Calling it elsewhere causes duplicate PTY spawns.

---

## 7. Chat Parser State Machine

### 7.1 States

```
STARTUP → (detect prompt marker) → IDLE
IDLE    → (user sends message)   → SKIP_ECHO
SKIP_ECHO → (newline received)   → RESPONDING
RESPONDING → (isDone detected)   → IDLE
```

### 7.2 Startup Detection (3 methods)

1. **Real-time listener**: Each PTY data chunk checked for `⏵` (U+23F5), "bypass", "Welcome to Claude", "claude.ai"
2. **Buffer polling**: Every 500ms, invoke `pty_get_buffer` and check raw buffer for same markers (catches events missed before listener registered)
3. **Timeout fallback**: After 4 seconds, force transition to idle

All three call `completeStartup()` which:
- Clears startup timeout + buffer poll timer
- Sets parserState → idle, isReady → true
- Starts session ID scan

### 7.3 Skip Echo Phase

After user sends a message, the PTY echoes it back. The parser skips this echo:
- Wait for a newline in the chunk
- After 1 newline: transition to `responding`
- Any content after the newline is the start of Claude's response
- Fallback: if no newline after 600ms, force transition to `responding`

### 7.4 Responding Phase

Accumulates chunks into `assistantBuffer`. On each chunk:

1. **Stall timer**: Reset to 1.5s if `⏵` is in buffer, else 4s. On fire → `forceComplete()`
2. **Choice prompt**: If "Enter to select" detected → extract TUI choices → `forceComplete(tuiChoices)`
3. **Permission box**: Detect `╭` (open), `│` (content), `╰` (close) → create permission ChatMessage
4. **Thinking line**: Parse `✻ Label... (duration · tokens · mode)` → update ThinkingIndicator
5. **isDone check**:
   - `hasPromptMarker`: buffer contains `⏵` (U+23F5) OR ` ❯ `
   - `hasBypass`: buffer matches `/bypass\s+permissions/i`
   - `hasEndNewline`: buffer ends with `⏵\n` or `❯\n` (question scenario)
   - `isDone = hasPromptMarker && (hasBypass || hasEndNewline)`
6. **Live sub-task**: Scan buffer for active tool calls (no output lines yet)
7. **Display update**: Clean content via `cleanAssistantContent()` → update message
8. **On isDone**: Parse token usage + elapsed time, finalize message, reset all state

### 7.5 Content Cleaning Pipeline

```
Raw PTY chunk
  → cleanPtyOutputForChat():  Strip non-color CSI, keep SGR colors,
                               handle CR overwrite, strip control chars
  → Accumulated in assistantBuffer
  → cleanAssistantContent():  Split into lines, strip ⏵ markers,
                               filter TUI_LINE_FILTERS, remove echo,
                               remove bare prompts, collapse blank lines
  → MessageBubble rendering:  cleanDisplayText() strips remaining ANSI + tags,
                               extractStandaloneImagePaths() for inline images,
                               detectChoices() for numbered prompts
```

### 7.6 TUI Line Filters (removed from display)

```
╭╰│ (box drawing)          ─━═ (horizontal rules)
bypass.*permissions         shift+tab.*cycle
dangerous.*tool             approve.*deny
trust.*dialog               (shift+tab
welcome to claude code      /help for help
/status for your plan       bare ⏵ lines
spinner lines with (Xs)     Done(...) summary
[Request interrupted]       compacting conversation
Enter to select             Tab/Arrow keys
← ☐✔ (tab bar navigation)
```

### 7.7 Permission Box Format

```
╭─────────────────────────────╮
│ Tool: Read                  │
│ File: /path/to/file.ts      │
│                             │
╰─────────────────────────────╯
```

Parsed into `PermissionPrompt { title, lines[] }`. Rendered as amber card with Allow/Deny buttons. On click: sends `y\r` or `n\r` to PTY.

### 7.8 Choice Prompt Detection (Two Paths)

**Path 1 — TUI buffer extraction** (ChatView.tsx):
- Triggered when "Enter to select" appears in `assistantBuffer`
- `extractTuiChoices()`: Strip ANSI, join to single line, regex match numbered options
- Pattern: `/(?:❯\s*)?(\d+)\.\s+(.+?)(?=(?:❯\s*)?\d+\.\s|Enter to select|$)/gi`
- Sets `message.tuiChoices` for structured rendering

**Path 2 — Content text parsing** (MessageBubble.tsx):
- Runs on finalized message content (when `!isStreaming`)
- `detectChoices()`: Scan for lines matching `/^\s*[❯>]?\s*(\d+)\.\s+(.+)$/`
- Requires at least 2 options
- Groups option label + following indented description lines
- Returns `ChoiceBlock { before, options[] }`

Both paths render `ChoicePromptUI` — interactive cards with keyboard navigation (↑↓ + Enter) and click.

### 7.9 History Loading

On mount (if `claudeSessionId` exists):
1. `invoke('session_load_history', { sessionId, projectPath })`
2. Rust reads `~/.claude/projects/{encoded_project}/{session_id}.jsonl`
3. Each JSONL line parsed: extract role (user/assistant), content (text or array of text parts), timestamp
4. System tags stripped: `<system-reminder>`, `<task-notification>`, etc.
5. Frontend filters noise: "[Request interrupted]", "[Interrupted by user]", "[No response]"
6. Detects compaction summaries → converts to system message
7. Loaded as initial `messages[]` with "Previous conversation" divider

---

## 8. Session Management

### 8.1 Session Scanner

Reads `~/.claude/history.jsonl` where Claude Code logs all sessions:

```jsonl
{"display":"What is 2+2?","timestamp":1708123456,"project":"C:\\Users\\user\\myproject","sessionId":"abc-123"}
```

**Algorithm:**
1. Parse each line of history.jsonl
2. Group by sessionId, keep latest timestamp + first display preview
3. For each session, check if session file exists:
   - Path: `~/.claude/projects/{encoded_project}/{session_id}.jsonl`
   - Encoding: replace non-alphanumeric chars with `-` (e.g., `C:\Users\foo` → `C--Users-foo`)
4. Sort by timestamp DESC
5. Return `SessionInfo[]`

### 8.2 Session ID Capture

After PTY startup:
1. `startSessionScan()` runs with 2.5s initial delay
2. Calls `invoke('session_scan_all')` to get all sessions
3. Filters for sessions matching this instance's CWD (normalized path comparison)
4. Picks most recent session with existing session file
5. Updates `instanceStore.setClaudeSessionId(instanceId, sessionId)`
6. Retries up to 5 times (3s apart) if no match found
7. **CRITICAL**: Always updates, even if a `claudeSessionId` already exists (fixes stale ID loop)

### 8.3 Session Resume

On next app start:
1. Auto-save restores `claudeSessionId` for each instance
2. PTY spawn reads `instance.claudeSessionId` → passes as `--resume SESSION_ID`
3. Claude Code resumes the conversation

### 8.4 Auto-Save Format (Version 2)

```typescript
interface SavedWorkspace {
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
    panelTypes?: Record<string, 'terminal' | 'computer'>;
  };
}
```

Stored in `localStorage` key `claude-gui-autosave`.

**Restore with ID remapping:**
- Old instance IDs → new IDs via `addInstance()` → `idMap`
- Layout tabOrder, panelOrder, panelRects keys all remapped through idMap
- Computer panel IDs preserved as-is (not remapped)

### 8.5 Workspace Files (.ady)

Custom format for manual save/load of workspaces:
```typescript
interface AdyFile {
  version: 1;
  appVersion: string;
  createdAt: string;
  name?: string;
  window: { x, y, width, height, isMaximized };
  tabOrder: string[];
  activeTabId: string | null;
  instances: Array<{ id, name, color, config, claudeSessionId? }>;
  settings?: Partial<AppSettings>;
  layout?: {
    layoutConfig, panelRects, stealFraction, focusedId, panelTypes?
  };
}
```

---

## 9. Zustand Stores (All State)

### 9.1 instanceStore

```typescript
State:
  instances: Map<string, ClaudeInstance>  // all instances by ID

Actions:
  addInstance(config, name?) → string     // creates with UUID, cycling color
  removeInstance(id)                       // deletes from map
  updateInstance(id, partial)             // shallow merge
  setStatus(id, status)                   // 'starting'|'running'|'stopped'|'error'
  setName(id, name)
  setColor(id, color)
  setClaudeSessionId(id, sessionId)
  getInstance(id) → ClaudeInstance | undefined

Default colors (cycling):
  ['#4a9eff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8', '#ff922b', '#20c997', '#f06595']
```

### 9.2 layoutStore

(See Section 5 for full algorithm details)

```typescript
State:
  layout: string | null              // legacy (first panel ID)
  tabOrder: string[]                 // ordered panel IDs
  activeTabId: string | null         // highlighted tab
  focusedId: string | null           // panel getting extra space
  layoutConfig: LayoutConfig | null  // current layout type + order
  panelRects: Map<string, PanelRect> // computed positions
  stealFraction: number              // 0.05–0.9, default 0.5
  panelTypes: Record<string, 'terminal' | 'computer'>

Actions:
  addPanel(id, type='terminal')
  removePanel(id)
  restoreLayout(tabOrder, activeTabId, focusedId, layoutConfig, panelRects, stealFraction, panelTypes?)
  setActiveTab(id)
  setFocused(id)                     // recomputes rects with focus sizing
  moveTab(fromIndex, toIndex)        // reorders + recomputes
  setPanelRect(id, rect)
  setRawPanelRects(rects)            // direct set during drag
  finishResize(gutterAxis, gutterBefore, gutterAfter)  // derives stealFraction
  resetStealFraction()               // back to 0.5
  clearPanelRects()
  applySnap(snappedId, zone)         // drag-to-zone layout change
```

### 9.3 settingsStore (persisted)

```typescript
State:
  settings: AppSettings

Defaults:
  defaultModel: 'claude-sonnet-4-6'
  defaultPermissionMode: 'default'
  defaultSkipPermissions: true
  defaultAgentMode: false
  fontSize: 14
  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace"
  autoSave: true
  autoSaveDir: ''
  systemMonitorInterval: 3000
  usagePollingInterval: 600000
  planBudgetUsd: 0

Storage: localStorage key 'claude-gui-settings'
Persistence: Zustand persist middleware with custom merge (prevents undefined on new fields)
```

### 9.4 systemStore, usageStore, authStore, computerStore

(See Section 2 of the explorer output for full state shapes)

---

## 10. React Components

### 10.1 Component Hierarchy

```
AuthGate
├── LoginScreen (if not authenticated)
└── App (or OnlineApp with relay hooks)
    ├── MenuBar
    │   └── Dropdown menus (File: New Instance, New Computer, Resume, Save, Load, Settings)
    ├── TabBar
    │   └── TabItem[] (sortable via dnd-kit, color dot, name, close button)
    ├── MosaicLayout
    │   ├── Panel[] (positioned absolutely by panelRects)
    │   │   ├── TerminalPanel (if panelType == 'terminal')
    │   │   │   ├── Toolbar (name, status, view toggle, rename, context menu, close)
    │   │   │   ├── ChatView (always mounted, hidden when terminal mode)
    │   │   │   │   ├── MessageBubble[] (user, assistant, permission, system)
    │   │   │   │   ├── ThinkingIndicator
    │   │   │   │   └── ChatInput (textarea + image chips)
    │   │   │   └── XTermView (always mounted, hidden when chat mode)
    │   │   └── ComputerPanel (if panelType == 'computer')
    │   ├── Gutter overlays (resize handles)
    │   └── Snap zone preview (during drag)
    ├── StatusBar
    │   ├── SystemResources (CPU/RAM bar gauges)
    │   └── UsageSummary (token costs)
    └── Dialogs
        ├── NewInstanceDialog
        ├── ResumeSessionDialog
        ├── SaveLoadDialog
        ├── SettingsDialog
        ├── UsageModal
        └── AboutDialog
```

### 10.2 TerminalPanel

**Toolbar**: Color dot → Instance name (double-click to rename) → Status badge → View toggle (Chat/Terminal) → Close button

**Context menu** (right-click toolbar): Rename, Change Color (opens ColorPickerPopover), Close

**Close sequence**: `cleanupPty(id)` → `destroyTerminal(id)` → `invoke('pty_kill', {id})` → `removePanel(id)` → `removeInstance(id)`

**Stale panel handling**: If instance not found in store, auto-removes panel via useEffect (no UI flash).

### 10.3 MessageBubble

**User message**: Accent-colored pill with user text, images, timestamp

**Assistant message**:
1. Parse content into segments: text parts and tool call parts
2. Tool calls detected via `/^[●•\s]*(Read|Write|Edit|Bash|...)\((.*)$/`
3. Tool output: lines starting with `⎿` or `┄`
4. 2+ consecutive tools → collapsible ActionGroup
5. Phase separator between tool group and text
6. Text rendered via MarkdownRenderer (react-markdown + remark-gfm + rehype-highlight)
7. ANSI colors preserved via ansi-to-html converter
8. Inline images: extracted from `[Images: path]` tags or standalone paths, rendered with `convertFileSrc()`
9. If `message.tuiChoices` set → render ChoicePromptUI cards
10. If last text segment has numbered options → `detectChoices()` → render ChoicePromptUI

**Tool icons**: Read 📄, Write ✏️, Edit ✏️, Bash ▶, Glob 🔍, Grep 🔎, WebFetch 🌐, WebSearch 🔍, Task 📋, TodoWrite 📝

### 10.4 ChatInput

- Auto-growing textarea: min 1 line, max 8 lines (LINE_HEIGHT = 20px)
- Enter = send, Shift+Enter = newline
- Image paste: clipboard items → ArrayBuffer → Rust `save_chat_image` → disk path + data URL preview
- Module-level `draftStore` Map (survives chat↔terminal toggle)
- Send format: text + `\n\n[Images: path1, path2]` if images attached
- PTY write: message text → 50ms delay → `\r` (Enter)

### 10.5 ThinkingIndicator

Shows live status during Claude's response:
- Row 1: Thinking icon + label + duration + token count + mode
- Row 2: Active tool name + args (e.g., "Read src/lib/utils.ts")

Pattern parsed: `✻ Thinking... (5.2s · ↓ 150 tokens · extended)`

---

## 11. Rust Backend Commands

### 11.1 PTY Commands

| Command | Args | Returns | Description |
|---------|------|---------|-------------|
| `pty_spawn` | id, cwd, cols, rows, model, skipPermissions, ... | `()` | Spawn Claude PTY |
| `pty_write` | id, data | `()` | Write to PTY stdin |
| `pty_resize` | id, cols, rows | `()` | Resize PTY dimensions |
| `pty_kill` | id | `()` | Kill PTY process |
| `pty_get_buffer` | id | `String` | Get raw output buffer |
| `pty_list_instances` | — | `Vec<String>` | List active PTY IDs |
| `pty_query_command` | id, command | `String` | Run command in suppressed mode |

### 11.2 Session Commands

| Command | Args | Returns | Description |
|---------|------|---------|-------------|
| `session_scan_all` | — | `Vec<SessionInfo>` | Scan history.jsonl for all sessions |
| `session_load_history` | sessionId, projectPath | `Vec<HistoryChatMessage>` | Load chat from session file |
| `session_save_ady` | path, content | `()` | Save workspace .ady file |
| `session_load_ady` | path | `String` | Load workspace .ady file |
| `session_parse_usage` | sessionId, projectPath | `UsageInfo` | Parse token usage from session |
| `session_list_recent` | — | `Vec<SessionInfo>` | List recent sessions |
| `session_debug_history` | — | `String` | Debug output of all sessions found |
| `save_chat_image` | data, projectDir, ext | `String` | Save image bytes to disk, return path |

### 11.3 System Commands

| Command | Args | Returns | Description |
|---------|------|---------|-------------|
| `system_monitor_start` | — | `()` | Start CPU/RAM/GPU polling |
| `system_monitor_stop` | — | `()` | Stop polling |

### 11.4 Auth Commands

| Command | Args | Returns | Description |
|---------|------|---------|-------------|
| `auth_login` | email, password, serverUrl | `AuthUser` | Login |
| `auth_register` | email, password, name, serverUrl | `AuthUser` | Register |
| `auth_logout` | — | `()` | Clear tokens |
| `auth_check` | — | `Option<AuthUser>` | Check current auth |
| `get_access_token` | — | `Option<String>` | Get stored token |
| `get_server_url` | — | `Option<String>` | Get stored server URL |
| `get_device_id` | — | `Option<String>` | Get device ID |
| `register_device` | serverUrl, accessToken, ... | `String` | Register device |

### 11.5 Relay Commands

| Command | Args | Returns | Description |
|---------|------|---------|-------------|
| `relay_connect` | serverUrl, accessToken, deviceId | `()` | Connect WebSocket |
| `relay_disconnect` | — | `()` | Disconnect |
| `relay_status` | — | `bool` | Is connected? |
| `relay_send_instances` | instances | `()` | Sync instance list |
| `relay_get_instance_count` | — | `usize` | Remote instance count |

### 11.6 Events (Rust → Frontend)

| Event | Payload | Description |
|-------|---------|-------------|
| `pty-data-{id}` | `String` | PTY output chunk |
| `pty-exit-{id}` | `void` | PTY process exited |
| `system-update` | `SystemUpdatePayload` | CPU/RAM/GPU stats |

---

## 12. CSS & Theming

### 12.1 Design System

```css
/* Color palette */
--bg-primary:    #1a1a2e    /* App background */
--bg-surface:    #16213e    /* Card/panel background */
--bg-elevated:   #1f2b47    /* Elevated elements */
--text-primary:  #e0e0e0    /* Main text */
--text-secondary:#a0a0a0    /* Muted text */
--accent:        #4a9eff    /* Primary accent (blue) */
--error:         #ff6b6b    /* Error/danger (red) */
--success:       #51cf66    /* Success (green) */
--warning:       #ffd43b    /* Warning (yellow) */

/* Typography */
Font family: system-ui for UI, monospace for code
Terminal font: JetBrains Mono, Cascadia Code, Fira Code, Consolas
Default font size: 14px

/* Terminal theme (xterm.js) */
background:  #1a1a2e
foreground:  #e0e0e0
cursor:      #4a9eff
selection:   rgba(74, 158, 255, 0.3)
black:       #2d2d2d / bright: #555555
red:         #ff6b6b / bright: #ff8787
green:       #51cf66 / bright: #69db7c
yellow:      #ffd43b / bright: #ffe066
blue:        #4a9eff / bright: #74b9ff
magenta:     #cc5de8 / bright: #da77f2
cyan:        #20c997 / bright: #38d9a9
white:       #e0e0e0 / bright: #ffffff
```

### 12.2 Layout Classes

```css
.app { display: flex; flex-direction: column; height: 100vh; }
.menu-bar { height: 32px; flex-shrink: 0; }
.tab-bar { height: 36px; flex-shrink: 0; display: flex; }
.mosaic-container { flex: 1; position: relative; overflow: hidden; }
.status-bar { height: 28px; flex-shrink: 0; }

/* Panel positioning (absolute within mosaic-container) */
.mosaic-tile {
  position: absolute;
  /* left, top, width, height set via inline style from panelRects */
  transition: all 200ms ease;
}

/* Gutters */
.mosaic-gutter { position: absolute; z-index: 10; }
.mosaic-gutter-x { cursor: col-resize; width: 4px; }
.mosaic-gutter-y { cursor: row-resize; height: 4px; }

/* Snap zone preview */
.snap-zone-preview {
  background: rgba(74, 158, 255, 0.15);
  border: 2px solid rgba(74, 158, 255, 0.4);
  border-radius: 8px;
  transition: all 150ms ease;
}
```

### 12.3 Chat Styles

```css
.chat-view { display: flex; flex-direction: column; height: 100%; }
.chat-messages { flex: 1; overflow-y: auto; padding: 16px; }

/* User bubble: accent-colored pill */
.msg--user .msg-body {
  background: rgba(accent, 0.15);
  border-radius: 16px 16px 4px 16px;
  border-left: 3px solid accent;
}

/* Assistant card: surface background */
.msg--assistant .msg-body {
  background: rgba(255,255,255,0.03);
  border-radius: 8px;
  border-left: 3px solid rgba(accent, 0.4);
}

/* Permission card: amber border */
.msg--permission .msg-body {
  border: 1px solid rgba(255, 193, 7, 0.3);
  background: rgba(255, 193, 7, 0.05);
}

/* Tool calls: monospace with icon */
.tool-call { font-family: monospace; font-size: 12px; }
.tool-call-header { display: flex; align-items: center; gap: 6px; }
.tool-call-output { border-left: 2px solid #333; margin-left: 8px; padding-left: 8px; }

/* Action group: collapsible */
.action-group-header { cursor: pointer; }
.action-group-body { max-height: 0; overflow: hidden; transition: max-height 200ms; }
.action-group--open .action-group-body { max-height: 2000px; }

/* Streaming cursor */
.streaming-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  background: accent; animation: pulse 1s ease-in-out infinite;
}
```

---

## 13. Authentication & Relay

### 13.1 Auth Flow
1. App checks `auth_check` Tauri command on startup
2. If tokens exist in keyring → authenticated
3. If not → show LoginScreen
4. Login/register calls auth server → receives tokens → stored in OS keyring
5. On auth success → `connectRelay()` called

### 13.2 Relay System
- WebSocket connection to backend server
- Syncs instance list (names, colors, configs)
- Forwards PTY output in real-time
- Receives remote commands (push notifications)
- Used for web companion / remote monitoring
- Falls back to offline mode if connection fails

### 13.3 Offline Mode
- App fully functional without auth/relay
- `authStore.goOffline()` sets `offlineMode = true`
- All local features work (PTY, layout, sessions, etc.)

---

## 14. Computer Use Feature

### 14.1 Overview
Experimental feature for viewing/controlling desktop windows through a GUI panel.

### 14.2 Rust Backend
- `xcap` crate for screenshots
- `enigo` crate for mouse/keyboard control
- Screenshot served via custom `screenshot://` URI protocol
- JPEG encoding with cache-busting headers

### 14.3 Frontend
- `ComputerPanel.tsx`: Shows live screenshot, forwards clicks/keys
- `computerStore.ts`: Manages computer sessions (target window, poll interval)
- Panel type: `'computer'` in `panelTypes` (layout store)
- Created via File → New Computer Panel

---

## 15. Critical Gotchas & Patterns

### 15.1 React 19 + Zustand Selector (INFINITE LOOP BUG)

**Problem**: `useStore(s => s.field ?? [])` creates a NEW empty array on every render. React 19's `useSyncExternalStore` sees this as a state change → re-render → new array → infinite loop.

**Fix**: Use module-level constant:
```typescript
const EMPTY: never[] = [];
const field = useStore(s => s.field ?? EMPTY);
```

### 15.2 Zustand Persist + New Fields

**Problem**: Adding a new field to a persisted store causes `undefined` because old localStorage data doesn't have it.

**Fix**: Custom merge function in persist config:
```typescript
persist(storeCreator, {
  merge: (persisted, current) => ({ ...current, ...(persisted as object) })
})
```

### 15.3 PTY Event Race Condition

**Problem**: `listen()` is async. If PTY sends data before listener is registered, events are dropped (not replayed).

**Fix**:
1. Buffer polling every 500ms via `pty_get_buffer` during startup
2. Async IIFE for listen setup with `isMounted` guard:
```typescript
(async () => {
  const fn = await listen(event, handler);
  if (!isMounted) { fn(); return; }  // cleanup if unmounted
  unlisten = fn;
})();
```

### 15.4 Stale Session ID Loop

**Problem**: Auto-save restores `claudeSessionId`. If that session is stale, `--resume ID` fails, Claude starts fresh with a NEW session. The new session ID is never captured → next restart tries stale ID again → infinite loop.

**Fix**: Session scan always runs and always updates the stored ID, even if one already exists.

### 15.5 XTermView Dimensions

**Problem**: `fitAddon.fit()` may return 0 cols/rows if the container isn't visible yet.

**Fix**: Retry up to 5 times (200ms apart). Double-RAF before first attempt to ensure DOM layout + paint.

### 15.6 Carriage Return Handling

**Problem**: Terminal `\r` (CR) means "return to column 0" — it overwrites the current line, not adds a newline. Spinners use this for animation.

**Fix**: `handleCarriageReturn()` splits on `\r`, keeps last segment (the overwritten result):
```
"Loading...\rDone!  " → "Done!     " (padded)
```

### 15.7 UTF-8 Incomplete Sequences

**Problem**: PTY reads may split multi-byte UTF-8 characters across chunks.

**Fix**: In Rust reader thread, buffer incomplete trailing bytes and prepend to next read.

### 15.8 Module-Level PTY Spawn Prevention

**Problem**: React strict mode double-mounts components, which could spawn two PTY processes.

**Fix**: Module-level `Set<string>` (`spawnedPtys`) checked before spawn. Deleted on kill.

---

## 16. Build & Configuration

### 16.1 Vite Config

```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
    hmr: { port: 1421 }
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
  }
});
```

### 16.2 Tauri Config

```json
{
  "productName": "Claude GUI",
  "version": "0.0.2-beta",
  "identifier": "com.claude.gui",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{
      "title": "Claude GUI",
      "width": 1400,
      "height": 900,
      "resizable": true,
      "decorations": true
    }],
    "security": {
      "csp": null,
      "assetProtocol": { "enable": true, "scope": ["**"] }
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": ["icons/icon.ico"]
  }
}
```

### 16.3 Build Commands

```bash
# Development
npm run tauri dev

# Production build
npm run tauri build

# TypeScript check only
npx tsc --noEmit
```

### 16.4 Windows Build Notes

- Rust target: `stable-x86_64-pc-windows-gnu` (MSYS2, not MSVC)
- MSYS2 path: `/c/msys64/mingw64/bin` must be in PATH
- Linker: lld (via `.cargo/config.toml`: `rustflags = ["-C", "link-arg=-fuse-ld=lld"]`)
- Kill stale processes on port 1420 before dev builds

---

*This document was generated from the Claude GUI codebase at version 0.0.2-beta. It contains all information needed to rebuild the application from scratch.*
