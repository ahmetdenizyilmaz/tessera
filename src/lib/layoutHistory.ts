import { captureGroupSnapshot, getPanelLocations, updateLevelLayout } from '../store/groupStore';
import { computeRects, useLayoutStore, type LayoutStore } from '../store/layoutStore';
import { useWorkspaceHistoryStore } from '../store/workspaceHistoryStore';
import type { LayoutConfig, PanelRect, StealFraction } from '../types/session';

export interface LevelGeometry {
  tabOrder: string[];
  layoutConfig: LayoutConfig | null;
  panelRects: Record<string, PanelRect>;
  focusedId: string | null;
  stealFraction: StealFraction;
  sidebarSlotFractions: number[];
}

export function readLevelGeometry(parentId: string | null): LevelGeometry | null {
  const snapshot = captureGroupSnapshot();
  if (parentId !== null) {
    const group = snapshot.groups.get(parentId);
    if (!group) return null;
    return { tabOrder: group.childIds, layoutConfig: group.layoutConfig,
      panelRects: Object.fromEntries(group.panelRects), focusedId: group.focusedChildId,
      stealFraction: group.stealFraction, sidebarSlotFractions: group.sidebarSlotFractions ?? [] };
  }
  const state = snapshot.rootLayout ?? useLayoutStore.getState();
  return { tabOrder: state.tabOrder, layoutConfig: state.layoutConfig,
    panelRects: Object.fromEntries(state.panelRects), focusedId: state.focusedId,
    stealFraction: state.stealFraction, sidebarSlotFractions: state.sidebarSlotFractions ?? [] };
}

export const samePanels = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));

function applyGeometry(parentId: string | null, saved: LevelGeometry): boolean {
  const current = readLevelGeometry(parentId);
  if (!current || !samePanels(current.tabOrder, saved.tabOrder) || !current.layoutConfig) return false;
  const config = { ...current.layoutConfig, mainWidthPercent: saved.layoutConfig?.mainWidthPercent };
  const exact = current.focusedId === saved.focusedId &&
    config.panelOrder.join('\0') === saved.layoutConfig?.panelOrder.join('\0');
  updateLevelLayout(parentId, {
    layoutConfig: config, stealFraction: saved.stealFraction, sidebarSlotFractions: saved.sidebarSlotFractions,
    panelRects: exact ? new Map(Object.entries(saved.panelRects))
      : computeRects(config, current.focusedId, saved.stealFraction, saved.sidebarSlotFractions),
  });
  return true;
}

/** Called once on pointer-down, then committed only on a completed gesture. */
export function beginPanelResize(layout: LayoutStore): () => void {
  const first = layout.getState().tabOrder[0];
  const parentId = getPanelLocations().get(first);
  if (parentId === undefined) return () => {};
  const before = readLevelGeometry(parentId);
  return () => {
    const after = readLevelGeometry(parentId);
    if (!before || !after || !samePanels(before.tabOrder, after.tabOrder) ||
      JSON.stringify(before.panelRects) === JSON.stringify(after.panelRects)) return;
    useWorkspaceHistoryStore.getState().record({
      label: 'Resize panels',
      valid: () => {
        const current = readLevelGeometry(parentId);
        return !!current && samePanels(current.tabOrder, before.tabOrder) &&
          current.layoutConfig?.type === before.layoutConfig?.type &&
          current.layoutConfig?.direction === before.layoutConfig?.direction;
      },
      undo: () => applyGeometry(parentId, before),
      redo: () => applyGeometry(parentId, after),
    });
  };
}
