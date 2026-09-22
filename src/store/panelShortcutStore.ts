import { create } from 'zustand';

export type PanelShortcutBindings = Record<string, string>;
export const isShortcutNumber = (number: string) => /^[0-9]$/.test(number);

export function normalizePanelShortcuts(value: unknown): PanelShortcutBindings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const bindings: PanelShortcutBindings = {};
  const assigned = new Set<string>();
  for (const [number, id] of Object.entries(value)) {
    if (!isShortcutNumber(number) || typeof id !== 'string' || !id || assigned.has(id)) continue;
    bindings[number] = id;
    assigned.add(id);
  }
  return bindings;
}

interface PanelShortcutState {
  /** Saved with the workspace so restored instance IDs can be remapped. */
  bindings: PanelShortcutBindings;
  ctrlHeld: boolean;
  altHeld: boolean;
  assign: (number: string, panelId: string) => void;
  removePanels: (panelIds: Iterable<string>) => void;
  restore: (bindings: unknown) => void;
  setModifiers: (ctrlHeld: boolean, altHeld: boolean) => void;
}

export const usePanelShortcutStore = create<PanelShortcutState>((set) => ({
  bindings: {},
  ctrlHeld: false,
  altHeld: false,
  assign: (number, panelId) => {
    if (!isShortcutNumber(number) || !panelId) return;
    set(state => state.bindings[number] === panelId ? state : {
      bindings: { ...Object.fromEntries(Object.entries(state.bindings).filter(([slot, id]) => slot !== number && id !== panelId)),
        [number]: panelId },
    });
  },
  removePanels: (panelIds) => {
    const ids = new Set(panelIds);
    set(state => Object.values(state.bindings).some(id => ids.has(id)) ? {
      bindings: Object.fromEntries(Object.entries(state.bindings).filter(([, id]) => !ids.has(id))),
    } : state);
  },
  restore: (bindings) => set({ bindings: normalizePanelShortcuts(bindings), ctrlHeld: false, altHeld: false }),
  setModifiers: (ctrlHeld, altHeld) => set(state => state.ctrlHeld === ctrlHeld && state.altHeld === altHeld
    ? state : { ctrlHeld, altHeld }),
}));
