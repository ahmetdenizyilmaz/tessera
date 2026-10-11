import { computeRects, createLayoutStore, getDefaultConfig, restoreClockwiseOrder, useLayoutStore, type LayoutStore } from '../store/layoutStore';
import { useGroupStore, type GroupState } from '../store/groupStore';

/** A detached group uses the exact same layout actions as Main, with its own
 * state. Membership and saved geometry stay in the workspace's group record. */
export function createDetachedLayout(groupId: string): LayoutStore {
  const store = createLayoutStore();
  readGroupLayout(store, useGroupStore.getState().groups.get(groupId));
  return store;
}

function readGroupLayout(store: LayoutStore, group?: GroupState, previousGroup?: GroupState) {
  const current = store.getState();
  const metadata = useLayoutStore.getState();
  const ids = group?.childIds ?? [];
  const active = ids.includes(group?.activeChildId ?? '') ? group!.activeChildId! : ids[0] ?? null;
  const changedSelection = previousGroup && group?.activeChildId !== previousGroup.activeChildId;
  const focused = changedSelection ? active : ids.includes(group?.focusedChildId ?? '') ? group!.focusedChildId! : active;
  const fraction = group?.stealFraction ?? { x: .5, y: .5 };
  const slots = group?.sidebarSlotFractions ?? current.sidebarSlotFractions;
  let config = group?.layoutConfig;
  if (!config || config.panelOrder.length !== ids.length || config.panelOrder.some(id => !ids.includes(id))) {
    config = getDefaultConfig(ids, focused, current.layoutConfig);
  }
  if (group?.panelRects) config = restoreClockwiseOrder(config, group.panelRects);
  if (changedSelection && (config.type === 'main' || config.type === 'grid') && focused) {
    config = { ...config, panelOrder: [focused, ...config.panelOrder.filter(id => id !== focused)] };
  }
  const savedRects = group?.panelRects;
  const rects = !changedSelection && savedRects?.size === ids.length && ids.every(id => savedRects.has(id))
    ? savedRects : computeRects(config, focused, fraction, slots);
  store.setState({
    layout: ids[0] ?? null, tabOrder: ids, activeTabId: active, focusedId: focused,
    layoutConfig: config, panelRects: rects, stealFraction: fraction, sidebarSlotFractions: slots,
    maximizedId: current.maximizedId && ids.includes(current.maximizedId) ? (changedSelection ? active : current.maximizedId) : null,
    panelTypes: metadata.panelTypes, widgetKinds: metadata.widgetKinds,
  });
}

export function connectDetachedLayout(store: LayoutStore, groupId: string): () => void {
  let updating = false;
  let previousGroup: GroupState | undefined;
  const save = () => {
    const group = useGroupStore.getState().groups.get(groupId);
    if (updating || !group) return;
    const state = store.getState();
    updating = true;
    try {
      previousGroup = { ...group, childIds: state.tabOrder, focusedChildId: state.focusedId,
        activeChildId: state.activeTabId, layoutConfig: state.layoutConfig, panelRects: state.panelRects,
        stealFraction: state.stealFraction, sidebarSlotFractions: state.sidebarSlotFractions };
      useGroupStore.setState(s => ({ groups: new Map(s.groups).set(groupId, previousGroup!) }));
    } finally { updating = false; }
  };
  const load = () => {
    const group = useGroupStore.getState().groups.get(groupId);
    if (updating || group === previousGroup) return;
    updating = true;
    try { readGroupLayout(store, group, previousGroup); previousGroup = group; }
    finally { updating = false; }
    save();
  };
  // Subscribe before the first render's layout can be changed by a panel.
  const stopSave = store.subscribe((state, previous) => {
    if (updating || (state.tabOrder === previous.tabOrder && state.focusedId === previous.focusedId
      && state.activeTabId === previous.activeTabId && state.layoutConfig === previous.layoutConfig
      && state.panelRects === previous.panelRects && state.stealFraction === previous.stealFraction
      && state.sidebarSlotFractions === previous.sidebarSlotFractions)) return;
    save();
  });
  const stopLoad = useGroupStore.subscribe(load);
  const stopMetadata = useLayoutStore.subscribe((state, previous) => {
    if (state.panelTypes !== previous.panelTypes || state.widgetKinds !== previous.widgetKinds) {
      store.setState({ panelTypes: state.panelTypes, widgetKinds: state.widgetKinds });
    }
  });
  // The store may have been created before a concurrent membership update.
  load();
  return () => { stopSave(); stopLoad(); stopMetadata(); };
}
