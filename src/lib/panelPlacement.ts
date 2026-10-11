import { captureGroupSnapshot, ensurePanelAtLevel, getPanelLocations, removePanelsFromWorkspace, useGroupStore } from '../store/groupStore';
import { MAX_PANELS, useLayoutStore, type PanelType } from '../store/layoutStore';

export function panelDestination(replacingId?: string): string | null {
  return replacingId ? (getPanelLocations(captureGroupSnapshot()).get(replacingId) ?? null) : useGroupStore.getState().getCurrentGroupId();
}

export function placePanel(id: string, type: PanelType, destination: string | null, replacingId?: string) {
  // A window can close while a provider is connecting. Recover to Main.
  if (destination && !useGroupStore.getState().groups.has(destination)) destination = null;
  ensurePanelAtLevel(id, destination, type);
  if (replacingId) removePanelsFromWorkspace([replacingId]);
  if (destination) useGroupStore.getState().setGroupActiveChild(destination, id);
}

export function canPlacePanel(destination: string | null, replacingId?: string): boolean {
  const snapshot = captureGroupSnapshot();
  const ids = destination ? snapshot.groups.get(destination)?.childIds ?? [] : snapshot.rootLayout?.tabOrder ?? useLayoutStore.getState().tabOrder;
  return ids.filter(id => id !== replacingId).length < MAX_PANELS;
}
