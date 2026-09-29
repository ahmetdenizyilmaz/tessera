import { canMovePanelToLevel, captureGroupSnapshot, getPanelLocations, type GroupState } from '../store/groupStore';
import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore } from '../store/layoutStore';
import { usePluginStore } from '../store/pluginStore';

export interface GroupPanelOption {
  id: string | null;
  name: string;
  location: string;
  isGroup: boolean;
}

function groupPath(groupId: string | null, groups: Map<string, GroupState>): string {
  const names: string[] = [];
  const seen = new Set<string>();
  while (groupId !== null && !seen.has(groupId)) {
    seen.add(groupId);
    const group = groups.get(groupId);
    if (!group) break;
    names.unshift(group.name);
    groupId = group.parentId;
  }
  return ['Main', ...names].join(' / ');
}

export function getGroupMoveOptions(panelId: string): GroupPanelOption[] {
  const snapshot = captureGroupSnapshot();
  const options: GroupPanelOption[] = [{ id: null, name: 'Main', location: 'Top-level workspace', isGroup: true }];
  for (const group of snapshot.groups.values()) {
    options.push({ id: group.id, name: group.name, location: groupPath(group.parentId, snapshot.groups), isGroup: true });
  }
  return options.filter(option => canMovePanelToLevel(panelId, option.id, snapshot));
}

export function getExistingPanelOptions(groupId: string): GroupPanelOption[] {
  const snapshot = captureGroupSnapshot();
  const layout = useLayoutStore.getState();
  const instances = useInstanceStore.getState().instances;
  const plugins = usePluginStore.getState().instances;
  const options: GroupPanelOption[] = [];
  for (const [id, parentId] of getPanelLocations(snapshot)) {
    if (!canMovePanelToLevel(id, groupId, snapshot)) continue;
    const group = snapshot.groups.get(id);
    const widget = layout.widgetKinds[id];
    const name = group?.name ?? instances.get(id)?.name ?? plugins.get(id)?.title
      ?? (widget ? widget.replace(/-/g, ' ').replace(/^./, letter => letter.toUpperCase()) : 'Panel');
    options.push({ id, name, location: groupPath(parentId, snapshot.groups), isGroup: !!group });
  }
  return options;
}
