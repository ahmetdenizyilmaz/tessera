import { create } from 'zustand';
import type { LayoutConfig, PanelRect } from '../types/session';
import { useLayoutStore, getDefaultConfig, computeRects, type PanelType } from './layoutStore';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GroupState {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  parentId: string | null; // null = root level
  childIds: string[]; // ordered list of child panel IDs
  layoutConfig: LayoutConfig | null;
  panelRects: Map<string, PanelRect>;
  focusedChildId: string | null;
  activeChildId: string | null;
  stealFraction: number;
}

export interface BreadcrumbSegment {
  id: string | null; // null = root (Main)
  name: string;
}

// ─── Module-level EMPTY constants (React 19 + Zustand infinite loop prevention)

const EMPTY_GROUP_STACK: string[] = [];
const EMPTY_CHILDREN: string[] = [];
const EMPTY_BREADCRUMB: BreadcrumbSegment[] = [];

// ─── Persistence ─────────────────────────────────────────────────────────────
// Group persistence is owned by lib/workspaceSerializer.ts (the single source
// of truth for the whole workspace). The legacy 'claude-gui-groups' key is
// read there once for migration.

// ─── Layout Sync (swap layout state when entering/exiting groups) ────────────

export interface SavedLayoutState {
  tabOrder: string[];
  activeTabId: string | null;
  focusedId: string | null;
  layoutConfig: LayoutConfig | null;
  panelRects: Map<string, PanelRect>;
  stealFraction: number;
  panelTypes: Record<string, PanelType>;
  widgetKinds: Record<string, string>;
}

const MAX_LAYOUT_STACK_DEPTH = 50;

const savedLayoutStack: SavedLayoutState[] =
  (globalThis as any).__savedLayoutStack ??= [];

function captureLayout(): SavedLayoutState {
  const ls = useLayoutStore.getState();
  return {
    tabOrder: ls.tabOrder,
    activeTabId: ls.activeTabId,
    focusedId: ls.focusedId,
    layoutConfig: ls.layoutConfig,
    panelRects: ls.panelRects,
    stealFraction: ls.stealFraction,
    panelTypes: { ...ls.panelTypes },
    widgetKinds: { ...ls.widgetKinds },
  };
}

function applyLayoutFromGroup(group: GroupState) {
  const ls = useLayoutStore.getState();
  const childIds = group.childIds;

  if (childIds.length === 0) {
    ls.restoreLayout([], null, null, null, new Map(), 0.5, ls.panelTypes, ls.widgetKinds);
    return;
  }

  const config = group.layoutConfig ?? getDefaultConfig(childIds, group.focusedChildId);
  const rects = group.panelRects.size > 0
    ? group.panelRects
    : computeRects(config, group.focusedChildId, group.stealFraction);

  ls.restoreLayout(
    childIds,
    group.activeChildId ?? childIds[0] ?? null,
    group.focusedChildId ?? childIds[0] ?? null,
    config,
    rects,
    group.stealFraction,
    ls.panelTypes,
    ls.widgetKinds,
  );
}

function restoreLayoutFromSaved(saved: SavedLayoutState) {
  const ls = useLayoutStore.getState();
  // Merge saved panelTypes/widgetKinds with current — saved types take priority
  // so that type info survives even if current state was wiped (e.g. empty tabOrder)
  const mergedTypes = { ...saved.panelTypes, ...ls.panelTypes };
  const mergedKinds = { ...saved.widgetKinds, ...ls.widgetKinds };
  ls.restoreLayout(
    saved.tabOrder,
    saved.activeTabId,
    saved.focusedId,
    saved.layoutConfig,
    saved.panelRects,
    saved.stealFraction,
    mergedTypes,
    mergedKinds,
  );
}

/** Save current layoutStore state back into a group's fields */
function syncLayoutToGroup(
  groups: Map<string, GroupState>,
  groupId: string,
): Map<string, GroupState> {
  const ls = useLayoutStore.getState();
  const group = groups.get(groupId);
  if (!group) return groups;

  const updated = new Map(groups);
  updated.set(groupId, {
    ...group,
    childIds: ls.tabOrder,
    activeChildId: ls.activeTabId,
    focusedChildId: ls.focusedId,
    layoutConfig: ls.layoutConfig,
    panelRects: ls.panelRects,
    stealFraction: ls.stealFraction,
  });
  return updated;
}

/**
 * Snapshot for workspace serialization: the full groups map (with the live
 * layout synced into the currently open group) plus the root-level layout
 * when we're currently inside a group (the root layout then sits at the
 * bottom of the saved layout stack).
 */
export function captureGroupSnapshot(): {
  groups: Map<string, GroupState>;
  rootLayout: SavedLayoutState | null;
} {
  const state = useGroupStore.getState();
  if (state.groupStack.length === 0) {
    return { groups: state.groups, rootLayout: null };
  }
  const currentGroupId = state.groupStack[state.groupStack.length - 1];
  const groups = syncLayoutToGroup(state.groups, currentGroupId);
  const rootLayout = savedLayoutStack.length > 0 ? savedLayoutStack[0] : null;
  return { groups, rootLayout };
}

// ─── Group Counter (anchored to globalThis for HMR survival)

const groupCounter: { value: number } = (globalThis as any).__groupCounter ??= { value: 0 };

// ─── Store ───────────────────────────────────────────────────────────────────

interface GroupStoreState {
  groups: Map<string, GroupState>;
  groupStack: string[];
  transitionDirection: 'enter' | 'exit' | null;
  transitionGroupId: string | null;

  // Navigation
  enterGroup: (groupId: string) => void;
  commitEnterGroup: () => void;
  exitGroup: () => void;
  jumpToLevel: (groupId: string | null) => void;
  clearTransition: () => void;

  // Group CRUD
  createGroup: (parentId: string | null, name?: string) => string;
  renameGroup: (groupId: string, name: string) => void;
  deleteGroup: (groupId: string) => void;
  restoreGroups: (groups: Map<string, GroupState>) => void;

  // Panel management within groups
  addToGroup: (groupId: string, panelId: string) => void;
  removeFromGroup: (groupId: string, panelId: string) => void;
  moveToGroup: (panelId: string, fromGroupId: string | null, toGroupId: string | null) => void;

  // Update group layout state
  setGroupLayoutConfig: (groupId: string, config: LayoutConfig | null) => void;
  setGroupPanelRects: (groupId: string, rects: Map<string, PanelRect>) => void;
  setGroupFocusedChild: (groupId: string, childId: string | null) => void;
  setGroupActiveChild: (groupId: string, childId: string | null) => void;
  setGroupStealFraction: (groupId: string, fraction: number) => void;

  // Current view helpers (computed, not stored)
  getCurrentGroupId: () => string | null;
  getCurrentChildren: () => string[];
  getBreadcrumb: () => BreadcrumbSegment[];
}

export const useGroupStore = create<GroupStoreState>((set, get) => ({
  groups: new Map(),
  groupStack: [], // Always start at root; layout sync state is lost across reloads
  transitionDirection: null,
  transitionGroupId: null,

  clearTransition: () => set({ transitionDirection: null, transitionGroupId: null }),

  // ─── Navigation ──────────────────────────────────────────────────────

  enterGroup: (groupId: string) => {
    const state = get();
    if (!state.groups.has(groupId)) return;
    if (state.groupStack[state.groupStack.length - 1] === groupId) return;
    // Signal animation intent — MosaicLayout will call commitEnterGroup after animation
    set({ transitionDirection: 'enter', transitionGroupId: groupId });
  },

  commitEnterGroup: () => {
    const state = get();
    const groupId = state.transitionGroupId;
    if (!groupId || state.transitionDirection !== 'enter') return;
    if (!state.groups.has(groupId)) {
      set({ transitionDirection: null, transitionGroupId: null });
      return;
    }

    // Save current layout before entering
    if (savedLayoutStack.length >= MAX_LAYOUT_STACK_DEPTH) {
      savedLayoutStack.shift();
    }
    savedLayoutStack.push(captureLayout());

    // Load group's children into layoutStore
    const group = state.groups.get(groupId)!;
    applyLayoutFromGroup(group);

    const newStack = [...state.groupStack, groupId];
    set({ groupStack: newStack, transitionDirection: null, transitionGroupId: null });
  },

  exitGroup: () => {
    const state = get();
    if (state.groupStack.length === 0) return;

    // Save current layout back to the group we're leaving
    const currentGroupId = state.groupStack[state.groupStack.length - 1];
    const newGroups = syncLayoutToGroup(state.groups, currentGroupId);

    // Restore previous layout
    const saved = savedLayoutStack.pop();
    if (saved) restoreLayoutFromSaved(saved);

    const newStack = state.groupStack.slice(0, -1);
    set({ groups: newGroups, groupStack: newStack, transitionDirection: 'exit', transitionGroupId: currentGroupId });
  },

  jumpToLevel: (groupId: string | null) => {
    const state = get();
    if (state.groupStack.length === 0) return; // Already at root

    // Save current layout back to the group we're leaving
    const currentGroupId = state.groupStack[state.groupStack.length - 1];
    const newGroups = syncLayoutToGroup(state.groups, currentGroupId);

    if (groupId === null) {
      // Jump to root — restore the bottom of the saved stack
      const rootSaved = savedLayoutStack.length > 0 ? savedLayoutStack[0] : null;
      savedLayoutStack.length = 0;
      if (rootSaved) restoreLayoutFromSaved(rootSaved);

      set({ groups: newGroups, groupStack: [], transitionDirection: 'exit', transitionGroupId: currentGroupId });
      return;
    }

    const idx = state.groupStack.indexOf(groupId);
    if (idx === -1) return;

    // Restore the target group's layout from saved stack
    // savedLayoutStack[idx+1] is the layout that was active when inside groupStack[idx]
    const targetSaved = idx + 1 < savedLayoutStack.length ? savedLayoutStack[idx + 1] : null;
    savedLayoutStack.length = idx + 1; // Keep only ancestors
    if (targetSaved) restoreLayoutFromSaved(targetSaved);

    const newStack = state.groupStack.slice(0, idx + 1);
    set({ groups: newGroups, groupStack: newStack, transitionDirection: 'exit', transitionGroupId: currentGroupId });
  },

  // ─── Group CRUD ──────────────────────────────────────────────────────

  createGroup: (parentId: string | null, name?: string) => {
    groupCounter.value++;
    const id = `group-${Date.now()}-${groupCounter.value}`;
    const state = get();

    const newGroup: GroupState = {
      id,
      name: name ?? `Group ${groupCounter.value}`,
      parentId,
      childIds: [],
      layoutConfig: null,
      panelRects: new Map(),
      focusedChildId: null,
      activeChildId: null,
      stealFraction: 0.5,
    };

    const newGroups = new Map(state.groups);
    newGroups.set(id, newGroup);

    // If parent is a group, add to parent's childIds
    if (parentId !== null) {
      const parent = newGroups.get(parentId);
      if (parent) {
        newGroups.set(parentId, {
          ...parent,
          childIds: [...parent.childIds, id],
        });
      }
    }

    set({ groups: newGroups });
    return id;
  },

  renameGroup: (groupId: string, name: string) => {
    const state = get();
    const group = state.groups.get(groupId);
    if (!group) return;

    const newGroups = new Map(state.groups);
    newGroups.set(groupId, { ...group, name });
    set({ groups: newGroups });
  },

  deleteGroup: (groupId: string) => {
    const state = get();
    const group = state.groups.get(groupId);
    if (!group) return;

    const newGroups = new Map(state.groups);

    // Move children to parent group (splice in place of the deleted group)
    if (group.parentId !== null) {
      const parent = newGroups.get(group.parentId);
      if (parent) {
        const idx = parent.childIds.indexOf(groupId);
        const newChildIds = [...parent.childIds];
        if (idx !== -1) {
          newChildIds.splice(idx, 1, ...group.childIds);
        }
        newGroups.set(group.parentId, {
          ...parent,
          childIds: newChildIds,
        });
      }
    }

    // Add orphaned children to current layoutStore view so they appear immediately
    const ls = useLayoutStore.getState();
    for (const childId of group.childIds) {
      if (!ls.tabOrder.includes(childId)) {
        const pt = ls.panelTypes[childId] ?? 'terminal';
        ls.addPanel(childId, pt);
      }
    }

    // Delete the group itself
    newGroups.delete(groupId);

    // Clean up groupStack if we're inside the deleted group
    let newStack = state.groupStack;
    const stackIdx = newStack.indexOf(groupId);
    if (stackIdx !== -1) {
      newStack = newStack.slice(0, stackIdx);
      // Restore layout to the level before the deleted group
      if (savedLayoutStack.length > stackIdx) {
        const saved = savedLayoutStack[stackIdx];
        savedLayoutStack.length = stackIdx;
        if (saved) restoreLayoutFromSaved(saved);
      }
    }

    set({ groups: newGroups, groupStack: newStack });
  },

  restoreGroups: (groups: Map<string, GroupState>) => {
    // Merge restored groups over any existing ones (restored ids win) and
    // reset navigation to root — the restored layout is the root layout
    const state = get();
    const merged = new Map(state.groups);
    for (const [id, group] of groups) {
      merged.set(id, group);
    }
    savedLayoutStack.length = 0;
    set({ groups: merged, groupStack: [], transitionDirection: null, transitionGroupId: null });
  },

  // ─── Panel Management ────────────────────────────────────────────────

  addToGroup: (groupId: string, panelId: string) => {
    const state = get();
    const group = state.groups.get(groupId);
    if (!group) return;
    if (group.childIds.includes(panelId)) return;

    const newGroups = new Map(state.groups);
    newGroups.set(groupId, {
      ...group,
      childIds: [...group.childIds, panelId],
    });
    set({ groups: newGroups });
  },

  removeFromGroup: (groupId: string, panelId: string) => {
    const state = get();
    const group = state.groups.get(groupId);
    if (!group) return;

    const newChildIds = group.childIds.filter((id) => id !== panelId);
    const newGroups = new Map(state.groups);
    newGroups.set(groupId, {
      ...group,
      childIds: newChildIds,
      focusedChildId: group.focusedChildId === panelId
        ? (newChildIds[0] ?? null)
        : group.focusedChildId,
      activeChildId: group.activeChildId === panelId
        ? (newChildIds[0] ?? null)
        : group.activeChildId,
    });
    set({ groups: newGroups });
  },

  moveToGroup: (panelId: string, fromGroupId: string | null, toGroupId: string | null) => {
    const state = get();
    const newGroups = new Map(state.groups);

    // Remove from source group
    if (fromGroupId !== null) {
      const fromGroup = newGroups.get(fromGroupId);
      if (fromGroup) {
        const newChildIds = fromGroup.childIds.filter((id) => id !== panelId);
        newGroups.set(fromGroupId, {
          ...fromGroup,
          childIds: newChildIds,
          focusedChildId: fromGroup.focusedChildId === panelId
            ? (newChildIds[0] ?? null)
            : fromGroup.focusedChildId,
          activeChildId: fromGroup.activeChildId === panelId
            ? (newChildIds[0] ?? null)
            : fromGroup.activeChildId,
        });
      }
    }

    // Add to destination group
    if (toGroupId !== null) {
      const toGroup = newGroups.get(toGroupId);
      if (toGroup && !toGroup.childIds.includes(panelId)) {
        newGroups.set(toGroupId, {
          ...toGroup,
          childIds: [...toGroup.childIds, panelId],
        });
      }
    }

    set({ groups: newGroups });
  },

  // ─── Group Layout State ──────────────────────────────────────────────

  setGroupLayoutConfig: (groupId: string, config: LayoutConfig | null) => {
    const state = get();
    const group = state.groups.get(groupId);
    if (!group) return;
    if (group.layoutConfig === config) return;
    const newGroups = new Map(state.groups);
    newGroups.set(groupId, { ...group, layoutConfig: config });
    set({ groups: newGroups });
  },

  setGroupPanelRects: (groupId: string, rects: Map<string, PanelRect>) => {
    const state = get();
    const group = state.groups.get(groupId);
    if (!group) return;
    const newGroups = new Map(state.groups);
    newGroups.set(groupId, { ...group, panelRects: rects });
    set({ groups: newGroups });
  },

  setGroupFocusedChild: (groupId: string, childId: string | null) => {
    const state = get();
    const group = state.groups.get(groupId);
    if (!group) return;
    if (group.focusedChildId === childId) return;
    const newGroups = new Map(state.groups);
    newGroups.set(groupId, { ...group, focusedChildId: childId });
    set({ groups: newGroups });
  },

  setGroupActiveChild: (groupId: string, childId: string | null) => {
    const state = get();
    const group = state.groups.get(groupId);
    if (!group) return;
    if (group.activeChildId === childId) return;
    const newGroups = new Map(state.groups);
    newGroups.set(groupId, { ...group, activeChildId: childId });
    set({ groups: newGroups });
  },

  setGroupStealFraction: (groupId: string, fraction: number) => {
    const state = get();
    const group = state.groups.get(groupId);
    if (!group) return;
    if (group.stealFraction === fraction) return;
    const newGroups = new Map(state.groups);
    newGroups.set(groupId, { ...group, stealFraction: fraction });
    set({ groups: newGroups });
  },

  // ─── Computed Helpers ────────────────────────────────────────────────

  getCurrentGroupId: () => {
    const { groupStack } = get();
    if (groupStack.length === 0) return null;
    return groupStack[groupStack.length - 1];
  },

  getCurrentChildren: () => {
    const state = get();
    if (state.groupStack.length === 0) return EMPTY_CHILDREN;
    const currentId = state.groupStack[state.groupStack.length - 1];
    const group = state.groups.get(currentId);
    return group?.childIds ?? EMPTY_CHILDREN;
  },

  getBreadcrumb: () => {
    const state = get();
    if (state.groupStack.length === 0) return EMPTY_BREADCRUMB;

    const segments: BreadcrumbSegment[] = [{ id: null, name: 'Main' }];
    for (const groupId of state.groupStack) {
      const group = state.groups.get(groupId);
      segments.push({
        id: groupId,
        name: group?.name ?? 'Unknown',
      });
    }
    return segments;
  },
}));

// ─── Selector helpers (use these with module-level EMPTY to prevent infinite loops)

export { EMPTY_GROUP_STACK, EMPTY_CHILDREN, EMPTY_BREADCRUMB };
