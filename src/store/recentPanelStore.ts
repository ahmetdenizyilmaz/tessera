import { create } from 'zustand';
import { recentPanelKey, type ClosedPanel, type RecentPanel, type RememberedPanel } from '../types/panelHistory';

export const RECENT_PANELS_KEY = 'tessera-recent-panels';
export const RECENT_PANEL_LIMIT = 40;

function load(): RecentPanel[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_PANELS_KEY) ?? 'null');
    return value?.version === 1 && Array.isArray(value.entries)
      ? value.entries.filter((entry: RecentPanel) => typeof entry?.key === 'string' &&
        Number.isFinite(entry.lastUsed) && typeof entry.saved?.panel?.id === 'string' &&
        typeof entry.saved.panel.name === 'string').slice(0, RECENT_PANEL_LIMIT) : [];
  } catch { return []; }
}

function save(entries: RecentPanel[]) {
  if (typeof localStorage === 'undefined') return;
  // History must never prevent a panel closing if storage is full. Retain the
  // newest entries that fit; the full bounded list stays available in memory.
  for (let count = entries.length; count > 0; count--) {
    try {
      localStorage.setItem(RECENT_PANELS_KEY, JSON.stringify({ version: 1, entries: entries.slice(0, count) }));
      return;
    } catch { /* retry with less old history */ }
  }
}

export const useRecentPanelStore = create<{
  entries: RecentPanel[];
  remember: (saved: ClosedPanel, touch?: boolean) => void;
  remap: (idMap: Map<string, string>) => void;
}>((set, get) => ({
  entries: load(),
  remap: idMap => {
    const id = (value: string) => idMap.get(value) ?? value;
    const geometry = <T extends { tabOrder: string[]; focusedId: string | null; layoutConfig: import('../types/session').LayoutConfig | null;
      panelRects: Record<string, import('../types/session').PanelRect> }>(value: T): T => ({ ...value,
      tabOrder: value.tabOrder.map(id), focusedId: value.focusedId ? id(value.focusedId) : null,
      layoutConfig: value.layoutConfig ? { ...value.layoutConfig, panelOrder: value.layoutConfig.panelOrder.map(id) } : null,
      panelRects: Object.fromEntries(Object.entries(value.panelRects).map(([key, rect]) => [id(key), rect])),
    });
    const panel = (value: RememberedPanel): RememberedPanel => ({ ...value, id: id(value.id),
      instance: value.instance ? { ...value.instance, id: id(value.instance.id) } : undefined,
      children: value.children?.map(panel),
      group: value.group ? { ...value.group, childIds: value.group.childIds.map(id),
        focusedChildId: value.group.focusedChildId ? id(value.group.focusedChildId) : null,
        activeChildId: value.group.activeChildId ? id(value.group.activeChildId) : null,
        layoutConfig: value.group.layoutConfig ? { ...value.group.layoutConfig, panelOrder: value.group.layoutConfig.panelOrder.map(id) } : null,
        panelRects: Object.fromEntries(Object.entries(value.group.panelRects).map(([key, rect]) => [id(key), rect])),
      } : undefined,
    });
    const entries = get().entries.map(entry => {
      const saved = { ...entry.saved, panel: panel(entry.saved.panel),
        geometry: entry.saved.geometry ? geometry(entry.saved.geometry) : null,
        shortcuts: Object.fromEntries(Object.entries(entry.saved.shortcuts).map(([key, value]) => [key, id(value)])),
      };
      return { ...entry, saved, key: recentPanelKey(saved.panel) };
    });
    set({ entries }); save(entries);
  },
  remember: (saved, touch = true) => {
    const key = recentPanelKey(saved.panel);
    const previous = get().entries.find(entry => entry.key === key || entry.saved.panel.id === saved.panel.id);
    const next = { key, lastUsed: touch ? Date.now() : previous?.lastUsed ?? Date.now(), saved };
    const entries = [next, ...get().entries.filter(entry => entry !== previous && entry.key !== key)]
      .sort((a, b) => b.lastUsed - a.lastUsed).slice(0, RECENT_PANEL_LIMIT);
    set({ entries });
    save(entries);
  },
}));
