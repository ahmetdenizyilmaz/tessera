# Previous Issues Log

> Shared knowledge base for all agents. Append new issues here so they are never repeated.
> Format: `### [DATE] [AGENT] Issue Title` followed by description and fix.

---

### 2026-03-12 [setup] Vite HMR Module-Level State
**Issue:** Module-level mutable objects (like `sidebarDragState`) can become stale across Vite HMR updates. When `layoutStore.ts` is re-evaluated, a new object is created. Components that haven't re-evaluated still reference the old object.
**Fix:** Anchor module-level mutable state to `globalThis`:
```typescript
export const myState = (globalThis as any).__myState ??= { ... };
```

### 2026-03-12 [setup] React 19 + Zustand Infinite Loop
**Issue:** Using inline object/array literals as default values in Zustand selectors causes infinite re-renders in React 19 due to strict reference equality checks.
**Fix:** Use module-level constants:
```typescript
const EMPTY: string[] = [];
const tabOrder = useLayoutStore(s => s.tabOrder ?? EMPTY);
```

### 2026-03-12 [setup] Crate Type Must Be lib Only
**Issue:** `src-tauri/Cargo.toml` must have `crate-type = ["lib"]` only. Adding `cdylib` causes Windows build failure.
**Fix:** Never add `cdylib` to crate-type.

### 2026-03-12 [setup] Single generate_handler
**Issue:** Tauri v2 only allows a single `generate_handler![]` macro invocation. All commands must be registered in one place.
**Fix:** All Tauri commands go in a single `generate_handler![]` in `lib.rs`.

### 2026-03-12 [setup] Button Elements Block Drag Events
**Issue:** HTML `<button>` elements can interfere with pointer event propagation during drag operations due to browser native drag behavior.
**Fix:** Add `draggable={false}` and `onDragStart={(e) => e.preventDefault()}` to buttons used as drag sources. Wrap SVG icons in `<span style={{ pointerEvents: 'none' }}>`.

### 2026-03-12 [setup] PanelType Values
**Issue:** Current `PanelType` is `'terminal' | 'computer' | 'llm' | 'widget'`. New types being added: `'group' | 'plugin'`.
**Fix:** Update the type definition and all switch statements / type guards that handle PanelType.

### 2026-03-12 [setup] Layout Persistence
**Issue:** Layout state is persisted to localStorage. New fields added to the store need default values in the persist merge function, otherwise they'll be undefined on app restart.
**Fix:** Always provide defaults in the Zustand persist merge, and handle missing fields gracefully.

### 2026-03-12 [phase1] PanelType Union Updated
**Issue:** `PanelType` is now `'terminal' | 'computer' | 'llm' | 'widget' | 'group' | 'plugin'`. This is referenced in 5 places: `layoutStore.ts` (canonical), `session.ts` (AdyFile & SavedWorkspace), `SaveLoadDialog.tsx`, `useAutoSave.ts`. All were updated.
**Fix:** When adding new panel types, search for all hardcoded PanelType unions across the codebase and update them all.

### 2026-03-12 [phase1] Group Panels Don't Use InstanceStore
**Issue:** Group panels (panelType='group') do not have entries in `instanceStore`. TabItem, TabBar close/rename/color handlers must check for group type before accessing `instanceStore`.
**Fix:** Always check `panelType` before calling `getInstance()`, `removeInstance()`, or similar. Group state is in `groupStore`, not `instanceStore`.

### 2026-03-12 [phase1] Group State Persistence is Separate
**Issue:** Group state (groups map, groupStack) is persisted to its own localStorage key `claude-gui-groups`, separate from the layout key `claude-gui-layout`. Both must be present for full state restoration.
**Fix:** `groupStore.ts` handles its own persistence via `saveGroupState()`/`loadGroupState()`. The `groupStore` initializes from persisted state on module load.

### 2026-03-12 [phase1] GroupStore Counter HMR Safety
**Issue:** The group counter used for generating default names must survive HMR module re-evaluation.
**Fix:** Anchor to `globalThis`: `const groupCounter = (globalThis as any).__groupCounter ??= { value: 0 };`

### 2026-03-12 [phase5] Plugin Panels Don't Use InstanceStore
**Issue:** Plugin panels (`panelType='plugin'`) do NOT have entries in `instanceStore`. Their state is in `pluginStore.instances`. `TabItem`, `TabBar` close/rename/color handlers must check for `panelType === 'plugin'` before accessing `instanceStore`, and use `pluginStore` instead.
**Fix:** Always check `panelType` before calling `getInstance()`, `removeInstance()`, or similar. Plugin state lives in `pluginStore.instances`, keyed by the same instance ID used in `layoutStore.tabOrder`.

### 2026-03-12 [phase5] TypeScript Narrows Plugin Type After Early Return
**Issue:** When `isPlugin` is checked with an early return in TabItem, TypeScript's control flow narrows `panelType` so that later comparisons like `panelType !== 'plugin'` produce TS2367 ("no overlap") errors.
**Fix:** Use the boolean `isPlugin` variable instead of re-comparing `panelType` after the early-return branch. E.g., `if (!isGroup && !isWidget && !isPlugin) { removeInstance(id); }`.

### 2026-03-12 [phase5] Plugin Bridge Registry HMR Safety
**Issue:** The bridge registry (mapping instanceId -> PluginBridge) must survive Vite HMR re-evaluation to avoid orphaned postMessage listeners.
**Fix:** Anchor to `globalThis`: `const bridgeRegistry = (globalThis as any).__pluginBridgeRegistry ??= new Map();`

### 2026-03-12 [phase5] Plugin iframe Custom Protocol Not Yet Registered
**Issue:** Plugin iframes use `subapp://{pluginName}/index.html` as their src URL. This custom protocol is not yet registered in Tauri, so the iframe will fail to load. A fallback overlay in PluginPanel shows a "waiting for custom protocol" message.
**Fix:** In a future phase, register a Tauri custom protocol handler (`claude-gui://subapp/` or `subapp://`) to serve files from the `subapps/` directory. Also add the Rust `scan_plugins` command.

### 2026-03-12 [phase2] Cross-Group Drag State Anchored to globalThis
**Issue:** The `crossGroupDragState` object (tracking active drag ID, drop target, and drop type) must survive Vite HMR to avoid stale references during drag operations.
**Fix:** Anchored to `globalThis` in `TabBar.tsx`: `export const crossGroupDragState = (globalThis as any).__crossGroupDragState ??= { ... };`

### 2026-03-12 [phase2] Breadcrumb Droppables Must Be Inside DndContext
**Issue:** `GroupBreadcrumb` renders `useDroppable` hooks. These only work if the component is mounted inside the `DndContext` provider. Initially the breadcrumb was rendered before/outside the DndContext in `TabBar`.
**Fix:** Moved `<GroupBreadcrumb />` to be rendered inside the `<DndContext>` wrapper in `TabBar.tsx`.

### 2026-03-12 [phase2] Custom Collision Detection for Cross-Group Drops
**Issue:** dnd-kit's `closestCenter` strategy always prefers the nearest sortable tab, which prevents breadcrumb segments and group tabs from being detected as drop targets during drag.
**Fix:** Created `crossGroupCollision` function that first checks `pointerWithin` for breadcrumb/navigate-up droppables, then for group tab droppables, and falls back to `closestCenter` for regular tab reordering.

### 2026-03-12 [phase2] Dual Sortable + Droppable on Group Tabs
**Issue:** Group tabs need to participate in both tab reordering (sortable) and be valid drop targets for cross-group moves (droppable). `useSortable` and `useDroppable` both need to set a ref on the same DOM node.
**Fix:** In `TabItem`, get separate refs from each hook (`setSortableRef` and `setDroppableRef`) and combine them in a single `setNodeRef` callback: `const setNodeRef = (node) => { setSortableRef(node); if (isGroup) setDroppableRef(node); };`

### 2026-03-12 [critical] Group Navigation Must Swap Layout State
**Issue:** Entering a group did nothing to the workspace view because MosaicLayout reads from `layoutStore`, not from the group's state in `groupStore`. The core group navigation feature was non-functional.
**Fix:** Implemented "layout swap" pattern in `groupStore`. On `enterGroup`: capture current layoutStore state to a saved stack, then load the group's children/layout into layoutStore via `restoreLayout`. On `exitGroup`: sync current layout back to the group in groupStore, then pop and restore the previous layout from the saved stack. `jumpToLevel` handles multi-level jumps. MosaicLayout, TabBar, and all existing drag/snap/resize logic work unchanged because they always read from layoutStore.

### 2026-03-12 [critical] Saved Layout Stack Not Persisted
**Issue:** The `savedLayoutStack` (which holds parent layouts during group navigation) is module-level and anchored to `globalThis` for HMR survival, but NOT persisted to localStorage. On app restart, the stack is empty, so `exitGroup` would have no state to restore.
**Fix:** Always reset `groupStack` to `[]` on app load. The user starts at root level; they can re-enter groups. This avoids the complexity of persisting the full layout stack.

### 2026-03-12 [critical] deleteGroup Orphaned Children
**Issue:** `deleteGroup` removed the group from its parent's `childIds` but did not move the group's own children anywhere. They became unreachable.
**Fix:** In `deleteGroup`, splice the group's children into the parent's `childIds` at the position where the group was. Also add orphaned children to the current `layoutStore.tabOrder` so they appear immediately in the view.

### 2026-03-12 [critical] addPanel Inside Group Must Register in GroupStore
**Issue:** When inside a group, calling `layoutStore.addPanel()` only adds to the current view's tabOrder. The exit-group sync saves this back, but if the app crashes, the panel is lost from the group.
**Fix:** All panel creation paths (handleNewInstance, NewInstanceDialog, NewLlmDialog, ResumeSessionDialog, handleNewPlugin) now also call `groupStore.addToGroup(currentGroupId, id)` when `getCurrentGroupId()` is non-null.
