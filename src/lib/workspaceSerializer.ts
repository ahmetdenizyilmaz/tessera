import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore, getDefaultConfig, computeRects, type PanelType } from '../store/layoutStore';
import { useGroupStore, captureGroupSnapshot, type GroupState } from '../store/groupStore';
import { usePluginStore } from '../store/pluginStore';
import type { InstanceConfig } from '../types/instance';
import type { LayoutConfig, PanelRect, SavedWorkspace, StealFraction } from '../types/session';

// ─── Keys ────────────────────────────────────────────────────────────────────

// Same key the legacy v2 auto-save used so existing users' workspaces survive
export const AUTOSAVE_KEY = 'claude-gui-autosave';
// Legacy key groupStore used to persist itself; read once for v2 migration
const LEGACY_GROUPS_KEY = 'claude-gui-groups';

const SAVE_DEBOUNCE_MS = 300;

// ─── Snapshot Types ──────────────────────────────────────────────────────────

export interface SavedInstance {
  id: string;
  name: string;
  color: string;
  config: InstanceConfig;
  claudeSessionId?: string;
}

export interface SerializedGroup {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  parentId: string | null;
  childIds: string[];
  layoutConfig: LayoutConfig | null;
  panelRects: Record<string, PanelRect>;
  focusedChildId: string | null;
  activeChildId: string | null;
  stealFraction: StealFraction;
}

export interface SavedLayout {
  tabOrder: string[];
  activeTabId: string | null;
  focusedId: string | null;
  layoutConfig: LayoutConfig | null;
  panelRects: Record<string, PanelRect>;
  stealFraction: StealFraction;
  panelTypes: Record<string, PanelType>;
  widgetKinds: Record<string, string>;
}

export interface SavedPlugin {
  id: string;
  pluginName: string;
  title?: string;
}

export interface WorkspaceSnapshotV3 {
  version: 3;
  savedAt: number;
  instances: SavedInstance[];
  layout: SavedLayout;
  groups: Record<string, SerializedGroup>;
  plugins: SavedPlugin[];
}

/** Internal: legacy v2 snapshots may lack a layout section entirely */
interface NormalizedSnapshot {
  instances: SavedInstance[];
  layout: SavedLayout | null;
  groups: Record<string, SerializedGroup>;
  plugins: SavedPlugin[];
}

// ─── Serialize ───────────────────────────────────────────────────────────────

export function serializeWorkspace(): WorkspaceSnapshotV3 {
  const instances = useInstanceStore.getState().instances;
  const pluginInstances = usePluginStore.getState().instances;
  const ls = useLayoutStore.getState();

  // When inside a group, layoutStore holds that group's children — the real
  // root layout sits at the bottom of the group navigation stack, and the
  // live layout is synced back into the currently open group.
  const { groups, rootLayout } = captureGroupSnapshot();

  const layoutSrc = rootLayout ?? {
    tabOrder: ls.tabOrder,
    activeTabId: ls.activeTabId,
    focusedId: ls.focusedId,
    layoutConfig: ls.layoutConfig,
    panelRects: ls.panelRects,
    stealFraction: ls.stealFraction,
  };

  const serializedGroups: Record<string, SerializedGroup> = {};
  for (const [id, group] of groups) {
    serializedGroups[id] = {
      ...group,
      panelRects: Object.fromEntries(group.panelRects),
    };
  }

  return {
    version: 3,
    savedAt: Date.now(),
    instances: Array.from(instances.values()).map((inst) => ({
      id: inst.id,
      name: inst.name,
      color: inst.color,
      config: inst.config,
      claudeSessionId: inst.claudeSessionId,
    })),
    layout: {
      tabOrder: [...layoutSrc.tabOrder],
      activeTabId: layoutSrc.activeTabId,
      focusedId: layoutSrc.focusedId,
      layoutConfig: layoutSrc.layoutConfig,
      panelRects: Object.fromEntries(layoutSrc.panelRects),
      stealFraction: layoutSrc.stealFraction,
      // panelTypes / widgetKinds are global (they also cover panels hidden
      // inside groups), so always take the live values
      panelTypes: { ...ls.panelTypes },
      widgetKinds: { ...ls.widgetKinds },
    },
    groups: serializedGroups,
    plugins: Array.from(pluginInstances.values()).map((p) => ({
      id: p.id,
      pluginName: p.pluginName,
      title: p.title,
    })),
  };
}

// ─── Migration ───────────────────────────────────────────────────────────────

/**
 * stealFraction used to be a single scalar applied to both axes; it is now
 * per-axis. Old snapshots (autosave, .ady files, group snapshots) may still
 * carry a number — expand it to both axes.
 */
export function normalizeStealFraction(
  v: StealFraction | number | null | undefined,
): StealFraction {
  if (typeof v === 'number') return { x: v, y: v };
  return v ?? { x: 0.5, y: 0.5 };
}

function readLegacyGroups(): Record<string, SerializedGroup> {
  try {
    const raw = localStorage.getItem(LEGACY_GROUPS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { groups?: Record<string, SerializedGroup> };
    return parsed.groups ?? {};
  } catch {
    return {};
  }
}

/**
 * Migrate the legacy v2 `SavedWorkspace` shape:
 * - groups were persisted separately under 'claude-gui-groups'
 * - plugin instances were never persisted; recover the plugin name from the
 *   stable panel id ('plugin-<name>-<timestamp>') so panels aren't ghosts
 */
function migrateV2(saved: SavedWorkspace): NormalizedSnapshot | null {
  if (!saved.instances?.length) return null;

  const layout: SavedLayout | null = saved.layout
    ? {
        tabOrder: saved.layout.tabOrder ?? [],
        activeTabId: saved.layout.activeTabId ?? null,
        focusedId: saved.layout.focusedId ?? null,
        layoutConfig: saved.layout.layoutConfig ?? null,
        panelRects: saved.layout.panelRects ?? {},
        stealFraction: normalizeStealFraction(saved.layout.stealFraction),
        panelTypes: saved.layout.panelTypes ?? {},
        widgetKinds: saved.layout.widgetKinds ?? {},
      }
    : null;

  const plugins: SavedPlugin[] = [];
  if (layout) {
    for (const [id, type] of Object.entries(layout.panelTypes)) {
      if (type !== 'plugin') continue;
      const match = /^plugin-(.+)-\d+$/.exec(id);
      if (match) plugins.push({ id, pluginName: match[1] });
    }
  }

  return {
    instances: saved.instances,
    layout,
    groups: readLegacyGroups(),
    plugins,
  };
}

function normalizeSnapshot(raw: unknown): NormalizedSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const version = (raw as { version?: unknown }).version;

  if (version === 3) {
    const snap = raw as WorkspaceSnapshotV3;
    return {
      instances: snap.instances ?? [],
      layout: snap.layout
        ? {
            ...snap.layout,
            // Older v3 snapshots stored a scalar stealFraction
            stealFraction: normalizeStealFraction(snap.layout.stealFraction),
            panelTypes: snap.layout.panelTypes ?? {},
            widgetKinds: snap.layout.widgetKinds ?? {},
          }
        : null,
      groups: snap.groups ?? {},
      plugins: snap.plugins ?? [],
    };
  }

  if (version === 2) {
    return migrateV2(raw as SavedWorkspace);
  }

  return null;
}

// ─── Deserialize ─────────────────────────────────────────────────────────────

export function deserializeWorkspace(raw: unknown): void {
  const snapshot = normalizeSnapshot(raw);
  if (!snapshot) return;

  // ONE id map: old instance id → freshly minted id. Widget, group and
  // plugin panel ids are stable across restarts and map to themselves.
  const idMap = new Map<string, string>();

  // Workspaces saved before session-id pinning can carry the same id on two
  // panels (the old newest-in-folder adoption). Restoring both would put two
  // processes on one JSONL, so only the first keeps the id.
  const seenSessionIds = new Set<string>();

  for (const inst of snapshot.instances) {
    const newId = useInstanceStore.getState().addInstance(inst.config, inst.name);
    idMap.set(inst.id, newId);

    // Restore color and session ID
    if (inst.color) {
      useInstanceStore.getState().setColor(newId, inst.color);
    }
    if (inst.claudeSessionId && seenSessionIds.has(inst.claudeSessionId)) {
      console.warn(
        `[restore] panel "${inst.name}" shared session ${inst.claudeSessionId.slice(0, 8)}… with another panel — starting it fresh`,
      );
      inst.claudeSessionId = undefined;
    } else if (inst.claudeSessionId) {
      seenSessionIds.add(inst.claudeSessionId);
    }
    if (inst.claudeSessionId) {
      useInstanceStore.getState().setClaudeSessionId(newId, inst.claudeSessionId);
      // Drop stale session ids at restore time so they stop being
      // re-persisted forever (the Rust-side resume guard is authoritative)
      const sid = inst.claudeSessionId;
      invoke<boolean>('session_exists', { projectPath: inst.config.cwd || '', sessionId: sid })
        .then((exists) => {
          if (!exists) {
            const cur = useInstanceStore.getState().instances.get(newId)?.claudeSessionId;
            if (cur === sid) {
              useInstanceStore.getState().setClaudeSessionId(newId, '');
            }
          }
        })
        .catch(() => {});
    }
  }

  const remapId = (id: string) => idMap.get(id) ?? id;

  // Recreate plugin instances under their saved (stable) panel ids
  const deadIds = new Set<string>();
  const savedPluginIds = new Set<string>();
  for (const plugin of snapshot.plugins) {
    savedPluginIds.add(plugin.id);
    const ok = usePluginStore.getState().restoreInstance(plugin.pluginName, plugin.id, plugin.title);
    if (!ok) deadIds.add(plugin.id);
  }

  // Panels whose backing data is gone would render as ghosts — drop them
  if (snapshot.layout) {
    for (const [id, type] of Object.entries(snapshot.layout.panelTypes)) {
      if (type === 'plugin' && !savedPluginIds.has(id)) deadIds.add(id);
      if (type === 'group' && !(id in snapshot.groups)) deadIds.add(id);
    }
  }
  const keepId = (id: string) => !deadIds.has(id);

  // Restore groups (group ids stay stable; child ids are remapped)
  const newGroups = new Map<string, GroupState>();
  for (const [gid, sg] of Object.entries(snapshot.groups)) {
    const childIds = sg.childIds.map(remapId).filter(keepId);

    const panelRects = new Map<string, PanelRect>();
    for (const [oldId, rect] of Object.entries(sg.panelRects ?? {})) {
      const nid = remapId(oldId);
      if (keepId(nid)) panelRects.set(nid, rect);
    }

    let layoutConfig = sg.layoutConfig;
    if (layoutConfig) {
      layoutConfig = {
        ...layoutConfig,
        panelOrder: layoutConfig.panelOrder.map(remapId).filter(keepId),
      };
    }

    const focused = sg.focusedChildId ? remapId(sg.focusedChildId) : null;
    const active = sg.activeChildId ? remapId(sg.activeChildId) : null;

    newGroups.set(gid, {
      id: gid,
      name: sg.name,
      icon: sg.icon,
      color: sg.color,
      parentId: sg.parentId ?? null,
      childIds,
      layoutConfig,
      panelRects,
      focusedChildId: focused && childIds.includes(focused) ? focused : (childIds[0] ?? null),
      activeChildId: active && childIds.includes(active) ? active : (childIds[0] ?? null),
      stealFraction: normalizeStealFraction(sg.stealFraction),
    });
  }
  useGroupStore.getState().restoreGroups(newGroups);

  // Restore layout with remapped IDs
  if (snapshot.layout) {
    const layout = snapshot.layout;

    const newTabOrder = layout.tabOrder.map(remapId).filter(keepId);

    const remappedActive = layout.activeTabId ? remapId(layout.activeTabId) : null;
    const remappedFocused = layout.focusedId ? remapId(layout.focusedId) : null;
    const newActiveTabId = remappedActive === null
      ? null
      : (keepId(remappedActive) ? remappedActive : (newTabOrder[0] ?? null));
    const newFocusedId = remappedFocused === null
      ? null
      : (keepId(remappedFocused) ? remappedFocused : (newTabOrder[0] ?? null));

    const stealFraction = normalizeStealFraction(layout.stealFraction);

    let newLayoutConfig = layout.layoutConfig;
    if (newLayoutConfig) {
      newLayoutConfig = {
        ...newLayoutConfig,
        panelOrder: newLayoutConfig.panelOrder.map(remapId).filter(keepId),
      };
    }

    let newPanelRects = new Map<string, PanelRect>();
    for (const [oldId, rect] of Object.entries(layout.panelRects ?? {})) {
      const nid = remapId(oldId);
      if (keepId(nid)) newPanelRects.set(nid, rect);
    }

    // Guard: if the saved config/rects no longer cover the tab set (e.g. a
    // panel was moved to root while inside a group), fall back to a default
    if (newTabOrder.length > 0) {
      if (!newLayoutConfig || newLayoutConfig.panelOrder.length !== newTabOrder.length) {
        newLayoutConfig = getDefaultConfig(newTabOrder, newFocusedId);
      }
      if (newPanelRects.size !== newTabOrder.length) {
        newPanelRects = computeRects(newLayoutConfig, newFocusedId, stealFraction);
      }
    }

    const newPanelTypes: Record<string, PanelType> = {};
    for (const [oldId, type] of Object.entries(layout.panelTypes)) {
      const nid = remapId(oldId);
      if (keepId(nid)) newPanelTypes[nid] = type;
    }

    const newWidgetKinds: Record<string, string> = {};
    for (const [oldId, kind] of Object.entries(layout.widgetKinds)) {
      const nid = remapId(oldId);
      if (keepId(nid)) newWidgetKinds[nid] = kind;
    }

    useLayoutStore.getState().restoreLayout(
      newTabOrder,
      newActiveTabId,
      newFocusedId,
      newLayoutConfig,
      newPanelRects,
      stealFraction,
      newPanelTypes,
      newWidgetKinds,
    );
  } else {
    // No saved layout: add panels for each instance
    for (const inst of snapshot.instances) {
      const newId = idMap.get(inst.id);
      if (newId) {
        useLayoutStore.getState().addPanel(newId);
      }
    }
  }
}

// ─── Restore (once per app lifetime) ─────────────────────────────────────────

// Module-level guard: double-mount / StrictMode / App remount can never
// restore twice.
let restored = false;

export function restoreOnce(): void {
  if (restored) return;
  restored = true;

  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    deserializeWorkspace(JSON.parse(raw));
    // Re-save promptly so legacy v2 snapshots are migrated to v3 on disk
    scheduleSave();
  } catch (err) {
    console.error('Failed to restore auto-save:', err);
  }
}

// ─── Save ────────────────────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Synchronously write the current workspace to localStorage. */
export function saveNow(): void {
  // Never clobber the snapshot before the initial restore has run
  if (!restored) return;

  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeWorkspace()));
  } catch (err) {
    console.error('Auto-save failed:', err);
  }
}

/** Debounced save (300ms trailing) — call on every store mutation. */
export function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, SAVE_DEBOUNCE_MS);
}
