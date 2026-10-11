import { captureGroupSnapshot, ensurePanelAtLevel, getPanelLocations, removePanelsFromWorkspace,
  updateLevelLayout, useGroupStore } from '../store/groupStore';
import { useLayoutStore, notifyPanelLimit } from '../store/layoutStore';
import { useInstanceStore } from '../store/instanceStore';
import { usePluginStore } from '../store/pluginStore';
import { useLlmChatStore } from '../store/llmChatStore';
import { usePanelShortcutStore } from '../store/panelShortcutStore';
import { useWorkspaceWindowStore } from '../store/workspaceWindowStore';
import { useRecentPanelStore } from '../store/recentPanelStore';
import { useWorkspaceHistoryStore } from '../store/workspaceHistoryStore';
import { remotePanelByCompositeId, splitRemotePanelId, useLanStore } from '../store/lanStore';
import { recentPanelKey, type ClosedPanel, type RememberedPanel } from '../types/panelHistory';
import { canPlacePanel, panelDestination } from './panelPlacement';
import { readLevelGeometry, samePanels } from './layoutHistory';
import { focusShortcutPanel } from './panelShortcuts';
import { notify } from './toast';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const flatten = (panel: RememberedPanel): RememberedPanel[] => [panel, ...(panel.children ?? []).flatMap(flatten)];

export function captureClosedPanel(id: string): ClosedPanel | null {
  const snapshot = captureGroupSnapshot();
  const locations = getPanelLocations(snapshot);
  const windowRoot = useWorkspaceWindowStore.getState().windows.find(w => w.groupId === id);
  if (!locations.has(id) && !windowRoot) return null;
  const layout = useLayoutStore.getState();
  const seen = new Set<string>();
  const capture = (panelId: string): RememberedPanel | null => {
    if (seen.has(panelId) || layout.widgetKinds[panelId] === 'new-session') return null;
    seen.add(panelId);
    const instance = useInstanceStore.getState().instances.get(panelId);
    const plugin = usePluginStore.getState().instances.get(panelId);
    const group = snapshot.groups.get(panelId);
    const remote = remotePanelByCompositeId(panelId);
    const type = layout.panelTypes[panelId] ?? (group ? 'group' : instance ? 'terminal' : null);
    if (!type || (!instance && !plugin && !group && type !== 'widget' && type !== 'computer' && !remote)) return null;
    return {
      id: panelId, type,
      name: instance?.name ?? plugin?.title ?? group?.name ?? remote?.panel.name ??
        (type === 'computer' ? 'Computer' : layout.widgetKinds[panelId] ?? 'Panel'),
      instance, plugin, widgetKind: layout.widgetKinds[panelId],
      group: group ? { ...group, panelRects: Object.fromEntries(group.panelRects) } : undefined,
      children: group?.childIds.map(capture).filter((p): p is RememberedPanel => p !== null),
      llmMessages: type === 'llm' ? useLlmChatStore.getState().getConversation(panelId).messages : undefined,
      remoteDeviceId: group?.remotePeerId ?? remote?.peer.deviceId,
    };
  };
  const panel = capture(id);
  if (!panel) return null;
  const parentId = locations.get(id) ?? null;
  const window = useWorkspaceWindowStore.getState().windows.find(w => w.groupId === id || w.groupId === parentId);
  const windowGroup = window && snapshot.groups.get(window.groupId);
  const ids = new Set(flatten(panel).map(p => p.id));
  const saved = clone({ panel, parentId, geometry: windowRoot ? null : readLevelGeometry(parentId),
    shortcuts: Object.fromEntries(Object.entries(usePanelShortcutStore.getState().bindings).filter(([, value]) => ids.has(value))),
    window, windowGroup: windowGroup ? { ...windowGroup, panelRects: Object.fromEntries(windowGroup.panelRects) } : undefined,
  });
  for (const item of flatten(saved.panel)) {
    const inst = item.instance;
    if (!inst) continue;
    // Match normal workspace restore: empty unpersisted Codex threads cannot resume.
    if (inst.codexHasTurns === false && !inst.codexResumable) inst.codexThreadId = undefined;
    if (inst.config.fork) delete inst.config.fork.openingMessage;
  }
  return saved;
}

export function findRememberedPanel(panel: RememberedPanel): string | null {
  const live = getPanelLocations();
  if (live.has(panel.id)) return panel.id;
  if (useWorkspaceWindowStore.getState().windows.some(w => w.groupId === panel.id) &&
    useGroupStore.getState().groups.has(panel.id)) return panel.id;
  if (!panel.instance) return null;
  const key = recentPanelKey(panel);
  for (const instance of useInstanceStore.getState().instances.values()) {
    if (live.has(instance.id) && recentPanelKey({ ...panel, id: instance.id, instance }) === key) return instance.id;
  }
  return null;
}

function focusRememberedPanel(id: string) {
  const workspace = useWorkspaceWindowStore.getState().windows.find(w => w.groupId === id);
  const group = workspace && useGroupStore.getState().groups.get(id);
  const target = group ? (group.childIds.includes(group.activeChildId ?? '') ? group.activeChildId! : group.childIds[0]) : id;
  if (target) focusShortcutPanel(target);
}

/** Restore only the closed subtree. Existing panels/processes are untouched. */
export function restoreClosedPanel(saved: ClosedPanel, wizardId?: string): boolean {
  const existing = findRememberedPanel(saved.panel);
  if (existing) {
    if (wizardId) removePanelsFromWorkspace([wizardId]);
    focusRememberedPanel(existing);
    return true;
  }
  let destination = wizardId ? panelDestination(wizardId) : saved.parentId;
  const recoverWindow = !wizardId && saved.window && saved.windowGroup &&
    !useGroupStore.getState().groups.has(saved.window.groupId);
  const windowRoot = !wizardId && saved.window?.groupId === saved.panel.id;
  if (destination && !useGroupStore.getState().groups.has(destination) && !recoverWindow) {
    destination = useGroupStore.getState().getCurrentGroupId();
  }
  if (!windowRoot && !canPlacePanel(destination, wizardId)) { notifyPanelLimit(); return false; }
  const all = flatten(saved.panel);
  const unavailable = all.find(p => p.plugin && !usePluginStore.getState().registry.has(p.plugin.pluginName));
  if (unavailable) { notify(`Install ${unavailable.plugin!.pluginName} to reopen ${unavailable.name}.`); return false; }
  const missingRemote = all.find(p => p.remoteDeviceId && !useLanStore.getState().status?.peers.some(peer =>
    peer.deviceId === p.remoteDeviceId && (p.type !== 'remote' || peer.panels.some(info => info.id === splitRemotePanelId(p.id)?.panelId))));
  if (missingRemote) { notify(`Reconnect the local PC to reopen ${missingRemote.name}.`); return false; }

  if (recoverWindow && saved.panel.id !== saved.window!.groupId) {
    const wrapper = saved.windowGroup!;
    useGroupStore.setState(state => ({ groups: new Map(state.groups).set(wrapper.id, {
      ...wrapper, childIds: [], layoutConfig: null, panelRects: new Map(), focusedChildId: null, activeChildId: null,
    }) }));
  }
  const restore = (panel: RememberedPanel, parent: string | null): boolean => {
    // A child may already have been reopened from Recents. Do not clone its
    // conversation or move it out of the location the user chose.
    if (findRememberedPanel(panel)) return false;
    if (panel.instance) {
      const inst = clone(panel.instance);
      inst.status = 'starting';
      if (inst.codexThreadId) inst.codexResumable = true;
      useInstanceStore.setState(state => ({ instances: new Map(state.instances).set(inst.id, inst) }));
    }
    if (panel.plugin) {
      const plugin = clone(panel.plugin);
      usePluginStore.setState(state => ({ instances: new Map(state.instances).set(plugin.id, { ...plugin, iframeReady: false }) }));
    }
    const messages = panel.llmMessages;
    if (messages) useLlmChatStore.setState(state => ({ conversations: { ...state.conversations,
      [panel.id]: { messages: messages.map(m => ({ ...m, isStreaming: false })), isStreaming: false, error: null },
    } }));
    if (panel.widgetKind) useLayoutStore.setState(state => ({ widgetKinds: { ...state.widgetKinds, [panel.id]: panel.widgetKind! } }));
    if (panel.group) {
      const group = panel.group;
      useGroupStore.setState(state => ({ groups: new Map(state.groups).set(panel.id, {
        ...group, parentId: parent, childIds: [], layoutConfig: null, panelRects: new Map(),
      }) }));
    }
    // Detached workspace roots are hidden containers, not tabs in Main.
    if (!(windowRoot && panel.id === saved.panel.id)) ensurePanelAtLevel(panel.id, parent, panel.type);
    const children = (panel.children ?? []).filter(child => restore(child, panel.id)).map(child => child.id);
    if (panel.group && samePanels(children, panel.group.childIds)) updateLevelLayout(panel.id, {
      tabOrder: panel.group.childIds, layoutConfig: panel.group.layoutConfig,
      panelRects: new Map(Object.entries(panel.group.panelRects)), stealFraction: panel.group.stealFraction,
      sidebarSlotFractions: panel.group.sidebarSlotFractions,
    });
    return true;
  };
  restore(saved.panel, destination);
  if (saved.panel.remoteDeviceId || all.some(p => p.remoteDeviceId)) {
    const ids = new Set(all.map(p => p.id));
    const peers = new Set(all.map(p => p.remoteDeviceId).filter(Boolean));
    useLanStore.setState(state => ({ hiddenPanelIds: state.hiddenPanelIds.filter(id => !ids.has(id)),
      hiddenPeerIds: state.hiddenPeerIds.filter(id => !peers.has(id)) }));
  }
  if (wizardId) removePanelsFromWorkspace([wizardId]);
  // Restore its old slot/sizes only if the surrounding panels still match.
  // Adding unrelated panels since the close must never undo those additions.
  const current = readLevelGeometry(destination);
  if (!wizardId && saved.geometry && current && samePanels(current.tabOrder, saved.geometry.tabOrder)) {
    updateLevelLayout(destination, { tabOrder: saved.geometry.tabOrder, layoutConfig: saved.geometry.layoutConfig,
      panelRects: new Map(Object.entries(saved.geometry.panelRects)), stealFraction: saved.geometry.stealFraction,
      sidebarSlotFractions: saved.geometry.sidebarSlotFractions });
  }
  if (!wizardId && saved.window && useGroupStore.getState().groups.has(saved.window.groupId) &&
    !useWorkspaceWindowStore.getState().windows.some(w => w.id === saved.window!.id)) {
    useWorkspaceWindowStore.getState().add(saved.window);
  }
  for (const [number, id] of Object.entries(saved.shortcuts)) {
    if (getPanelLocations().has(id) && !usePanelShortcutStore.getState().bindings[number]) usePanelShortcutStore.getState().assign(number, id);
  }
  // Selection routes across Main, nested groups and detached windows.
  focusRememberedPanel(saved.panel.id);
  const updated = captureClosedPanel(saved.panel.id);
  if (updated) useRecentPanelStore.getState().remember(updated);
  return true;
}

export function recordPanelClose(saved: ClosedPanel, close: (id: string) => Promise<void>) {
  useRecentPanelStore.getState().remember(saved);
  let latest = saved;
  useWorkspaceHistoryStore.getState().record({
    label: `Close ${saved.panel.name}`,
    valid: direction => direction === 'undo' ? !findRememberedPanel(latest.panel) : !!findRememberedPanel(latest.panel),
    undo: () => restoreClosedPanel(latest),
    redo: async () => {
      const id = findRememberedPanel(latest.panel);
      if (!id) return false;
      latest = captureClosedPanel(id) ?? latest;
      await close(id);
      useRecentPanelStore.getState().remember(latest);
      return true;
    },
  });
}

export function openRecentPanel(saved: ClosedPanel, wizardId: string): boolean {
  const restored = restoreClosedPanel(saved, wizardId);
  if (restored) useWorkspaceHistoryStore.setState({ future: [] });
  return restored;
}

/** Track use/renames/session identity without saving on every streamed token. */
export function installRecentPanelTracking() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touched = new Set<string>();
  const flush = () => {
    clearTimeout(timer);
    for (const id of getPanelLocations().keys()) {
      const saved = captureClosedPanel(id);
      if (saved) useRecentPanelStore.getState().remember(saved, touched.has(id));
    }
    touched.clear();
  };
  const schedule = (id?: string | null) => {
    if (id) touched.add(id);
    clearTimeout(timer); timer = setTimeout(flush, 250);
  };
  const stops = [
    useLayoutStore.subscribe((s, p) => {
      if (s.focusedId !== p.focusedId) schedule(s.focusedId);
      else if (s.tabOrder !== p.tabOrder) schedule();
    }),
    useGroupStore.subscribe((s, p) => {
      if (s.groups === p.groups) return;
      for (const [id, g] of s.groups) {
        const old = p.groups.get(id);
        if (g.activeChildId !== old?.activeChildId) schedule(g.activeChildId);
        else if (g.childIds !== old?.childIds || g.name !== old?.name) schedule();
      }
    }),
    useInstanceStore.subscribe((s, p) => {
      for (const [id, inst] of s.instances) {
        const old = p.instances.get(id);
        if (!old || inst.name !== old.name || inst.config !== old.config || inst.color !== old.color ||
          inst.claudeSessionId !== old.claudeSessionId || inst.codexThreadId !== old.codexThreadId ||
          inst.opencodeSessionId !== old.opencodeSessionId || inst.antigravityConversationId !== old.antigravityConversationId) schedule();
      }
    }),
    usePluginStore.subscribe((s, p) => { if (s.instances !== p.instances) schedule(); }),
  ];
  schedule(useLayoutStore.getState().focusedId);
  return () => { stops.forEach(stop => stop()); clearTimeout(timer); };
}
